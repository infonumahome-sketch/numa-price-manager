import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface ProductoMekk {
  nombre: string;
  categoria: string;
  link: string;
  imagen_url: string;
  precio_minorista?: number;
  precio_mayorista?: number;
  precio_mayorista_sin_descuento?: number;
  tipo_proveedor: "minorista" | "mayorista";
}

function generar_hash(nombre: string, categoria: string): string {
  return crypto
    .createHash("sha256")
    .update(`${nombre}|${categoria}`)
    .digest("hex")
    .slice(0, 12);
}

async function upsert_minorista(productos: ProductoMekk[]) {
  const minorista = productos.filter((p) => p.tipo_proveedor === "minorista");
  if (minorista.length === 0) return { count: 0 };

  const rows = minorista.map((p) => ({
    nombre: p.nombre,
    categoria: p.categoria,
    link: p.link || null,
    imagen_url: p.imagen_url || null,
    precio_minorista: p.precio_minorista || null,
    hash_identidad: generar_hash(p.nombre, p.categoria),
    activo: true,
  }));

  const { error } = await supabase
    .from("mekk_productos_minorista")
    .upsert(rows, { onConflict: "hash_identidad" });

  if (error) throw error;
  return { count: rows.length };
}

async function upsert_mayorista(productos: ProductoMekk[]) {
  const mayorista = productos.filter((p) => p.tipo_proveedor === "mayorista");
  if (mayorista.length === 0) return { count: 0 };

  const rows = mayorista.map((p) => ({
    nombre: p.nombre,
    categoria: p.categoria,
    link: p.link || null,
    imagen_url: p.imagen_url || null,
    precio_mayorista: p.precio_mayorista || null,
    precio_mayorista_sin_descuento: p.precio_mayorista_sin_descuento || null,
    hash_identidad: generar_hash(p.nombre, p.categoria),
    activo: true,
  }));

  const { error } = await supabase
    .from("mekk_productos_mayorista")
    .upsert(rows, { onConflict: "hash_identidad" });

  if (error) throw error;
  return { count: rows.length };
}

export async function POST(request: NextRequest) {
  try {
    // Validar token
    const auth = request.headers.get("authorization");
    const token = auth?.replace("Bearer ", "");

    if (!token || token !== INTERNAL_API_TOKEN) {
      return NextResponse.json(
        { error: "Token inválido o faltante" },
        { status: 401 }
      );
    }

    const productos: ProductoMekk[] = await request.json();

    if (!Array.isArray(productos) || productos.length === 0) {
      return NextResponse.json(
        { error: "No hay productos para importar" },
        { status: 400 }
      );
    }

    // Validar que cada producto tenga tipo_proveedor
    const sinTipo = productos.filter((p) => !p.tipo_proveedor);
    if (sinTipo.length > 0) {
      return NextResponse.json(
        {
          error: `${sinTipo.length} productos sin tipo_proveedor (esperado: 'minorista' o 'mayorista')`,
        },
        { status: 400 }
      );
    }

    // Upsert en tabla minorista
    const resultMinorista = await upsert_minorista(productos);

    // Upsert en tabla mayorista
    const resultMayorista = await upsert_mayorista(productos);

    const total = resultMinorista.count + resultMayorista.count;

    console.log(
      `✅ Importación exitosa: ${resultMinorista.count} minorista + ${resultMayorista.count} mayorista`
    );

    return NextResponse.json({
      ok: true,
      total_recibidos: productos.length,
      upserts: total,
      errores: 0,
      desactivados: 0,
    });
  } catch (error) {
    console.error("❌ Error en /api/import-mekk:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}