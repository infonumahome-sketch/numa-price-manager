"""
MËKK Mayorista + MËKK Home (minorista) -> Numa Price Manager
==============================================================
Scraper v4: basado en mekk_scraper_v3.py de Charly, adaptado para:
  1. Relevar precios de COMPRA en mekkmayorista.com.ar (con login)
  2. Relevar precios de VENTA AL PÚBLICO en mekkhome.com.ar (sin login)
  3. Emparejar ambos catálogos por nombre de producto
  4. Enviar todo directamente a la API del panel (/api/import-mekk)

INSTRUCCIONES PREVIAS (hacer una sola vez):
  1. Abrí Chrome/Edge y logueate manualmente en mekkmayorista.com.ar
  2. Instalá la extensión "Cookie-Editor" (gratuita, Chrome o Edge)
  3. Estando en mekkmayorista.com.ar, abrí Cookie-Editor y exportá las
     cookies (botón "Export" -> "Export as JSON") y pegá el contenido
     en cookies.json en la misma carpeta que este script.

CONFIGURACIÓN (variables de entorno):
  PANEL_API_URL       -> ej: https://numa-price-manager.vercel.app/api/import-mekk
  INTERNAL_API_TOKEN  -> el mismo token configurado en el panel (.env)

Estas variables se configuran como "Secrets" en GitHub Actions
(ver scraper/README.md para el workflow de cron).

NOTA: la estructura HTML de mekkhome.com.ar se asume similar a la de
mekkmayorista.com.ar (mismo motor de tienda). Si el matching da pocos
resultados o el scraping del minorista falla, puede que los selectores
("a.product-box", etc.) sean distintos -> avisar para ajustarlos.
"""

import asyncio
import json
import os
import re
from urllib.parse import urljoin

from playwright.async_api import async_playwright
import requests

# ─────────────────────────────────────────
BASE_URL = "https://mekkmayorista.com.ar"
BASE_URL_MINORISTA = "https://www.mekkhome.com.ar"
COOKIES_FILE = "cookies.json"

PANEL_API_URL = os.environ.get("PANEL_API_URL", "")
INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")

OUTPUT_DIR = "mekk_output"
JSON_FILE = os.path.join(OUTPUT_DIR, "catalogo_mekk.json")
# ─────────────────────────────────────────


def ensure_dirs():
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def cargar_cookies():
    """Lee el archivo cookies.json exportado desde Cookie-Editor."""
    if not os.path.exists(COOKIES_FILE):
        print(f"❌ No encontré '{COOKIES_FILE}'.")
        print("   Seguí las instrucciones al inicio del script para exportar tus cookies.")
        return None
    with open(COOKIES_FILE, encoding="utf-8") as f:
        raw = json.load(f)

    SAMESITE_MAP = {
        "strict": "Strict", "Strict": "Strict",
        "lax": "Lax", "Lax": "Lax",
        "none": "None", "None": "None",
        "no_restriction": "None", "unspecified": "Lax", "": "Lax",
    }

    cookies = []
    for c in raw:
        name = c.get("name", "")
        value = c.get("value", "")
        if not name:
            continue
        domain = c.get("domain", "mekkmayorista.com.ar")
        if domain and not domain.startswith(".") and not domain.startswith("http"):
            domain = "." + domain.lstrip(".")
        cookie = {
            "name": name,
            "value": value,
            "domain": domain,
            "path": c.get("path", "/"),
            "sameSite": SAMESITE_MAP.get(str(c.get("sameSite", c.get("same_site", ""))), "Lax"),
        }
        if c.get("secure"):
            cookie["secure"] = True
        if c.get("httpOnly"):
            cookie["httpOnly"] = True
        cookies.append(cookie)

    print(f"✅ {len(cookies)} cookies cargadas desde '{COOKIES_FILE}'")
    if len(cookies) < 3:
        print("⚠  Muy pocas cookies — asegurate de exportar TODAS desde Cookie-Editor")
    return cookies


async def verificar_login(page):
    await page.goto(BASE_URL, wait_until="networkidle")
    await page.wait_for_timeout(2000)
    contenido = await page.inner_text("body")
    if "Ingresar a la Tienda" in contenido and "Cerrar sesión" not in contenido and "Mi cuenta" not in contenido:
        print("⚠  Las cookies no iniciaron sesión correctamente.")
        print("   Asegurate de exportar las cookies DESPUÉS de loguearte.")
        return False
    print("✅ Sesión verificada correctamente")
    return True


async def obtener_categorias(page):
    await page.goto(BASE_URL, wait_until="networkidle")
    await page.wait_for_timeout(1500)
    categorias = []
    vistos = set()
    links = await page.query_selector_all('a[href*="/categoria/"]')
    for link in links:
        href = await link.get_attribute("href")
        texto = (await link.inner_text()).strip()
        nombre = re.sub(r'\d+$', '', texto).strip()
        if href and href not in vistos and nombre and "/store/" not in href:
            url_cat = href if href.startswith("http") else urljoin(BASE_URL, href)
            categorias.append({"nombre": nombre, "url": url_cat})
            vistos.add(href)
    print(f"📂 {len(categorias)} categorías encontradas")
    for c in categorias:
        print(f"   • {c['nombre']}")
    return categorias


def parsear_precio(texto):
    """Convierte '$ 12.345,00' o '$12.345' -> 12345.0 (float)"""
    if not texto:
        return None
    nums = re.sub(r'[^\d,]', '', texto)  # deja solo dígitos y coma
    nums = nums.replace(".", "")        # quita separador de miles
    nums = nums.replace(",", ".")       # coma decimal -> punto
    try:
        return float(nums)
    except ValueError:
        return None


async def obtener_precio_producto(page, url_producto):
    """
    Visita la página del producto logueado y extrae:
      - precio_mayorista (precio final con descuento, "+ IVA")
      - precio_mayorista_sin_descuento (precio tachado, si existe)
    """
    try:
        await page.goto(url_producto, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        await page.evaluate("window.scrollTo(0, 300)")
        await page.wait_for_timeout(500)

        body = await page.inner_text("body")

        # Precios con formato $ X.XXX,XX (con o sin espacio, con o sin "+ IVA")
        precios = re.findall(r'\$\s*[\d]{1,3}(?:\.\d{3})*(?:,\d{1,2})?', body)
        valores = []
        for p in precios:
            v = parsear_precio(p)
            if v and 100 <= v <= 50_000_000:
                valores.append(v)

        if not valores:
            return None, None

        # En MEKK, cuando hay descuento aparecen dos precios cerca:
        # el tachado (mayor) y el final (menor). Si solo hay uno, es el final.
        if len(valores) >= 2:
            precio_final = min(valores[:2])
            precio_sin_descuento = max(valores[:2])
            if precio_final == precio_sin_descuento:
                precio_sin_descuento = None
        else:
            precio_final = valores[0]
            precio_sin_descuento = None

        return precio_final, precio_sin_descuento
    except Exception as e:
        print(f"      ⚠ Error obteniendo precio de {url_producto}: {e}")
        return None, None


async def scrape_categoria(page, categoria):
    productos = []
    url = categoria["url"]
    pagina = 1
    while url:
        print(f"   📄 Pág {pagina}: {url}")
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_timeout(2000)
        for _ in range(4):
            await page.evaluate("window.scrollBy(0, 800)")
            await page.wait_for_timeout(500)

        items = await page.query_selector_all("a.product-box")
        print(f"      → {len(items)} productos")

        for item in items:
            try:
                nombre_el = await item.query_selector('div[style*="font-weight: bold"]')
                nombre = (await nombre_el.inner_text()).strip() if nombre_el else ""
                primera = await item.query_selector(".primera")
                img_el = await primera.query_selector("img[loading='lazy']") if primera else None
                if not img_el:
                    img_el = await item.query_selector("img[loading='lazy']")
                img_url = (await img_el.get_attribute("src") or "") if img_el else ""
                href = await item.get_attribute("href") or ""
                link = urljoin(BASE_URL, href) if href else ""
                if nombre:
                    productos.append({
                        "categoria": categoria["nombre"],
                        "nombre": nombre,
                        "precio_mayorista": None,
                        "precio_mayorista_sin_descuento": None,
                        "precio_minorista": None,
                        "imagen_url": img_url,
                        "link": link,
                    })
            except Exception:
                continue

        next_btn = await page.query_selector('a[rel="next"], a:has-text("Siguiente"), [class*="next"]:not([disabled])')
        if next_btn:
            next_href = await next_btn.get_attribute("href")
            url = urljoin(BASE_URL, next_href) if next_href else None
            pagina += 1
        else:
            url = None
    return productos


async def obtener_categorias_minorista(page):
    """
    Recorre el sitio minorista (mekkhome.com.ar) buscando enlaces de
    categoría. No requiere login. Igual que en el mayorista, asumimos
    estructura tipo Tienda Nube (/categoria/...).
    """
    await page.goto(BASE_URL_MINORISTA, wait_until="networkidle")
    await page.wait_for_timeout(1500)
    categorias = []
    vistos = set()
    links = await page.query_selector_all('a[href*="/categoria/"]')
    for link in links:
        href = await link.get_attribute("href")
        texto = (await link.inner_text()).strip()
        nombre = re.sub(r'\d+$', '', texto).strip()
        if href and href not in vistos and nombre and "/store/" not in href:
            url_cat = href if href.startswith("http") else urljoin(BASE_URL_MINORISTA, href)
            categorias.append({"nombre": nombre, "url": url_cat})
            vistos.add(href)
    print(f"📂 [Minorista] {len(categorias)} categorías encontradas")
    for c in categorias:
        print(f"   • {c['nombre']}")
    return categorias


async def scrape_categoria_minorista(page, categoria):
    """
    Igual que scrape_categoria, pero para el sitio minorista. Acá el
    precio sí se puede leer directo del listado (sin login), así que
    lo extraemos en la misma pasada sin visitar cada producto.
    """
    productos = []
    url = categoria["url"]
    pagina = 1
    while url:
        print(f"   📄 [Minorista] Pág {pagina}: {url}")
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_timeout(2000)
        for _ in range(4):
            await page.evaluate("window.scrollBy(0, 800)")
            await page.wait_for_timeout(500)

        items = await page.query_selector_all("a.product-box")
        print(f"      → {len(items)} productos")

        for item in items:
            try:
                nombre_el = await item.query_selector('div[style*="font-weight: bold"]')
                nombre = (await nombre_el.inner_text()).strip() if nombre_el else ""
                if not nombre:
                    # Fallback: a veces el nombre está en otro contenedor
                    nombre_el2 = await item.query_selector("h2, h3, .product-name, .name")
                    nombre = (await nombre_el2.inner_text()).strip() if nombre_el2 else ""

                href = await item.get_attribute("href") or ""
                link = urljoin(BASE_URL_MINORISTA, href) if href else ""

                texto_item = await item.inner_text()
                precios = re.findall(r'\$\s*[\d]{1,3}(?:\.\d{3})*(?:,\d{1,2})?', texto_item)
                valores = []
                for p in precios:
                    v = parsear_precio(p)
                    if v and 100 <= v <= 50_000_000:
                        valores.append(v)

                # Si hay precio tachado + precio final, el de venta al
                # público vigente es el menor de los dos.
                precio_minorista = min(valores) if valores else None

                if nombre:
                    productos.append({
                        "categoria": categoria["nombre"],
                        "nombre": nombre,
                        "precio_minorista": precio_minorista,
                        "link": link,
                    })
            except Exception:
                continue

        next_btn = await page.query_selector('a[rel="next"], a:has-text("Siguiente"), [class*="next"]:not([disabled])')
        if next_btn:
            next_href = await next_btn.get_attribute("href")
            url = urljoin(BASE_URL_MINORISTA, next_href) if next_href else None
            pagina += 1
        else:
            url = None
    return productos


def normalizar_nombre(nombre: str) -> str:
    """Normaliza un nombre de producto para poder compararlos:
    minúsculas, sin tildes, sin signos, espacios colapsados."""
    n = nombre.lower().strip()
    reemplazos = {
        "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n",
    }
    for a, b in reemplazos.items():
        n = n.replace(a, b)
    n = re.sub(r'[^a-z0-9\s]', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n


def emparejar_precios_minoristas(productos_mayorista, productos_minorista):
    """
    Cruza ambas listas por nombre normalizado (match exacto tras
    normalizar). Si no hay match exacto, intenta un match donde el
    nombre normalizado de uno esté contenido en el otro (para casos
    como "Bowl Dip Oceano" vs "Bowl / Dip Oceano de gres").

    Modifica productos_mayorista in-place, completando "precio_minorista".
    """
    minorista_por_nombre = {}
    for pm in productos_minorista:
        key = normalizar_nombre(pm["nombre"])
        # si hay duplicados, nos quedamos con el primero
        minorista_por_nombre.setdefault(key, pm)

    sin_match = 0
    for p in productos_mayorista:
        key = normalizar_nombre(p["nombre"])

        match = minorista_por_nombre.get(key)
        if not match:
            # Intento 2: contención (en cualquier sentido)
            for mkey, mval in minorista_por_nombre.items():
                if key in mkey or mkey in key:
                    match = mval
                    break

        if match:
            p["precio_minorista"] = match.get("precio_minorista")
        else:
            sin_match += 1

    print(f"\n🔗 Matching mayorista <-> minorista: "
          f"{len(productos_mayorista) - sin_match}/{len(productos_mayorista)} con precio minorista")
    if sin_match:
        print(f"   ⚠ {sin_match} productos sin match (quedan con precio_minorista = None)")


def enviar_al_panel(productos):
    if not PANEL_API_URL or not INTERNAL_API_TOKEN:
        print("⚠  PANEL_API_URL o INTERNAL_API_TOKEN no configurados.")
        print("   Los datos quedaron solo en el JSON local, no se enviaron al panel.")
        return

    print(f"\n📤 Enviando {len(productos)} productos a {PANEL_API_URL}...")
    payload = [
        {
            "nombre": p["nombre"],
            "categoria": p["categoria"],
            "link": p["link"],
            "imagen_url": p["imagen_url"],
            "precio_mayorista": p["precio_mayorista"],
            "precio_mayorista_sin_descuento": p["precio_mayorista_sin_descuento"],
            "precio_minorista": p["precio_minorista"],
        }
        for p in productos
    ]

    try:
        resp = requests.post(
            PANEL_API_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {INTERNAL_API_TOKEN}",
                "Content-Type": "application/json",
            },
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        print(f"   ✅ {data}")
    except Exception as e:
        print(f"   ❌ Error enviando al panel: {e}")


async def main():
    ensure_dirs()
    print("=" * 52)
    print("  MËKK Mayorista + Home -> Numa Price Manager (v4)")
    print("=" * 52)

    cookies = cargar_cookies()
    if not cookies:
        return

    todos = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        )
        await context.add_cookies(cookies)
        page = await context.new_page()

        if not await verificar_login(page):
            await browser.close()
            return

        categorias = await obtener_categorias(page)
        if not categorias:
            print("❌ Sin categorías")
            await browser.close()
            return

        for cat in categorias:
            print(f"\n📂 {cat['nombre']}")
            try:
                prods = await scrape_categoria(page, cat)
                todos.extend(prods)
                print(f"   ✅ {len(prods)} productos")
            except Exception as e:
                print(f"   ❌ {e}")

        print(f"\n💰 Obteniendo precios mayoristas de {len(todos)} productos...")
        for i, prod in enumerate(todos):
            if prod["link"]:
                precio_final, precio_sin_desc = await obtener_precio_producto(page, prod["link"])
                prod["precio_mayorista"] = precio_final
                prod["precio_mayorista_sin_descuento"] = precio_sin_desc
                if (i + 1) % 20 == 0 or i == 0:
                    print(f"   {i+1}/{len(todos)} — {prod['nombre'][:35]:35s} → ${precio_final}")

        # ── Sitio minorista (mekkhome.com.ar) — no requiere login ──
        print("\n🛍  Relevando catálogo minorista (mekkhome.com.ar)...")
        productos_minorista = []
        try:
            categorias_min = await obtener_categorias_minorista(page)
            for cat in categorias_min:
                print(f"\n📂 [Minorista] {cat['nombre']}")
                try:
                    prods_min = await scrape_categoria_minorista(page, cat)
                    productos_minorista.extend(prods_min)
                    print(f"   ✅ {len(prods_min)} productos")
                except Exception as e:
                    print(f"   ❌ {e}")
        except Exception as e:
            print(f"   ❌ Error relevando catálogo minorista: {e}")

        if productos_minorista:
            emparejar_precios_minoristas(todos, productos_minorista)

        await browser.close()

    print(f"\n🎉 Total: {len(todos)} productos")
    if todos:
        with open(JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(todos, f, ensure_ascii=False, indent=2)
        print(f"📁 Guardado en {JSON_FILE}")
        enviar_al_panel(todos)
    else:
        print("⚠ Sin productos.")


if __name__ == "__main__":
    asyncio.run(main())
