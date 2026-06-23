import { createClient } from "@/lib/supabase/server";
import NavBar from "@/components/NavBar";
import SyncButton from "@/components/SyncButton";
import { formatARS } from "@/lib/format";
import type { VarianteConProducto } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProductosPage() {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("tn_variantes")
    .select(
      `
      id, producto_id, prop1_nombre, prop1_valor, prop2_nombre, prop2_valor,
      prop3_nombre, prop3_valor, sku, precio, precio_promocional, costo, stock,
      tn_productos ( id, handle, nombre, categorias )
    `
    )
    .order("producto_id", { ascending: true });

  const variantes = (data ?? []) as unknown as VarianteConProducto[];

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-numa-900">
              Mis productos (Tienda Nube)
            </h1>
            <p className="text-sm text-numa-600">
              {variantes.length} variantes cargadas. Sincronizá para traer
              los últimos precios, costos y stock desde tu tienda.
            </p>
          </div>
          <SyncButton />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Error cargando datos: {error.message}
          </p>
        )}

        <div className="overflow-x-auto rounded-lg border border-numa-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-numa-50 text-left text-xs uppercase text-numa-500">
              <tr>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Variante</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2 text-right">Costo</th>
                <th className="px-3 py-2 text-right">Precio</th>
                <th className="px-3 py-2 text-right">Precio promo</th>
                <th className="px-3 py-2 text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {variantes.map((v) => {
                const variante = [v.prop1_valor, v.prop2_valor, v.prop3_valor]
                  .filter(Boolean)
                  .join(" / ");
                return (
                  <tr key={v.id} className="border-t border-numa-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-numa-900">
                        {v.tn_productos?.nombre}
                      </div>
                      <div className="text-xs text-numa-400">
                        {v.tn_productos?.categorias}
                      </div>
                    </td>
                    <td className="px-3 py-2">{variante || "—"}</td>
                    <td className="px-3 py-2 text-numa-500">{v.sku || "—"}</td>
                    <td className="px-3 py-2 text-right">{formatARS(v.costo)}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatARS(v.precio)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatARS(v.precio_promocional)}
                    </td>
                    <td className="px-3 py-2 text-right">{v.stock ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {variantes.length === 0 && !error && (
            <p className="px-3 py-6 text-center text-sm text-numa-400">
              No hay productos cargados todavía. Hacé click en
              &quot;Sincronizar con Tienda Nube&quot;.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
