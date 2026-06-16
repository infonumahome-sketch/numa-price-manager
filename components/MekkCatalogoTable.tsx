"use client";

import { formatARS } from "@/lib/format";
import type { MekkProducto } from "@/lib/types";
import VincularButton from "./VincularButton";

type MekkCatalogoTableProps = {
  productos: MekkProducto[];
  tipo: "mayorista" | "minorista";
  opcionesVinculo: Array<{ id: number; label: string }>;
  error?: any;
};

export default function MekkCatalogoTable({
  productos,
  tipo,
  opcionesVinculo,
  error,
}: MekkCatalogoTableProps) {
  const titulos = {
    mayorista: "Catálogo MËKK Mayorista",
    minorista: "Catálogo MËKK Minorista",
  };

  const subtitulos = {
    mayorista:
      "Precios de compra mayorista. Vincula tus productos para obtener el costo.",
    minorista:
      "Precios de venta al público. Vincula para usar como referencia de precio sugerido.",
  };

  const columnasPrecio = {
    mayorista: "Precio mayorista",
    minorista: "Precio minorista",
  };

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-numa-900">{titulos[tipo]}</h1>
        <p className="text-sm text-numa-600">
          {productos.length} productos relevados. {subtitulos[tipo]}
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
              <th className="px-3 py-2 text-right">{columnasPrecio[tipo]}</th>
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
                <td className="px-3 py-2 text-right">
                  {tipo === "mayorista"
                    ? formatARS(p.precio_mayorista)
                    : formatARS(p.precio_minorista)}
                </td>
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
                  <VincularButton
                    mekkProductoId={p.id}
                    tipo={tipo}
                    opciones={opcionesVinculo}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {productos.length === 0 && !error && (
          <p className="px-3 py-6 text-center text-sm text-numa-400">
            No hay productos con precios de {tipo} cargados todavía.
          </p>
        )}
      </div>
    </div>
  );
}
