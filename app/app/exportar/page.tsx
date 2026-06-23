import NavBar from "@/components/NavBar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ExportarPage() {
  const supabase = createClient();
  const { count } = await supabase
    .from("tn_variantes")
    .select("*", { count: "exact", head: true });

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-2 text-xl font-semibold text-numa-900">
          Exportar CSV para Tienda Nube
        </h1>
        <p className="mb-6 text-sm text-numa-600">
          Genera un CSV con el mismo formato (separador <code>;</code> y
          codificación) que usa Tienda Nube, con los precios y costos
          actuales guardados en este panel ({count ?? 0} variantes). Subilo
          desde Tienda Nube en <strong>Productos → Importar/Exportar →
          Actualización masiva</strong>.
        </p>

        <a
          href="/api/export-csv"
          className="inline-block rounded-md bg-numa-700 px-4 py-2 text-sm font-medium text-white hover:bg-numa-900"
        >
          Descargar CSV actualizado
        </a>

        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">⚠️ Antes de subir el archivo a Tienda Nube:</p>
          <ul className="ml-5 mt-2 list-disc space-y-1">
            <li>
              Revisá el archivo abierto en Excel/Sheets: las columnas{" "}
              <strong>Precio</strong>, <strong>Precio promocional</strong> y{" "}
              <strong>Costo</strong> deben tener el formato correcto (ej:{" "}
              <code>31,000.00</code>).
            </li>
            <li>
              No modifiques la columna <strong>Identificador de URL</strong>{" "}
              ni las propiedades de variante, son las que usa Tienda Nube
              para identificar qué producto/variante actualizar.
            </li>
            <li>
              Hacé una prueba con pocos productos la primera vez para
              confirmar que el formato se importa correctamente.
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
