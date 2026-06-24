"""
MËKK Mayorista Scraper v2 (DINÁMICO)
====================================
Scraperiza mekkmayorista.com.ar (requiere login)
Extrae categorías dinámicamente desde el menú
Extrae: nombre, categoría, precio_mayorista, imagen, link
Envía directamente a /api/import-mekk del panel

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
            nombre = re.sub(r'\s*\(\d+\)\s*$', '', texto).strip()
            
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

async def obtener_precio_producto(page, url_producto):
    """Obtiene precio mayorista desde la página del producto."""
    try:
        await page.goto(url_producto, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        await page.evaluate("window.scrollTo(0, 300)")
        await page.wait_for_timeout(500)
        
        body = await page.inner_text("body")
        
        precios = re.findall(r'\$\s*[\d]{1,3}(?:\.\d{3})*(?:,\d{1,2})?', body)
        
        valores = []
        for p in precios:
            v = parsear_precio(p)
            if v and 100 <= v <= 50_000_000:
                valores.append(v)
        
        if not valores:
            return None
        
        if len(valores) >= 2:
            precio_final = min(valores[:2])
        else:
            precio_final = valores[0]
        
        return precio_final
    
    except Exception:
        return None

async def scrape_categoria(page, categoria):
    """Scrapeá una categoría completa (todas las páginas)"""
    productos = []
    url = categoria["url"]
    pagina = 1
    
    while url:
        print(f"   📄 Pág {pagina}: {url}")
        try:
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
                    nombre = ""
                    if nombre_el:
                        nombre = (await nombre_el.inner_text()).strip()
                    
                    if not nombre:
                        continue
                    
                    primera = await item.query_selector(".primera")
                    img_el = None
                    if primera:
                        img_el = await primera.query_selector("img[loading='lazy']")
                    if not img_el:
                        img_el = await item.query_selector("img[loading='lazy']")
                    
                    img_url = ""
                    if img_el:
                        img_url = (await img_el.get_attribute("src") or "").strip()
                    
                    href = await item.get_attribute("href") or ""
                    link = urljoin(BASE_URL, href) if href else ""
                    
                    productos.append({
                        "categoria": categoria["nombre"],
                        "nombre": nombre,
                        "precio_mayorista": None,
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
        
        except Exception as e:
            print(f"      ⚠ Error: {e}")
            url = None
    
    return productos

def enviar_al_panel(productos):
    """Envía productos al endpoint /api/import-mekk en lotes de 50."""
    if not PANEL_API_URL or not INTERNAL_API_TOKEN:
        print("⚠  PANEL_API_URL o INTERNAL_API_TOKEN no configurados")
        print("   Datos guardados solo en JSON local")
        return
    
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
    
    print(f"\n   ✅ Total: {upserts_total} upserts, {errores_total} errores")

async def main():
    ensure_dirs()
    print("=" * 60)
    print("  MËKK Mayorista Scraper v2 (DINÁMICO)")
    print("=" * 60)
    
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
                print(f"   ❌ Error: {e}")
        
        print(f"\n💰 Obteniendo precios de {len(todos)} productos mayorista...")
        for i, prod in enumerate(todos):
            if prod["link"]:
                precio = await obtener_precio_producto(page, prod["link"])
                prod["precio_mayorista"] = precio
                
                if (i + 1) % 20 == 0 or i == 0:
                    print(f"   {i+1}/{len(todos)} — {prod['nombre'][:35]:35s} → ${precio}")
        
        await browser.close()
    
    print(f"\n🎉 Total: {len(todos)} productos mayorista")
    if todos:
        with open(JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(todos, f, ensure_ascii=False, indent=2)
        print(f"📁 Guardado en {JSON_FILE}")
        enviar_al_panel(todos)
    else:
        print("⚠ Sin productos.")

if __name__ == "__main__":
    asyncio.run(main())
