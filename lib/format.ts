export function formatARS(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(value);
}

export function nombreVariante(v: {
  prop1_nombre?: string | null;
  prop1_valor?: string | null;
  prop2_nombre?: string | null;
  prop2_valor?: string | null;
  prop3_nombre?: string | null;
  prop3_valor?: string | null;
}): string | null {
  const partes: string[] = [];
  if (v.prop1_valor) partes.push(v.prop1_valor);
  if (v.prop2_valor) partes.push(v.prop2_valor);
  if (v.prop3_valor) partes.push(v.prop3_valor);
  return partes.length ? partes.join(" / ") : null;
}

/**
 * Parsea un precio en formato argentino del CSV de Tienda Nube,
 * ej: "31,000.00" -> 31000.00
 * (en el CSV, la coma es separador de miles y el punto es decimal)
 */
export function parsePrecioCSV(value: string | undefined | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Formatea un número como precio para el CSV de Tienda Nube
 * ej: 31000 -> "31,000.00"
 */
export function formatPrecioCSV(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
