-- ============================================================
-- Numa Home - Price Manager
-- Esquema de base de datos para Supabase (Postgres)
-- ============================================================

-- ------------------------------------------------------------
-- Extensiones útiles
-- ------------------------------------------------------------
create extension if not exists "pgcrypto"; -- para gen_random_uuid()
create extension if not exists "pg_trgm";   -- para búsqueda por similitud de texto (vinculación)


-- ============================================================
-- 1. PRODUCTOS PROPIOS (Numa Home / Tienda Nube)
-- ============================================================

-- Producto "padre" (corresponde a una fila sin variante o al
-- conjunto de filas que comparten el mismo "Identificador de URL")
create table if not exists tn_productos (
  id                bigserial primary key,
  tn_product_id     bigint unique,           -- ID numérico del producto en Tienda Nube (vía API)
  handle            text not null,           -- "Identificador de URL"
  nombre            text not null,
  categorias        text,
  marca             text,
  descripcion       text,
  tags              text,
  mostrar_en_tienda boolean default true,
  creado_en         timestamptz default now(),
  actualizado_en    timestamptz default now()
);

create index if not exists idx_tn_productos_handle on tn_productos (handle);
create index if not exists idx_tn_productos_nombre_trgm on tn_productos using gin (nombre gin_trgm_ops);


-- Variantes del producto (incluye el caso "sin variante": 1 fila)
create table if not exists tn_variantes (
  id                bigserial primary key,
  producto_id       bigint not null references tn_productos(id) on delete cascade,
  tn_variant_id     bigint unique,           -- ID numérico de la variante en Tienda Nube (vía API)

  -- Propiedades de variante (hasta 3, igual que el CSV de Tienda Nube)
  prop1_nombre      text,
  prop1_valor       text,
  prop2_nombre      text,
  prop2_valor       text,
  prop3_nombre      text,
  prop3_valor       text,

  sku               text,
  codigo_barras     text,

  -- Precios propios
  precio            numeric(14,2),           -- precio de venta actual
  precio_promocional numeric(14,2),
  costo             numeric(14,2),           -- costo de compra actual (lo que le pagamos al proveedor)

  -- Stock y medidas (útiles para exportar el CSV completo si hace falta)
  stock             integer,
  peso_kg           numeric(10,2),
  alto_cm           numeric(10,2),
  ancho_cm          numeric(10,2),
  profundidad_cm    numeric(10,2),

  creado_en         timestamptz default now(),
  actualizado_en    timestamptz default now()
);

create index if not exists idx_tn_variantes_producto on tn_variantes (producto_id);
create index if not exists idx_tn_variantes_sku on tn_variantes (sku);


-- Historial de precios propios (para llevar registro de cambios)
create table if not exists tn_historial_precios (
  id              bigserial primary key,
  variante_id     bigint not null references tn_variantes(id) on delete cascade,
  precio_anterior numeric(14,2),
  precio_nuevo    numeric(14,2),
  costo_anterior  numeric(14,2),
  costo_nuevo     numeric(14,2),
  origen          text,         -- 'manual', 'importacion_csv', 'sync_api', etc.
  creado_en       timestamptz default now()
);

create index if not exists idx_tn_historial_variante on tn_historial_precios (variante_id);


-- ============================================================
-- 2. PRODUCTOS DEL PROVEEDOR (MËKK Mayorista)
-- ============================================================

create table if not exists mekk_productos (
  id                bigserial primary key,
  nombre            text not null,
  categoria         text,
  link              text,              -- URL al producto en mekkmayorista.com.ar
  imagen_url        text,

  -- Precios obtenidos del scraper
  precio_mayorista  numeric(14,2),     -- precio de compra (sitio mayorista, sin IVA o con IVA según corresponda)
  precio_mayorista_sin_descuento numeric(14,2), -- precio "tachado" antes de descuento, si aplica
  precio_minorista  numeric(14,2),     -- precio de venta sugerido (sitio minorista de MEKK)

  -- Identificador estable para detectar duplicados entre corridas del scraper
  -- (lo armamos a partir del link o de nombre+categoria si no hay link)
  hash_identidad    text unique,

  activo            boolean default true,  -- false si ya no aparece en el sitio
  ultima_vez_visto  timestamptz default now(),
  creado_en         timestamptz default now(),
  actualizado_en    timestamptz default now()
);

create index if not exists idx_mekk_productos_nombre_trgm on mekk_productos using gin (nombre gin_trgm_ops);
create index if not exists idx_mekk_productos_categoria on mekk_productos (categoria);


-- Historial de precios de MEKK (para detectar variaciones del proveedor)
create table if not exists mekk_historial_precios (
  id                  bigserial primary key,
  producto_id         bigint not null references mekk_productos(id) on delete cascade,
  precio_mayorista    numeric(14,2),
  precio_minorista    numeric(14,2),
  creado_en           timestamptz default now()
);

create index if not exists idx_mekk_historial_producto on mekk_historial_precios (producto_id);


-- ============================================================
-- 3. VINCULACIÓN Numa <-> MEKK
-- ============================================================

-- Un producto/variante propio puede vincularse a uno o más
-- productos de MEKK (ej: un "set" propio = varios productos MEKK)
create table if not exists vinculos (
  id              bigserial primary key,
  variante_id     bigint not null references tn_variantes(id) on delete cascade,
  mekk_producto_id bigint not null references mekk_productos(id) on delete cascade,
  cantidad        numeric(10,2) default 1,  -- por si el producto propio usa más de 1 unidad del item MEKK
  notas           text,
  creado_en       timestamptz default now(),

  unique (variante_id, mekk_producto_id)
);

create index if not exists idx_vinculos_variante on vinculos (variante_id);
create index if not exists idx_vinculos_mekk on vinculos (mekk_producto_id);


-- ============================================================
-- 4. CONFIGURACIÓN / LOG DE SINCRONIZACIONES
-- ============================================================

create table if not exists sync_logs (
  id            bigserial primary key,
  tipo          text not null,        -- 'scraper_mekk', 'sync_tiendanube', 'export_csv'
  estado        text not null,        -- 'ok', 'error', 'parcial'
  detalle       jsonb,
  creado_en     timestamptz default now()
);


-- ============================================================
-- 5. VISTAS ÚTILES PARA EL PANEL
-- ============================================================

-- Vista "comparativa" principal: cada variante propia con su
-- vínculo MEKK (si existe) y los precios de ambos lados.
create or replace view v_comparativa as
select
  v.id                          as variante_id,
  p.id                          as producto_id,
  p.handle,
  p.nombre                      as producto_nombre,
  p.categorias,
  v.prop1_nombre, v.prop1_valor,
  v.prop2_nombre, v.prop2_valor,
  v.prop3_nombre, v.prop3_valor,
  v.sku,
  v.precio                      as precio_actual,
  v.precio_promocional          as precio_promocional_actual,
  v.costo                       as costo_actual,
  v.stock,

  vi.id                         as vinculo_id,
  vi.cantidad                   as vinculo_cantidad,
  mp.id                         as mekk_producto_id,
  mp.nombre                     as mekk_nombre,
  mp.categoria                  as mekk_categoria,
  mp.link                       as mekk_link,
  mp.imagen_url                 as mekk_imagen_url,
  mp.precio_mayorista           as mekk_precio_mayorista,
  mp.precio_minorista           as mekk_precio_minorista,
  mp.activo                     as mekk_activo,
  mp.actualizado_en             as mekk_actualizado_en,

  -- Diferencias útiles para detectar desactualizaciones
  case when vi.cantidad is not null and mp.precio_mayorista is not null
    then (mp.precio_mayorista * vi.cantidad) - coalesce(v.costo, 0)
    else null
  end as diferencia_costo,

  case when mp.precio_minorista is not null
    then mp.precio_minorista - coalesce(v.precio, 0)
    else null
  end as diferencia_precio_sugerido

from tn_variantes v
join tn_productos p on p.id = v.producto_id
left join vinculos vi on vi.variante_id = v.id
left join mekk_productos mp on mp.id = vi.mekk_producto_id;


-- Vista de productos MEKK sin vincular (para facilitar la vinculación manual)
create or replace view v_mekk_sin_vincular as
select mp.*
from mekk_productos mp
left join vinculos vi on vi.mekk_producto_id = mp.id
where vi.id is null and mp.activo = true;


-- ============================================================
-- 6. TRIGGERS - actualizar "actualizado_en" automáticamente
-- ============================================================

create or replace function set_actualizado_en()
returns trigger as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tn_productos_upd on tn_productos;
create trigger trg_tn_productos_upd before update on tn_productos
  for each row execute function set_actualizado_en();

drop trigger if exists trg_tn_variantes_upd on tn_variantes;
create trigger trg_tn_variantes_upd before update on tn_variantes
  for each row execute function set_actualizado_en();

drop trigger if exists trg_mekk_productos_upd on mekk_productos;
create trigger trg_mekk_productos_upd before update on mekk_productos
  for each row execute function set_actualizado_en();


-- ============================================================
-- 7. TRIGGER - registrar historial de precios propios al actualizar
-- ============================================================

create or replace function registrar_historial_precio()
returns trigger as $$
begin
  if (old.precio is distinct from new.precio) or (old.costo is distinct from new.costo) then
    insert into tn_historial_precios (variante_id, precio_anterior, precio_nuevo, costo_anterior, costo_nuevo, origen)
    values (new.id, old.precio, new.precio, old.costo, new.costo, 'actualizacion');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tn_variantes_historial on tn_variantes;
create trigger trg_tn_variantes_historial before update on tn_variantes
  for each row execute function registrar_historial_precio();


-- ============================================================
-- 8. TRIGGER - registrar historial de precios MEKK al actualizar
-- ============================================================

create or replace function registrar_historial_mekk()
returns trigger as $$
begin
  if (old.precio_mayorista is distinct from new.precio_mayorista)
     or (old.precio_minorista is distinct from new.precio_minorista) then
    insert into mekk_historial_precios (producto_id, precio_mayorista, precio_minorista)
    values (new.id, new.precio_mayorista, new.precio_minorista);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_mekk_productos_historial on mekk_productos;
create trigger trg_mekk_productos_historial before update on mekk_productos
  for each row execute function registrar_historial_mekk();


-- ============================================================
-- 9. ROW LEVEL SECURITY
--    (uso privado: solo usuarios autenticados pueden leer/escribir)
-- ============================================================

alter table tn_productos enable row level security;
alter table tn_variantes enable row level security;
alter table tn_historial_precios enable row level security;
alter table mekk_productos enable row level security;
alter table mekk_historial_precios enable row level security;
alter table vinculos enable row level security;
alter table sync_logs enable row level security;

-- Política simple: cualquier usuario autenticado (logueado en la app) puede hacer todo.
-- Esto asume que solo Charly y Justi tendrán usuarios creados en Supabase Auth.

create policy "auth_all_tn_productos" on tn_productos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth_all_tn_variantes" on tn_variantes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth_all_tn_historial" on tn_historial_precios
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth_all_mekk_productos" on mekk_productos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth_all_mekk_historial" on mekk_historial_precios
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth_all_vinculos" on vinculos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "auth_all_sync_logs" on sync_logs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- NOTA: el scraper (GitHub Actions) y la sync de Tienda Nube van a usar
-- la "service_role key" de Supabase, que ignora RLS por completo.
-- Por eso esa key NUNCA debe usarse en el frontend, solo en backend/scripts.
