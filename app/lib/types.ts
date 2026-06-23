export type Comparativa = {
  variante_id: number;
  producto_id: number;
  handle: string;
  producto_nombre: string;
  categorias: string | null;
  prop1_nombre: string | null;
  prop1_valor: string | null;
  prop2_nombre: string | null;
  prop2_valor: string | null;
  prop3_nombre: string | null;
  prop3_valor: string | null;
  sku: string | null;
  precio_actual: number | null;
  precio_promocional_actual: number | null;
  costo_actual: number | null;
  stock: number | null;

  vinculo_id: number | null;
  vinculo_cantidad: number | null;
  mekk_producto_id: number | null;
  mekk_nombre: string | null;
  mekk_categoria: string | null;
  mekk_link: string | null;
  mekk_imagen_url: string | null;
  mekk_precio_mayorista: number | null;
  mekk_precio_minorista: number | null;
  mekk_activo: boolean | null;
  mekk_actualizado_en: string | null;

  diferencia_costo: number | null;
  diferencia_precio_sugerido: number | null;
};

export type MekkProducto = {
  id: number;
  nombre: string;
  categoria: string | null;
  link: string | null;
  imagen_url: string | null;
  precio_mayorista: number | null;
  precio_mayorista_sin_descuento: number | null;
  precio_minorista: number | null;
  activo: boolean;
  ultima_vez_visto: string;
  actualizado_en: string;
};

export type VarianteConProducto = {
  id: number;
  producto_id: number;
  prop1_nombre: string | null;
  prop1_valor: string | null;
  prop2_nombre: string | null;
  prop2_valor: string | null;
  prop3_nombre: string | null;
  prop3_valor: string | null;
  sku: string | null;
  precio: number | null;
  precio_promocional: number | null;
  costo: number | null;
  stock: number | null;
  tn_productos: {
    id: number;
    handle: string;
    nombre: string;
    categorias: string | null;
  };
};
