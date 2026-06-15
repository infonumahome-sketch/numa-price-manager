import { createClient } from "@/lib/supabase/server";
import NavBar from "@/components/NavBar";
import { formatARS } from "@/lib/format";
import type { MekkProducto } from "@/lib/types";
import VincularButton from "@/components/VincularButton";

export const dynamic = "force-dynamic";

export default async function MekkPage() {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("mekk_productos")
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
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-numa-900">
            Catálogo MËKK Mayorista
          </h1>
          <p className="text-sm text-numa-600">
            {productos.length} productos relevados. Los productos inactivos
            ya no figuran en el sitio del proveedor.
          </p>
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
                <th className="px-3 py-2">Producto MËKK</th>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2 text-right">Precio mayorista</th>
                <th className="px-3 py-2 text-right">Precio minorista</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Vincular a producto propio</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id} className="border-t border-numa-100">
                  <td className="px-3 py-2">
                    <div className="font-medium text-numa-900">{p.nombre}</div>
                    {p.link && (
                      <a
                        href={p.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Ver en MËKK ↗
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-numa-500">{p.categoria || "—"}</td>
                  <td className="px-3 py-2 text-right">{formatARS(p.precio_mayorista)}</td>
                  <td className="px-3 py-2 text-right">{formatARS(p.precio_minorista)}</td>
                  <td className="px-3 py-2">
                    {p.activo ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        Activo
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <VincularButton mekkProductoId={p.id} opciones={opcionesVinculo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {productos.length === 0 && !error && (
            <p className="px-3 py-6 text-center text-sm text-numa-400">
              No hay productos cargados todavía. Corré el scraper de MËKK
              (ver scraper/README.md).
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
