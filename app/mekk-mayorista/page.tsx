import { createClient } from "@/lib/supabase/server";
import NavBar from "@/components/NavBar";
import type { MekkProducto } from "@/lib/types";
import MekkCatalogoTable from "@/components/MekkCatalogoTable";

export const dynamic = "force-dynamic";

export default async function MekkMayoristaPage() {
  const supabase = createClient();

  // Traer SOLO productos con precio mayorista
  const { data, error } = await supabase
    .from("mekk_productos_mayorista")
    .select("*")
    .order("categoria", { ascending: true })
    .order("nombre", { ascending: true });

  const productos = (data ?? []) as MekkProducto[];

  // Productos propios (para el selector de vinculación)
  const { data: variantesData } = await supabase
    .from("tn_variantes")
    .select("id, prop1_valor, prop2_valor, prop3_valor, sku, tn_productos ( nombre )")
    .order("id");

  const opcionesVinculo = (variantesData ?? []).map((v: any) => {
    const variante = [v.prop1_valor, v.prop2_valor, v.prop3_valor]
      .filter(Boolean)
      .join(" / ");
    const label = `${v.tn_productos?.nombre}${variante ? " — " + variante : ""}${v.sku ? " (" + v.sku + ")" : ""}`;
    return { id: v.id, label };
  });

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <MekkCatalogoTable
          productos={productos}
          tipo="mayorista"
          opcionesVinculo={opcionesVinculo}
          error={error}
        />
      </main>
    </div>
  );
}
