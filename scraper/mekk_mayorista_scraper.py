"""
MËKK Mayorista Scraper v3
=========================
Scraperiza mekkmayorista.com.ar (requiere login)
Extrae categorías dinámicamente desde el menú
Extrae: nombre, categoría, precio_mayorista, imagen, link
Envía directamente a /api/import-mekk del panel

Cómo es la web (revisado el 05/10/2026):
  - Cada categoría carga los productos de a 24 a medida que se hace
    scroll DENTRO de un contenedor de la página (no de la ventana).
  - El precio está en la tarjeta de cada producto: "$19.990 + IVA".
    El precio mayorista es SIN IVA.
  - Abajo hay una barra del carrito ("Te faltan $3.030 para la compra
    mínima"): no hay que tomar ese monto como precio.

Configuración (GitHub Secrets):
  - MEKK_COOKIES_JSON: JSON de cookies de sesión autenticada
  - PANEL_API_URL: https://numa-price-manager.vercel.app/api/import-mekk
  - INTERNAL_API_TOKEN: token interno
  - VERCEL_BYPASS_TOKEN: bypass para Vercel Deployment Protection
"""
import asyncio
import json
import os
import re
import sys
from urllib.parse import urljoin
from playwright.async_api import async_playwright
import requests

# ─────────────────────────────────────────
BASE_URL = "https://mekkmayorista.com.ar"
PANEL_API_URL = os.environ.get("PANEL_API_URL", "")
INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")
VERCEL_BYPASS_TOKEN = os.environ.get("VERCEL_BYPASS_TOKEN", "")
OUTPUT_DIR = "mekk_output"
JSON_FILE = os.path.join(OUTPUT_DIR, "catalogo_mekk_mayorista.json")
BATCH_SIZE = 50

# Precio en una tarjeta o página de producto: "$19.990+ IVA" / "$ 19.990,50 + IVA"
PRECIO_IVA_RE = re.compile(r'\$\s*([\d.]+(?:,\d{1,2})?)\s*\+\s*IVA', re.IGNORECASE)

# Categorías que repiten productos de otras (si un producto aparece en
# una de estas y en otra, queda con la otra)
CATEGORIAS_DE_VIDRIERA = {"OPORTUNIDADES", "NUEVOS INGRESOS"}

# Scroll infinito: cuántas vueltas sin productos nuevos antes de dar por
# terminada la categoría, y un tope de seguridad
SCROLL_SIN_CAMBIOS = 3
SCROLL_MAXIMO = 200

# ─────────────────────────────────────────
def ensure_dirs():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

def cargar_cookies():
    """Lee cookies de GitHub Secrets (formato JSON)"""
    cookies_json = os.environ.get("MEKK_COOKIES_JSON", "")
    if not cookies_json:
        print("⚠  MEKK_COOKIES_JSON no configurado en GitHub Secrets")
        return None
    
    try:
        raw = json.loads(cookies_json)
    except json.JSONDecodeError:
        print("❌ MEKK_COOKIES_JSON no es JSON válido")
        return None
    
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
    
    print(f"✅ {len(cookies)} cookies cargadas")
    return cookies

async def verificar_login(page):
    """Verifica que la sesión esté activa"""
    await page.goto(BASE_URL, wait_until="networkidle")
    await page.wait_for_timeout(2000)
    
    contenido = await page.inner_text("body")
    
    if "Ingresar a la Tienda" in contenido and "Cerrar sesión" not in contenido:
        print("⚠  Las cookies no iniciaron sesión correctamente")
        return False
    
    print("✅ Sesión verificada")
    return True

async def obtener_categorias(page):
    """Extrae dinámicamente todas las categorías desde el menú."""
    await page.goto(BASE_URL, wait_until="networkidle")
    await page.wait_for_timeout(1500)
    
    categorias = []
    vistos = set()
    
    links = await page.query_selector_all('a[href*="/categoria/"]')
    
    for link in links:
        try:
            href = await link.get_attribute("href")
            texto = (await link.inner_text()).strip()
            # El menú muestra la cantidad al lado ("DE MESA\n908" o "DE MESA (908)"): se saca
            nombre = re.sub(r'\s*\(?\d+\)?\s*$', '', texto).strip()
            
            if href and href not in vistos and nombre and len(nombre) > 2 and "/store/" not in href:
                url_cat = href if href.startswith("http") else urljoin(BASE_URL, href)
                categorias.append({"nombre": nombre, "url": url_cat})
                vistos.add(href)
        except Exception:
            continue
    
    print(f"📂 {len(categorias)} categorías encontradas")
    for c in categorias:
        print(f"   • {c['nombre']}")
    
    return categorias

def parsear_precio(texto):
    """Convierte '$ 12.345,00' -> 12345.0"""
    if not texto:
        return None
    nums = re.sub(r'[^\d,]', '', texto)
    nums = nums.replace(".", "")
    nums = nums.replace(",", ".")
    try:
        return float(nums)
    except ValueError:
        return None

def precio_desde_texto(texto):
    """Busca el precio con formato "$X + IVA". Ignora otros montos de la
    página (por ejemplo, la barra del carrito)."""
    m = PRECIO_IVA_RE.search(texto or "")
    if not m:
        return None
    v = parsear_precio(m.group(1))
    return v if v and 100 <= v <= 50_000_000 else None

async def obtener_precio_producto(page, url_producto):
    """Plan B: precio desde la página del producto, si la tarjeta no lo tenía."""
    try:
        await page.goto(url_producto, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        return precio_desde_texto(await page.inner_text("body"))
    except Exception:
        return None

# Hace scroll hasta el fondo en la ventana y en todo contenedor con scroll
# propio (ahí carga MËKK los productos), y devuelve cuántas tarjetas hay.
JS_SCROLL_AL_FONDO = """
() => {
  const conScroll = [...document.querySelectorAll('*')].filter(e => {
    const s = getComputedStyle(e);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 50;
  });
  for (const e of conScroll) e.scrollTop = e.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
  return document.querySelectorAll('a.product-box').length;
}
"""

async def cargar_todos_los_productos(page):
    """Scroll infinito: baja hasta que dejan de aparecer productos nuevos."""
    cantidad = len(await page.query_selector_all("a.product-box"))
    sin_cambios = 0
    for _ in range(SCROLL_MAXIMO):
        await page.evaluate(JS_SCROLL_AL_FONDO)
        await page.wait_for_timeout(1500)
        nueva = len(await page.query_selector_all("a.product-box"))
        if nueva > cantidad:
            cantidad = nueva
            sin_cambios = 0
        else:
            sin_cambios += 1
            if sin_cambios >= SCROLL_SIN_CAMBIOS:
                break
    return cantidad

async def scrape_categoria(page, categoria):
    """Scrapeá una categoría completa (todos los productos del scroll infinito)."""
    productos = []
    url = categoria["url"]
    print(f"   📄 {url}")
    try:
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_timeout(2000)
        total = await cargar_todos_los_productos(page)
        print(f"      → {total} productos cargados")

        for item in await page.query_selector_all("a.product-box"):
            try:
                nombre_el = await item.query_selector('div[style*="font-weight: bold"]')
                nombre = (await nombre_el.inner_text()).strip() if nombre_el else ""
                if not nombre:
                    continue

                primera = await item.query_selector(".primera")
                img_el = await primera.query_selector("img[loading='lazy']") if primera else None
                if not img_el:
                    img_el = await item.query_selector("img[loading='lazy']")
                img_url = (await img_el.get_attribute("src") or "").strip() if img_el else ""

                href = await item.get_attribute("href") or ""
                link = urljoin(BASE_URL, href) if href else ""

                productos.append({
                    "categoria": categoria["nombre"],
                    "nombre": nombre,
                    # El precio está en la misma tarjeta: "$19.990+ IVA"
                    "precio_mayorista": precio_desde_texto(await item.inner_text()),
                    "imagen_url": img_url,
                    "link": link,
                })
            except Exception:
                continue
    except Exception as e:
        print(f"      ⚠ Error: {e}")

    return productos

def sin_repetidos(productos):
    """Un producto por link. Si está en una categoría de vidriera
    (Oportunidades, Nuevos ingresos) y en otra, queda con la otra."""
    por_link = {}
    sin_link = []
    for p in productos:
        if not p["link"]:
            sin_link.append(p)
            continue
        previo = por_link.get(p["link"])
        if previo is None:
            por_link[p["link"]] = p
        elif previo["categoria"] in CATEGORIAS_DE_VIDRIERA and p["categoria"] not in CATEGORIAS_DE_VIDRIERA:
            p["precio_mayorista"] = p["precio_mayorista"] or previo["precio_mayorista"]
            por_link[p["link"]] = p
    return list(por_link.values()) + sin_link

def precios_sospechosos(productos):
    """Red de seguridad: si demasiados productos tienen exactamente el mismo
    precio, casi seguro se leyó otro monto de la página. Devuelve el motivo
    o None si está todo bien."""
    precios = [p["precio_mayorista"] for p in productos if p["precio_mayorista"]]
    if len(precios) < 20:
        return None
    mas_comun = max(set(precios), key=precios.count)
    veces = precios.count(mas_comun)
    if veces / len(precios) > 0.3:
        return f"{veces} de {len(precios)} productos tienen el mismo precio (${mas_comun})"
    return None

def enviar_al_panel(productos):
    """Envía productos al endpoint /api/import-mekk en lotes de 50.
    Devuelve la cantidad de productos que no se pudieron enviar."""
    if not PANEL_API_URL or not INTERNAL_API_TOKEN:
        print("⚠  PANEL_API_URL o INTERNAL_API_TOKEN no configurados")
        print("   Datos guardados solo en JSON local")
        return 0
    
    total = len(productos)
    lotes = [productos[i:i+BATCH_SIZE] for i in range(0, total, BATCH_SIZE)]
    
    print(f"\n📤 Enviando {total} productos mayorista en {len(lotes)} lotes...")
    
    upserts_total = 0
    errores_total = 0
    
    for idx, lote in enumerate(lotes, 1):
        payload = [
            {
                "nombre": p["nombre"],
                "categoria": p["categoria"],
                "link": p["link"],
                "imagen_url": p["imagen_url"],
                "precio_mayorista": p["precio_mayorista"],
                "tipo_proveedor": "mayorista",
            }
            for p in lote
        ]
        
        try:
            url = PANEL_API_URL
            if VERCEL_BYPASS_TOKEN:
                url = f"{PANEL_API_URL}?x-vercel-protection-bypass={VERCEL_BYPASS_TOKEN}"
            
            resp = requests.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {INTERNAL_API_TOKEN}",
                    "Content-Type": "application/json",
                },
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()
            upserts_total += data.get("upserts", 0)
            print(f"   Lote {idx}/{len(lotes)}: {data.get('upserts', 0)} upserts, 0 errores")
        except Exception as e:
            errores_total += len(lote)
            print(f"   ❌ Lote {idx}/{len(lotes)} falló: {e}")
    
    print(f"\n   {'✅' if errores_total == 0 else '❌'} Total: {upserts_total} upserts, {errores_total} errores")
    return errores_total

async def main():
    """Devuelve 0 si todo salió bien; otro número hace fallar el workflow."""
    ensure_dirs()
    print("=" * 60)
    print("  MËKK Mayorista Scraper v3")
    print("=" * 60)

    cookies = cargar_cookies()
    if not cookies:
        return 1
    
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
            return 1

        categorias = await obtener_categorias(page)

        if not categorias:
            print("❌ Sin categorías")
            await browser.close()
            return 1

        for cat in categorias:
            print(f"\n📂 {cat['nombre']}")
            try:
                prods = await scrape_categoria(page, cat)
                todos.extend(prods)
                con_precio = sum(1 for p in prods if p["precio_mayorista"])
                print(f"   ✅ {len(prods)} productos ({con_precio} con precio)")
            except Exception as e:
                print(f"   ❌ Error: {e}")

        todos = sin_repetidos(todos)

        # Plan B: entrar al producto solo si la tarjeta no tenía precio
        faltan = [p for p in todos if not p["precio_mayorista"] and p["link"]]
        if faltan:
            print(f"\n💰 Buscando el precio de {len(faltan)} productos en su página...")
            for prod in faltan:
                prod["precio_mayorista"] = await obtener_precio_producto(page, prod["link"])

        await browser.close()

    con_precio = sum(1 for p in todos if p["precio_mayorista"])
    print(f"\n🎉 Total: {len(todos)} productos mayorista ({con_precio} con precio)")
    for p in todos[:5]:
        print(f"   ej: {p['nombre'][:45]:45s} → ${p['precio_mayorista']}")
    if not todos:
        print("⚠ Sin productos.")
        return 1

    with open(JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(todos, f, ensure_ascii=False, indent=2)
    print(f"📁 Guardado en {JSON_FILE}")

    motivo = precios_sospechosos(todos)
    if motivo:
        print(f"\n❌ No se envía nada: los precios parecen mal leídos ({motivo}).")
        print("   Revisar si cambió la página de MËKK.")
        return 1

    return 1 if enviar_al_panel(todos) else 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))