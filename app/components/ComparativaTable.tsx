"use client";

import { useMemo, useState } from "react";
import type { Comparativa } from "@/lib/types";
import { formatARS, nombreVariante } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type Filtro = "todos" | "vinculados" | "sin_vincular" | "desactualizados";

export default function ComparativaTable({ rows }: { rows: Comparativa[] }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState<Record<number, { precio: string; costo: string }>>({});
  const [guardando, setGuardando] = useState<number | null>(null);
  const supabase = createClient();

  const filtradas = useMemo(() => {
    return rows.filter((r) => {
      if (busqueda.trim()) {
        const q = busqueda.toLowerCase();
        const matches =
          r.producto_nombre.toLowerCase().includes(q) ||
          (r.sku ?? "").toLowerCase().includes(q) ||
          (r.mekk_minorista_nombre ?? "").toLowerCase().includes(q) ||
          (r.mekk_mayorista_nombre ?? "").toLowerCase().includes(q);
        if (!matches) return false;
      }

      if (filtro === "vinculados") return r.vinculo_id !== null;
      if (filtro === "sin_vincular") return r.vinculo_id === null;
      if (filtro === "desactualizados") {
        return (
          (r.diferencia_costo !== null && Math.abs(r.diferencia_costo) > 1) ||
          (r.diferencia_precio_sugerido !== null && Math.abs(r.diferencia_precio_sugerido) > 1)
        );
      }
      return true;
    });
  }, [rows, filtro, busqueda]);

  function startEdit(r: Comparativa) {
    setEditando((prev) => ({
      ...prev,
      [r.variante_id]: {
        precio: r.precio_actual?.toString() ?? "",
        costo: r.costo_actual?.toString() ?? "",
      },
    }));
  }

  function cancelEdit(varianteId: number) {
    setEditando((prev) => {
      const copy = { ...prev };
      delete copy[varianteId];
      return copy;
    });
  }

  async function saveEdit(varianteId: number) {
    const valores = editando[varianteId];
    if (!valores) return;
    setGuardando(varianteId);
    const precio = valores.precio === "" ? null : Number(valores.precio);
    const costo = valores.costo === "" ? null : Number(valores.costo);
    const { error } = await supabase
      .from("tn_variantes")
      .update({ precio, costo })
      .eq("id", varianteId);
    setGuardando(null);
    if (error) {
      alert("Error al guardar: " + error.message);
      return;
    }
    cancelEdit(varianteId);
    window.location.reload();
  }

  function difColor(val: number | null) {
    if (val === null) return "text-numa-400";
    if (Math.abs(val) <= 1) return "text-numa-400";
    return val > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium";
  }

  function difTexto(val: number | null) {
    if (val === null) return "—";
    return (val > 0 ? "+" : "") + formatARS(val);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Buscar por nombre, SKU o producto MËKK..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-72 rounded-md border border-numa-200 px-3 py-1.5 text-sm focus:border-numa-500 focus:outline-none"
        />
        <div className="flex gap-1 text-sm">
          {(
            [
              ["todos", "Todos"],
              ["vinculados", "Vinculados"],
              ["sin_vincular", "Sin vincular"],
              ["desactualizados", "Desactualizados"],
            ] as [Filtro, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFiltro(value)}
              className={`rounded-md px-3 py-1.5 ${
                filtro === value
                  ? "bg-numa-700 text-white"
                  : "border border-numa-200 text-numa-600 hover:bg-numa-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm text-numa-500">
          {filtradas.length} de {rows.length} variantes
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-numa-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-numa-50 text-left text-xs uppercase text-numa-500">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Variante / SKU</th>
              <th className="px-3 py-2 text-right">Costo actual</th>
              <th className="px-3 py-2 text-right">Precio actual</th>
              {/* Mayorista */}
              <th className="border-l border-numa-200 px-3 py-2">Mayorista vinculado</th>
              <th className="px-3 py-2 text-right">Precio mayorista</th>
              <th className="px-3 py-2 text-right">Dif.</th>
              {/* Minorista */}
              <th className="border-l border-numa-200 px-3 py-2">Minorista vinculado</th>
              <th className="px-3 py-2 text-right">Precio minorista</th>
              <th className="px-3 py-2 text-right">Dif.</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((r) => {
              const edicion = editando[r.variante_id];
              const variante = nombreVariante(r);
              const desactualizado =
                (r.diferencia_costo !== null && Math.abs(r.diferencia_costo) > 1) ||
                (r.diferencia_precio_sugerido !== null && Math.abs(r.diferencia_precio_sugerido) > 1);

              return (
                <tr
                  key={r.variante_id}
                  className={`border-t border-numa-100 ${desactualizado ? "bg-amber-50" : ""}`}
                >
                  {/* Producto */}
                  <td className="px-3 py-2">
                    <div className="font-medium text-numa-900">{r.producto_nombre}</div>
                    <div className="text-xs text-numa-400">{r.categorias}</div>
                  </td>

                  {/* Variante / SKU */}
                  <td className="px-3 py-2">
                    {variante && <div>{variante}</div>}
                    <div className="text-xs text-numa-400">{r.sku || "—"}</div>
                  </td>

                  {/* Costo actual */}
                  <td className="px-3 py-2 text-right">
                    {edicion ? (
                      <input
                        type="number"
                        step="0.01"
                        value={edicion.costo}
                        onChange={(e) =>
                          setEditando((prev) => ({
                            ...prev,
                            [r.variante_id]: { ...prev[r.variante_id], costo: e.target.value },
                          }))
                        }
                        className="w-28 rounded border border-numa-200 px-2 py-1 text-right text-sm"
                      />
                    ) : (
                      formatARS(r.costo_actual)
                    )}
                  </td>

                  {/* Precio actual */}
                  <td className="px-3 py-2 text-right">
                    {edicion ? (
                      <input
                        type="number"
                        step="0.01"
                        value={edicion.precio}
                        onChange={(e) =>
                          setEditando((prev) => ({
                            ...prev,
                            [r.variante_id]: { ...prev[r.variante_id], precio: e.target.value },
                          }))
                        }
                        className="w-28 rounded border border-numa-200 px-2 py-1 text-right text-sm"
                      />
                    ) : (
                      <span className="font-medium">{formatARS(r.precio_actual)}</span>
                    )}
                  </td>

                  {/* Mayorista vinculado */}
                  <td className="border-l border-numa-200 px-3 py-2">
                    {r.mekk_mayorista_nombre ? (
                      <div>
                        <div className="text-numa-900">{r.mekk_mayorista_nombre}</div>
                        {r.mekk_mayorista_link && (
                          <a
                            href={r.mekk_mayorista_link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Ver en MËKK ↗
                          </a>
                        )}
                        {r.mekk_mayorista_activo === false && (
                          <div className="text-xs text-red-500">⚠ Ya no aparece en el sitio</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-numa-400">Sin vincular</span>
                    )}
                  </td>

                  {/* Precio mayorista */}
                  <td className="px-3 py-2 text-right">
                    {formatARS(r.mekk_precio_mayorista)}
                  </td>

                  {/* Dif. mayorista (vs costo actual) */}
                  <td className="px-3 py-2 text-right">
                    <span className={difColor(r.diferencia_costo)}>
                      {difTexto(r.diferencia_costo)}
                    </span>
                  </td>

                  {/* Minorista vinculado */}
                  <td className="border-l border-numa-200 px-3 py-2">
                    {r.mekk_minorista_nombre ? (
                      <div>
                        <div className="text-numa-900">{r.mekk_minorista_nombre}</div>
                        {r.mekk_minorista_link && (
                          <a
                            href={r.mekk_minorista_link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Ver en MËKK ↗
                          </a>
                        )}
                        {r.mekk_minorista_activo === false && (
                          <div className="text-xs text-red-500">⚠ Ya no aparece en el sitio</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-numa-400">Sin vincular</span>
                    )}
                  </td>

                  {/* Precio minorista */}
                  <td className="px-3 py-2 text-right">
                    {formatARS(r.mekk_precio_minorista)}
                  </td>

                  {/* Dif. minorista (vs precio actual) */}
                  <td className="px-3 py-2 text-right">
                    <span className={difColor(r.diferencia_precio_sugerido)}>
                      {difTexto(r.diferencia_precio_sugerido)}
                    </span>
                  </td>

                  {/* Editar */}
                  <td className="px-3 py-2 text-right">
                    {edicion ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => saveEdit(r.variante_id)}
                          disabled={guardando === r.variante_id}
                          className="rounded bg-numa-700 px-2 py-1 text-xs text-white hover:bg-numa-900 disabled:opacity-60"
                        >
                          {guardando === r.variante_id ? "..." : "Guardar"}
                        </button>
                        <button
                          onClick={() => cancelEdit(r.variante_id)}
                          className="rounded border border-numa-200 px-2 py-1 text-xs text-numa-600 hover:bg-numa-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(r)}
                        className="rounded border border-numa-200 px-2 py-1 text-xs text-numa-600 hover:bg-numa-50"
                      >
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtradas.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-numa-400">
            No hay resultados para este filtro.
          </p>
        )}
      </div>
    </div>
  );
}
