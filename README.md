# Numa Home — Gestor de Precios

Panel privado para gestionar los precios de Numa Home (numahome.com.ar),
compararlos con el catálogo del proveedor MËKK (mayorista y minorista),
y exportar actualizaciones masivas en formato Tienda Nube.

## Estructura del proyecto

```
numa-price-manager/
├── supabase/
│   └── schema.sql          # Esquema completo de la base de datos
├── app/                     # App Next.js (panel privado)
├── scraper/
│   ├── mekk_scraper_v4.py   # Scraper MEKK mayorista + minorista
│   └── requirements.txt
└── .github/workflows/
    └── scraper-mekk.yml     # Cron job (GitHub Actions)
```

---

# GUÍA PASO A PASO

Vamos a hacerlo en este orden: Supabase → API de Tienda Nube → correr el
panel local → Vercel → scraper de MËKK. Cada paso depende del anterior,
así que conviene seguir el orden.

## PASO 1 — Crear el proyecto en Supabase

1. Entrar a [supabase.com](https://supabase.com) → crear cuenta (gratis)
   → **New project**.
   - Elegir un nombre (ej: `numa-price-manager`) y una contraseña para
     la base (guardarla, no se usa en el día a día pero por si acaso).
   - Región: cualquiera cercana (ej: South America - São Paulo).
2. Esperar a que el proyecto termine de crearse (1-2 minutos).
3. Ir a **SQL Editor** (ícono de la izquierda) → **New query**.
4. Abrir el archivo `supabase/schema.sql` de este proyecto, copiar TODO
   el contenido, pegarlo en el editor de Supabase, y darle **Run**.
   - Si todo sale bien, no debería tirar errores. Esto crea todas las
     tablas, vistas y reglas de seguridad.
5. Ir a **Project Settings** (ícono de engranaje, abajo a la izquierda)
   → **API**. Ahí vas a ver tres datos importantes, anotalos:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **anon public** key (una clave larga)
   - **service_role** key (otra clave larga — esta es secreta, no la
     compartas ni la subas a GitHub en texto plano)
6. Crear los usuarios del panel: ir a **Authentication → Users → Add
   user**.
   - Crear un usuario para vos (Charly) con tu email y una contraseña.
   - Crear otro para Justi, igual.
   - Tildar "Auto Confirm User" si aparece la opción (para no tener que
     confirmar por mail).

✅ **Checkpoint**: tenés un proyecto Supabase con las tablas creadas y
2 usuarios para loguearse al panel.

---

## PASO 2 — Conseguir el Access Token de Tienda Nube

1. Entrar a [partners.tiendanube.com](https://partners.tiendanube.com)
   y crear una cuenta (gratis), usando preferentemente el mismo email
   con el que administran numahome.com.ar.
2. Una vez dentro, buscar la opción para crear una **App / Aplicación
   nueva**.
   - Nombre: algo como "Numa Price Manager".
   - Tipo: aplicación privada (para uso propio, no para publicar en el
     marketplace).
   - Permisos (scopes) a solicitar: lectura y escritura de **productos**
     (en la consola de partners suele verse como `read_products` y
     `write_products`).
3. Una vez creada la app, va a darte una URL de instalación. Entrar a
   esa URL logueado como administrador de numahome.com.ar y autorizar
   la app sobre la tienda.
4. Después de autorizar, el sistema te va a dar (o te va a dejar ver en
   el panel de partners) un **Access Token** para esa tienda, y vas a
   poder confirmar el **Store ID** (según tu CSV es `6591575`).
5. Anotar:
   - `TIENDANUBE_STORE_ID=6591575`
   - `TIENDANUBE_ACCESS_TOKEN=<el token>`

> Documentación oficial (por si algún paso de la interfaz cambió):
> https://dev.tiendanube.com/docs/api

Si en algún punto de este paso te trabás con la interfaz de Tienda
Nube/Partners, pasame capturas de pantalla y te guío con lo que veas en
pantalla.

✅ **Checkpoint**: tenés `TIENDANUBE_STORE_ID` y `TIENDANUBE_ACCESS_TOKEN`.

---

## PASO 3 — Configurar variables de entorno

1. Dentro de la carpeta `app/`, copiar el archivo `.env.local.example` y
   renombrar la copia a `.env.local`.
2. Completar cada variable:

   ```
   NEXT_PUBLIC_SUPABASE_URL=         # "Project URL" del paso 1
   NEXT_PUBLIC_SUPABASE_ANON_KEY=    # "anon public" del paso 1
   SUPABASE_SERVICE_ROLE_KEY=        # "service_role" del paso 1

   TIENDANUBE_STORE_ID=6591575
   TIENDANUBE_ACCESS_TOKEN=          # del paso 2
   TIENDANUBE_USER_AGENT="Numa Price Manager (contacto@numahome.com.ar)"

   INTERNAL_API_TOKEN=               # generar uno random, ver abajo
   ```

3. Para generar `INTERNAL_API_TOKEN`, correr en una terminal:
   ```bash
   openssl rand -hex 32
   ```
   (Si no tenés `openssl`, cualquier string random largo de 40+
   caracteres sirve. Es solo una "contraseña" para que el scraper pueda
   hablar con el panel.)

✅ **Checkpoint**: archivo `app/.env.local` completo con 7 variables.

---

## PASO 4 — Correr el panel localmente (primera prueba)

Necesitás tener [Node.js](https://nodejs.org) instalado (versión 18 o
mayor).

1. Abrir una terminal en la carpeta `app/`:
   ```bash
   cd app
   npm install
   npm run dev
   ```
2. Abrir el navegador en http://localhost:3000
3. Te debería redirigir a `/login`. Iniciar sesión con el email y
   contraseña de Charly que creaste en el paso 1 (Supabase Auth).
4. Una vez logueado, vas a ver el panel pero sin productos todavía.
5. Ir a **"Mis productos"** → click en **"Sincronizar con Tienda Nube"**.
   - Esto trae TODOS tus productos y variantes desde Tienda Nube hacia
     Supabase (usando el Access Token del paso 2).
   - Si da error, copiame el mensaje exacto que aparece.
6. Si salió bien, en "Mis productos" deberías ver tus ~56 productos con
   precios, costos y stock.

✅ **Checkpoint**: el panel corre en tu PC, te podés loguear, y "Mis
productos" muestra tu catálogo real.

---

## PASO 5 — Desplegar en Vercel (para acceder desde cualquier lado)

1. Subir este proyecto a un repositorio de **GitHub privado**.
   - Si nunca usaste GitHub: crear cuenta en github.com, crear un
     repositorio nuevo (privado), y subir la carpeta completa
     `numa-price-manager/` (podés arrastrar los archivos desde la web
     de GitHub si no usás git por terminal).
2. Entrar a [vercel.com](https://vercel.com) → crear cuenta (podés usar
   "Continue with GitHub") → **Add New → Project**.
3. Importar el repositorio recién creado.
4. En la configuración del proyecto, IMPORTANTE:
   - **Root Directory**: cambiarlo a `app` (porque el proyecto Next.js
     está dentro de la carpeta `app/`, no en la raíz del repo).
5. En **Environment Variables**, agregar las 7 variables del paso 3 (los
   mismos nombres y valores de tu `.env.local`).
6. Click en **Deploy**. Esperar unos minutos.
7. Al terminar, Vercel te da una URL pública, ej:
   `https://numa-price-manager.vercel.app`. Esa es la URL del panel para
   usar desde cualquier compu/celular (logueándose con los usuarios de
   Supabase).

✅ **Checkpoint**: el panel está online en una URL de Vercel, y
funciona igual que en local (login + sincronizar + ver productos).

---

## PASO 6 — Configurar el scraper de MËKK (GitHub Actions)

El scraper necesita un navegador (Playwright), por eso corre en
**GitHub Actions** (gratis para repos privados, ~2000 min/mes) en vez
de Vercel.

1. **Exportar las cookies de sesión de MËKK mayorista:**
   - Abrir Chrome/Edge, ir a `mekkmayorista.com.ar`, loguearte con
     `infonumahome@gmail.com` / la contraseña que ya tenés.
   - Instalar la extensión **"Cookie-Editor"** (buscarla en la Chrome
     Web Store).
   - Estando logueado en mekkmayorista.com.ar, abrir Cookie-Editor →
     botón **Export** → **Export as JSON**. Esto copia el JSON al
     portapapeles.

2. **Configurar los secrets en GitHub:**
   - En el repo de GitHub, ir a **Settings → Secrets and variables →
     Actions → New repository secret**.
   - Crear estos 3 secrets:
     - `MEKK_COOKIES_JSON` → pegar el JSON que copiaste en el paso
       anterior.
     - `PANEL_API_URL` → `https://<tu-url-de-vercel>/api/import-mekk`
       (usando la URL real del paso 5)
     - `INTERNAL_API_TOKEN` → el mismo valor que pusiste en Vercel
       (paso 3/5)

3. **Correr el scraper manualmente la primera vez:**
   - En GitHub, ir a la pestaña **Actions** del repo.
   - Si no aparece el workflow listado, puede que GitHub necesite que
     hagas un primer commit/push para detectarlo — el archivo ya está
     en `.github/workflows/scraper-mekk.yml`.
   - Click en **"Scraper MEKK -> Panel Numa"** → **Run workflow** →
     **Run workflow** (botón verde).
   - Esperar a que termine (puede tardar varios minutos, scrapea todo
     el catálogo de ambos sitios).
   - Si termina en verde ✅, entrar al panel → **"Catálogo MËKK"** y
     deberías ver los productos del proveedor con precio mayorista y
     (si el matching funcionó) precio minorista de mekkhome.com.ar.

4. **Automático de ahí en adelante:**
   - El workflow corre solo todos los lunes a las 9am (hora Argentina).
   - Se puede volver a correr manualmente cuando quieran desde la
     pestaña Actions.

> ⚠️ **Las cookies expiran con el tiempo.** Si en algún momento el
> scraper falla con "Las cookies no iniciaron sesión correctamente",
> repetir el paso 1 (loguearse de nuevo y volver a exportar cookies) y
> actualizar el secret `MEKK_COOKIES_JSON`.

✅ **Checkpoint**: en "Catálogo MËKK" aparecen productos del proveedor
con precios mayoristas (y minoristas si el matching encontró
correspondencias).

---

## PASO 7 — Uso diario / semanal

1. **Vincular productos**: en **"Catálogo MËKK"**, para cada producto
   del proveedor que corresponda a algo que vendés, elegir tu producto
   en el desplegable y click en **"Vincular"**. Esto es manual y se
   hace una sola vez por producto (los vínculos quedan guardados).
2. **Revisar la comparativa** (página principal del panel):
   - Filtro **"Desactualizados"**: te muestra productos donde el precio
     sugerido de MËKK difiere de tu precio actual.
   - Columna **"Costo MËKK"**: precio mayorista × cantidad del vínculo
     (tu costo real de compra).
   - Columna **"Precio sugerido MËKK"**: precio de venta al público en
     mekkhome.com.ar, como referencia.
3. **Editar precios**: click en "Editar" en la fila correspondiente,
   ajustar precio y/o costo manualmente, "Guardar".
4. **Exportar e importar a Tienda Nube**:
   - Ir a **"Exportar CSV"** → descargar el archivo.
   - En el panel de Tienda Nube: **Productos → Importar/Exportar →
     Actualización masiva de precios** → subir el CSV descargado.
   - Tienda Nube va a actualizar precio/costo de cada variante según
     el `Identificador de URL` y las propiedades de variante (no toca
     nombres, descripciones, fotos, etc.).

---

## Notas técnicas

- **No se hizo carga inicial por CSV.** Todos los productos propios se
  cargan exclusivamente vía sincronización con la API de Tienda Nube
  (paso 4, botón "Sincronizar"). Esto evita duplicados, ya que la
  sincronización hace upsert por `tn_product_id`/`tn_variant_id`.
- El **matching mayorista ↔ minorista** se hace por nombre de producto
  normalizado (sin tildes, mayúsculas, signos). Si después de correr el
  scraper notás que muchos productos quedan sin precio minorista, puede
  ser que los nombres difieran bastante entre ambos sitios — avisame
  con un par de ejemplos concretos (nombre en mayorista vs nombre en
  minorista) y ajusto el algoritmo de matching.
- Si la estructura HTML de `mekkhome.com.ar` resulta distinta a la de
  `mekkmayorista.com.ar` (selectores `a.product-box`, etc.), el scraper
  va a traer 0 productos del minorista. En ese caso, pasame el link a
  una categoría de mekkhome.com.ar y reviso los selectores.
