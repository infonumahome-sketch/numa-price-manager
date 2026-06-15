import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * POST: crea un vínculo entre una variante propia y un producto MEKK.
 * Body: { variante_id: number, mekk_producto_id: number, cantidad?: number }
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
  const { variante_id, mekk_producto_id, cantidad } = body;

  if (!variante_id || !mekk_producto_id) {
    return NextResponse.json(
      { error: "Faltan variante_id o mekk_producto_id" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("vinculos")
    .upsert(
      {
        variante_id,
        mekk_producto_id,
        cantidad: cantidad ?? 1,
      },
      { onConflict: "variante_id,mekk_producto_id" }
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

  const { error } = await supabase.from("vinculos").delete().eq("id", vinculo_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
