import { createClient } from "@/lib/supabase/server";
import NavBar from "@/components/NavBar";
import type { Comparativa } from "@/lib/types";
import ComparativaTable from "@/components/ComparativaTable";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("v_comparativa")
    .select("*")
    .order("producto_nombre", { ascending: true });

  const comparativa = (data ?? []) as Comparativa[];

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-numa-900">
            Comparativa de precios
          </h1>
          <p className="text-sm text-numa-600">
            Tus productos junto a los precios del proveedor MËKK (cuando
            están vinculados). Usá esta vista para detectar qué precios
            actualizar.
          </p>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Error cargando datos: {error.message}
          </p>
        )}

        <ComparativaTable rows={comparativa} />
      </main>
    </div>
  );
}
