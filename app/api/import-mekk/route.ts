import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

/**
 * Recibe el JSON generado por el scraper de MËKK y hace upsert en
 * mekk_productos. Marca como inactivos (activo=false) los productos
 * que ya existían pero no vinieron en esta corrida (ya no están en el sitio).
 *
 * Auth: header "Authorization: Bearer <INTERNAL_API_TOKEN>"
 *
 * Body esperado: array de objetos:
 * [
 *   {
 *     "nombre": "...",
 *     "categoria": "...",
 *     "link": "https://mekkmayorista.com.ar/...",
 *     "imagen_url": "...",
 *     "precio_mayorista": 12345.0,
 *     "precio_mayorista_sin_descuento": 14000.0,  // opcional
 *     "precio_minorista": 23000.0                  // opcional
 *   },
 *   ...
 * ]
 */

type ItemMekk = {
  nombre: string;
  categoria?: string | null;
  link?: string | null;
  imagen_url?: string | null;
  precio_mayorista?: number | null;
  precio_mayorista_sin_descuento?: number | null;
  precio_minorista?: number | null;
};

function hashIdentidad(item: ItemMekk): string {
  const base = (item.link && item.link.trim()) || `${item.categoria ?? ""}::${item.nombre}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expectedToken = process.env.INTERNAL_API_TOKEN;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let items: ItemMekk[];
  try {
    items = await req.json();
    if (!Array.isArray(items)) throw new Error("El body debe ser un array");
  } catch (err: any) {
    return NextResponse.json(
      { error: `Body inválido: ${String(err?.message ?? err)}` },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const vistosHashes: string[] = [];

  let upserts = 0;
  let errores = 0;

  for (const item of items) {
    if (!item.nombre) {
      errores += 1;
      continue;
    }

    const hash = hashIdentidad(item);
    vistosHashes.push(hash);

    const { error } = await supabase.from("mekk_productos").upsert(
      {
        hash_identidad: hash,
        nombre: item.nombre,
        categoria: item.categoria ?? null,
        link: item.link ?? null,
        imagen_url: item.imagen_url ?? null,
        precio_mayorista: item.precio_mayorista ?? null,
        precio_mayorista_sin_descuento: item.precio_mayorista_sin_descuento ?? null,
        precio_minorista: item.precio_minorista ?? null,
        activo: true,
        ultima_vez_visto: new Date().toISOString(),
      },
      { onConflict: "hash_identidad" }
    );

    if (error) {
      console.error("Error upsert mekk_producto", item.nombre, error);
      errores += 1;
      continue;
    }

    upserts += 1;
  }

  // Marcar como inactivos los productos que no aparecieron en esta corrida
  let desactivados = 0;
  if (vistosHashes.length > 0) {
    const { data: desactivadosData, error: deactivateError } = await supabase
      .from("mekk_productos")
      .update({ activo: false })
      .eq("activo", true)
      .not("hash_identidad", "in", `(${vistosHashes.map((h) => `"${h}"`).join(",")})`)
      .select("id");

    if (!deactivateError) {
      desactivados = desactivadosData?.length ?? 0;
    } else {
      console.error("Error desactivando productos viejos", deactivateError);
    }
  }

  await supabase.from("sync_logs").insert({
    tipo: "scraper_mekk",
    estado: errores > 0 ? "parcial" : "ok",
    detalle: {
      total_recibidos: items.length,
      upserts,
      errores,
      desactivados,
    },
  });

  return NextResponse.json({
    ok: true,
    total_recibidos: items.length,
    upserts,
    errores,
    desactivados,
  });
}
