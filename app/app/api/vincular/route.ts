import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * POST: crea un vínculo entre una variante propia y un producto MEKK.
 * Body: { variante_id: number, mekk_producto_id: number, tipo_mekk: "mayorista" | "minorista" }
 *
 * DELETE: elimina un vínculo existente.
 * Body: { vinculo_id: number }
 */

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json();
  const { variante_id, mekk_producto_id, tipo_mekk = "mayorista" } = body;

  if (!variante_id || !mekk_producto_id) {
    return NextResponse.json(
      { error: "Faltan variante_id o mekk_producto_id" },
      { status: 400 }
    );
  }

  if (!["mayorista", "minorista"].includes(tipo_mekk)) {
    return NextResponse.json(
      { error: "tipo_mekk debe ser 'mayorista' o 'minorista'" },
      { status: 400 }
    );
  }

  // Obtener producto_numa_id desde la variante
  const { data: varianteData, error: varianteError } = await supabase
    .from("tn_variantes")
    .select("producto_id")
    .eq("id", variante_id)
    .single();

  if (varianteError || !varianteData) {
    return NextResponse.json(
      { error: "Variante no encontrada" },
      { status: 404 }
    );
  }

  const { data, error } = await supabase
    .from("producto_mekk_link")
    .upsert(
      {
        producto_numa_id: varianteData.producto_id,
        mekk_producto_id,
        tipo_mekk,
      },
      { onConflict: "producto_numa_id,tipo_mekk" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, vinculo: data });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json();
  const { vinculo_id } = body;

  if (!vinculo_id) {
    return NextResponse.json({ error: "Falta vinculo_id" }, { status: 400 });
  }

  const { error } = await supabase.from("producto_mekk_link").delete().eq("id", vinculo_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
