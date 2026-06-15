import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Sincroniza productos y variantes desde la API de Tienda Nube hacia Supabase.
 *
 * Auth: requiere header "Authorization: Bearer <INTERNAL_API_TOKEN>"
 * (mismo token que usa el scraper / cron de GitHub Actions, o se puede
 * llamar manualmente desde el panel con un botón "Sincronizar").
 *
 * Docs API Tienda Nube: https://dev.tiendanube.com/docs/api
 *   GET /v1/{store_id}/products?page=1&per_page=200
 */

const TN_API_BASE = "https://api.tiendanube.com/v1";

type TNVariant = {
  id: number;
  price: string | null;
  promotional_price: string | null;
  stock: number | null;
  sku: string | null;
  barcode: string | null;
  weight: string | null;
  depth: string | null;
  width: string | null;
  height: string | null;
  cost: string | null;
  values: { es?: string }[];
};

type TNProduct = {
  id: number;
  name: { es?: string };
  handle: { es?: string };
  description: { es?: string };
  brand: string | null;
  tags: string[] | string;
  published: boolean;
  variants: TNVariant[];
  attributes: { es?: string }[];
  categories: { id: number; name: { es?: string } }[];
};

function toNumber(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

async function fetchAllProducts(storeId: string, token: string, userAgent: string): Promise<TNProduct[]> {
  const products: TNProduct[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const res = await fetch(
      `${TN_API_BASE}/${storeId}/products?page=${page}&per_page=${perPage}`,
      {
        headers: {
          Authorization: `bearer ${token}`,
          "User-Agent": userAgent,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tienda Nube API error (${res.status}): ${text}`);
    }

    const batch: TNProduct[] = await res.json();
    products.push(...batch);

    if (batch.length < perPage) break;
    page += 1;

    // Resguardo de seguridad por si algo sale mal
    if (page > 50) break;
  }

  return products;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expectedToken = process.env.INTERNAL_API_TOKEN;
  const tokenOk = !!expectedToken && authHeader === `Bearer ${expectedToken}`;

  if (!tokenOk) {
    // Si no vino con el token interno, permitir si hay un usuario logueado
    // (caso: botón "Sincronizar" del panel)
    const supabaseUser = createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  const storeId = process.env.TIENDANUBE_STORE_ID;
  const token = process.env.TIENDANUBE_ACCESS_TOKEN;
  const userAgent = process.env.TIENDANUBE_USER_AGENT || "Numa Price Manager";

  if (!storeId || !token) {
    return NextResponse.json(
      { error: "Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN" },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();

  try {
    const products = await fetchAllProducts(storeId, token, userAgent);

    let productosUpsertados = 0;
    let variantesUpsertadas = 0;

    for (const p of products) {
      const categorias = (p.categories ?? [])
        .map((c) => c.name?.es)
        .filter(Boolean)
        .join(" > ");

      const tags = Array.isArray(p.tags) ? p.tags.join(", ") : p.tags ?? "";

      // Upsert producto padre
      const { data: productoRow, error: prodError } = await supabase
        .from("tn_productos")
        .upsert(
          {
            tn_product_id: p.id,
            handle: p.handle?.es ?? String(p.id),
            nombre: p.name?.es ?? "(sin nombre)",
            categorias: categorias || null,
            marca: p.brand || null,
            descripcion: p.description?.es || null,
            tags: tags || null,
            mostrar_en_tienda: p.published,
          },
          { onConflict: "tn_product_id" }
        )
        .select("id")
        .single();

      if (prodError || !productoRow) {
        console.error("Error upsert producto", p.id, prodError);
        continue;
      }

      productosUpsertados += 1;

      // Upsert variantes
      for (const v of p.variants ?? []) {
        const valores = v.values ?? [];

        const { error: varError } = await supabase
          .from("tn_variantes")
          .upsert(
            {
              producto_id: productoRow.id,
              tn_variant_id: v.id,
              prop1_nombre: p.attributes?.[0]?.es ?? null,
              prop1_valor: valores?.[0]?.es ?? null,
              prop2_nombre: p.attributes?.[1]?.es ?? null,
              prop2_valor: valores?.[1]?.es ?? null,
              prop3_nombre: p.attributes?.[2]?.es ?? null,
              prop3_valor: valores?.[2]?.es ?? null,
              sku: v.sku || null,
              codigo_barras: v.barcode || null,
              precio: toNumber(v.price),
              precio_promocional: toNumber(v.promotional_price),
              costo: toNumber(v.cost),
              stock: v.stock,
              peso_kg: toNumber(v.weight),
              alto_cm: toNumber(v.height),
              ancho_cm: toNumber(v.width),
              profundidad_cm: toNumber(v.depth),
            },
            { onConflict: "tn_variant_id" }
          );

        if (varError) {
          console.error("Error upsert variante", v.id, varError);
          continue;
        }

        variantesUpsertadas += 1;
      }
    }

    await supabase.from("sync_logs").insert({
      tipo: "sync_tiendanube",
      estado: "ok",
      detalle: {
        productos_procesados: products.length,
        productos_upsertados: productosUpsertados,
        variantes_upsertadas: variantesUpsertadas,
      },
    });

    return NextResponse.json({
      ok: true,
      productos_procesados: products.length,
      productos_upsertados: productosUpsertados,
      variantes_upsertadas: variantesUpsertadas,
    });
  } catch (err: any) {
    await supabase.from("sync_logs").insert({
      tipo: "sync_tiendanube",
      estado: "error",
      detalle: { error: String(err?.message ?? err) },
    });

    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
