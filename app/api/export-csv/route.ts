import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { formatPrecioCSV } from "@/lib/format";
import iconv from "iconv-lite";

/**
 * Genera un CSV en el formato exacto que usa Tienda Nube para
 * "actualización masiva de precios" (mismo separador ";" y
 * encoding Latin-1/ISO-8859-1 que exporta la plataforma).
 *
 * Tienda Nube solo necesita, como mínimo, las columnas:
 *   - Identificador de URL
 *   - Nombre de propiedad 1/2/3 + Valor de propiedad 1/2/3 (para identificar la variante)
 *   - Precio
 *   - Precio promocional
 *   - Costo
 *
 * Para minimizar errores al importar, se incluyen también Nombre y SKU
 * de referencia (Tienda Nube los ignora si no cambian, pero ayudan a
 * revisar el archivo antes de subirlo).
 */

const HEADERS = [
  "Identificador de URL",
  "Nombre",
  "Nombre de propiedad 1",
  "Valor de propiedad 1",
  "Nombre de propiedad 2",
  "Valor de propiedad 2",
  "Nombre de propiedad 3",
  "Valor de propiedad 3",
  "Precio",
  "Precio promocional",
  "SKU",
  "Costo",
];

function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[;"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("tn_variantes")
    .select(
      `
      precio, precio_promocional, costo, sku,
      prop1_nombre, prop1_valor, prop2_nombre, prop2_valor, prop3_nombre, prop3_valor,
      tn_productos ( handle, nombre )
    `
    )
    .order("producto_id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as any[];

  const lines: string[] = [];
  lines.push(HEADERS.map(csvEscape).join(";"));

  for (const r of rows) {
    const handle = r.tn_productos?.handle ?? "";
    const nombre = r.tn_productos?.nombre ?? "";

    // Solo la primera fila de cada producto lleva el Nombre (igual que el export de Tienda Nube)
    const row = [
      handle,
      nombre,
      r.prop1_nombre ?? "",
      r.prop1_valor ?? "",
      r.prop2_nombre ?? "",
      r.prop2_valor ?? "",
      r.prop3_nombre ?? "",
      r.prop3_valor ?? "",
      formatPrecioCSV(r.precio),
      formatPrecioCSV(r.precio_promocional),
      r.sku ?? "",
      formatPrecioCSV(r.costo),
    ];

    lines.push(row.map((v) => csvEscape(String(v))).join(";"));
  }

  const csvContent = lines.join("\r\n") + "\r\n";

  // Tienda Nube exporta en Latin-1 / ISO-8859-1
  const encoded = iconv.encode(csvContent, "latin1");
  const uint8Array = new Uint8Array(encoded);

  return new NextResponse(uint8Array, {
    headers: {
      "Content-Type": "text/csv; charset=iso-8859-1",
      "Content-Disposition": `attachment; filename="numa-precios-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
