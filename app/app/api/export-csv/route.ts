import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import iconv from "iconv-lite";

/**
 * Genera un CSV en el formato exacto de Tienda Nube (importación/exportación masiva).
 * Separador: ";"  |  Encoding: ISO-8859-1 (Latin-1)
 * Solo la primera variante de cada producto lleva los campos del producto (Nombre, Categorías, etc.)
 */

const HEADERS = [
  "Identificador de URL",
  "Nombre",
  "Categorías",
  "Nombre de propiedad 1",
  "Valor de propiedad 1",
  "Nombre de propiedad 2",
  "Valor de propiedad 2",
  "Nombre de propiedad 3",
  "Valor de propiedad 3",
  "Precio",
  "Precio promocional",
  "Peso (kg)",
  "Alto (cm)",
  "Ancho (cm)",
  "Profundidad (cm)",
  "Stock",
  "SKU",
  "Código de barras",
  "Mostrar en tienda",
  "Envío sin cargo",
  "Descripción",
  "Tags",
  "Título para SEO",
  "Descripción para SEO",
  "Marca",
  "Producto Físico",
  "MPN (Número de pieza del fabricante)",
  "Sexo",
  "Rango de edad",
  "Costo",
];

function formatPrecio(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined) return "0.00";
  return value.toFixed(2);
}

function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[;"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("tn_variantes")
    .select(
      `
      precio, precio_promocional, costo, sku, codigo_barras, stock,
      peso_kg, alto_cm, ancho_cm, profundidad_cm,
      prop1_nombre, prop1_valor,
      prop2_nombre, prop2_valor,
      prop3_nombre, prop3_valor,
      tn_productos (
        handle, nombre, categorias, marca, descripcion, tags, mostrar_en_tienda
      )
    `
    )
    .order("producto_id", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as any[];

  // Rastrea qué productos ya tuvieron su primera fila (para dejar vacíos los campos de producto en las siguientes)
  const productosVistos = new Set<string>();

  const lines: string[] = [];
  lines.push(HEADERS.map(csvEscape).join(";"));

  for (const r of rows) {
    const handle = r.tn_productos?.handle ?? "";
    const esPrimera = !productosVistos.has(handle);
    if (handle) productosVistos.add(handle);

    const p = r.tn_productos;

    const row = [
      // Identificador de URL
      handle,
      // Nombre — solo primera variante
      esPrimera ? (p?.nombre ?? "") : "",
      // Categorías — solo primera variante
      esPrimera ? (p?.categorias ?? "") : "",
      // Propiedades de variante
      r.prop1_nombre ?? "",
      r.prop1_valor ?? "",
      r.prop2_nombre ?? "",
      r.prop2_valor ?? "",
      r.prop3_nombre ?? "",
      r.prop3_valor ?? "",
      // Precio
      formatPrecio(r.precio),
      // Precio promocional
      formatPrecio(r.precio_promocional),
      // Dimensiones y peso
      formatDecimal(r.peso_kg),
      formatDecimal(r.alto_cm),
      formatDecimal(r.ancho_cm),
      formatDecimal(r.profundidad_cm),
      // Stock
      r.stock !== null && r.stock !== undefined ? String(r.stock) : "",
      // SKU
      r.sku ?? "",
      // Código de barras
      r.codigo_barras ?? "",
      // Mostrar en tienda — solo primera variante
      esPrimera ? (p?.mostrar_en_tienda === false ? "NO" : "SI") : "",
      // Envío sin cargo — no está en DB, se deja vacío
      esPrimera ? "NO" : "",
      // Descripción — solo primera variante
      esPrimera ? (p?.descripcion ?? "") : "",
      // Tags — solo primera variante
      esPrimera ? (p?.tags ?? "") : "",
      // Título para SEO — no está en DB, vacío
      "",
      // Descripción para SEO — no está en DB, vacío
      "",
      // Marca — solo primera variante
      esPrimera ? (p?.marca ?? "") : "",
      // Producto Físico — no está en DB, vacío
      esPrimera ? "SI" : "",
      // MPN — no está en DB, vacío
      "",
      // Sexo — no está en DB, vacío
      "",
      // Rango de edad — no está en DB, vacío
      "",
      // Costo
      formatPrecio(r.costo),
    ];

    lines.push(row.map((v) => csvEscape(String(v))).join(";"));
  }

  const csvContent = lines.join("\r\n") + "\r\n";

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
