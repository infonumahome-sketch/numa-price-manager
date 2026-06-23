"""
MËKK Minorista Scraper v2 (DINÁMICO)
=====================================
Scraperiza mekkhome.com.ar (público, sin login)
Extrae categorías dinámicamente del sitio
Extrae: nombre, categoría, precio_minorista, imagen, link
Envía directamente a /api/import-mekk del panel

Configuración (GitHub Secrets):
  - MEKK_COOKIES_JSON: cookies si es necesario (no usado aquí, público)
  - PANEL_API_URL: https://numa-price-manager.vercel.app/api/import-mekk
  - INTERNAL_API_TOKEN: token interno
  - VERCEL_BYPASS_TOKEN: bypass para Vercel Deployment Protection
"""
import asyncio
import json
import os
import re
import html
from urllib.parse import urljoin
from playwright.async_api import async_playwright
import requests

# ─────────────────────────────────────────
BASE_URL = "https://www.mekkhome.com.ar"
PANEL_API_URL = os.environ.get("PANEL_API_URL", "")
INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")
VERCEL_BYPASS_TOKEN = os.environ.get("VERCEL_BYPASS_TOKEN", "")
OUTPUT_DIR = "mekk_output"
JSON_FILE = os.path.join(OUTPUT_DIR, "catalogo_mekk_minorista.json")

# ─────────────────────────────────────────
def ensure_dirs():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

def parsear_precio(texto):
    """Convierte '$ 12.540,00' o '$12.540' -> 12540.0 (float)"""
    if not texto:
        return None
    nums = re.sub(r'[^\d,]', '', texto)
    nums = nums.replace(".", "")
    nums = nums.replace(",", ".")
    try:
        return float(nums)
    except ValueError:
        return None

async def obtener_categorias(page):
    """
    Extrae dinámicamente todas las categorías desde el sitio.
    Busca links en el menú que apunten a categorías.
    """
    await page.goto(BASE_URL, wait_until="networkidle")
    await page.wait_for_timeout(1500)
    
    categorias = []
    vistos = set()
    
    # Busca todos los links de categorías (múltiples selectores)
    links = await page.query_selector_all(
        'a[href*="/demesa/"], a[href*="/organizacion-y-deco/"], a[href*="/accesorios-de-bano/"]'
    )
    
    for link in links:
        try:
            href = await link.get_attribute("href")
            texto = (await link.inner_text()).strip()
            
            # Limpia el nombre (quita números de cantidad de productos)
            nombre = re.sub(r'\s*\(\d+\)\s*$', '', texto).strip()
            
            if href and href not in vistos and nombre and len(nombre) > 2:
                url_cat = href if href.startswith("http") else urljoin(BASE_URL, href)
                categorias.append({"nombre": nombre, "url": url_cat})
                vistos.add(href)
        except Exception:
            continue
    
    print(f"📂 {len(categorias)} categorías encontradas")
    for c in categorias:
        print(f"   • {c['nombre']}")
    
    return categorias

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
            
            # Scroll para cargar lazy-load
            for _ in range(3):
                await page.evaluate("window.scrollBy(0, 800)")
                await page.wait_for_timeout(500)
            
            items = await page.query_selector_all("div.js-item-product")
            print(f"      → {len(items)} productos")
            
            for item in items:
                try:
                    # Nombre
                    nombre_el = await item.query_selector(".js-item-name")
                    nombre = ""
                    if nombre_el:
                        nombre = (await nombre_el.inner_text()).strip()
                    
                    # Imagen (usa la imagen principal del producto)
                    img_el = await item.query_selector(".js-item-image.item-image-primary")
                    img_url = ""
                    if img_el:
                        # Prefiere srcset (URL real), sino src (puede ser placeholder)
                        srcset = (await img_el.get_attribute("srcset") or "").strip()
                        if srcset:
                            # Toma la URL de mayor resolución del srcset
                            img_url = srcset.split(",")[-1].strip().split(" ")[0]
                        else:
                            img_url = (await img_el.get_attribute("src") or "").strip()
                    if img_url and img_url.startswith("//"):
                        img_url = "https:" + img_url

                    # Link (el <a> que envuelve la imagen y el nombre)
                    link_el = await item.query_selector(".item-description > a.item-link")
                    link = ""
                    if link_el:
                        href = await link_el.get_attribute("href")
                        link = urljoin(BASE_URL, href) if href else ""
                    
                    # PRECIO MINORISTA
                    precio_minorista = None
                    
                    # Intenta desde .js-price-display.item-price (visible HTML)
                    precio_el = await item.query_selector(".js-price-display.item-price")
                    if precio_el:
                        precio_text = await precio_el.inner_text()
                        precio_minorista = parsear_precio(precio_text)
                    
                    # Fallback: data-variants
                    if not precio_minorista:
                        variants_el = await item.query_selector("[data-variants]")
                        if variants_el:
                            try:
                                raw = await variants_el.get_attribute("data-variants")
                                if raw:
                                    raw_unescaped = html.unescape(raw)
                                    v = json.loads(raw_unescaped)[0]
                                    precio_str = (
                                        v.get("price_with_payment_discount_short") or
                                        v.get("price_short") or
                                        v.get("price_long")
                                    )
                                    if precio_str:
                                        precio_minorista = parsear_precio(precio_str)
                            except Exception:
                                pass
                    
                    # Fallback: data-product-price
                    if not precio_minorista:
                        precio_el = await item.query_selector("[data-product-price]")
                        if precio_el:
                            try:
                                raw_price = await precio_el.get_attribute("data-product-price")
                                if raw_price:
                                    precio_minorista = float(raw_price) / 100
                            except Exception:
                                pass
                    
                    if nombre:
                        productos.append({
                            "categoria": categoria["nombre"],
                            "nombre": nombre,
                            "precio_minorista": precio_minorista,
                            "imagen_url": img_url,
                            "link": link,
                        })
                        
                        if precio_minorista:
                            print(f"          ✓ {nombre[:50]:50s} → ${precio_minorista}")
                
                except Exception as e:
                    continue
            
            # Siguiente página
            next_btn = await page.query_selector(
                'a[rel="next"], a:has-text("Siguiente"), [class*="next"]:not([disabled])'
            )
            if next_btn:
                next_href = await next_btn.get_attribute("href")
                url = urljoin(BASE_URL, next_href) if next_href else None
                pagina += 1
            else:
                url = None
        
        except Exception as e:
            print(f"      ⚠ Error en página: {e}")
            url = None
    
    return productos

def enviar_al_panel(productos):
    """Envía productos al endpoint /api/import-mekk (tabla: mekk_productos_minorista)"""
    if not PANEL_API_URL or not INTERNAL_API_TOKEN:
        print("⚠  PANEL_API_URL o INTERNAL_API_TOKEN no configurados.")
        print("   Los datos quedaron solo en el JSON local.")
        return
    
    print(f"\n📤 Enviando {len(productos)} productos minorista a {PANEL_API_URL}...")
    
    payload = [
        {
            "nombre": p["nombre"],
            "categoria": p["categoria"],
            "link": p["link"],
            "imagen_url": p["imagen_url"],
            "precio_minorista": p["precio_minorista"],
            "tipo_proveedor": "minorista",
        }
        for p in productos
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
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        print(f"   ✅ {data}")
    except Exception as e:
        print(f"   ❌ Error: {e}")

async def main():
    ensure_dirs()
    print("=" * 60)
    print("  MËKK Minorista Scraper v2 (DINÁMICO)")
    print("=" * 60)
    
    todos = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        )
        
        # Obtener categorías dinámicamente
        categorias = await obtener_categorias(page)
        
        if not categorias:
            print("❌ Sin categorías encontradas")
            await browser.close()
            return
        
        # Scrapeá cada categoría
        for cat in categorias:
            print(f"\n📂 {cat['nombre']}")
            try:
                prods = await scrape_categoria(page, cat)
                todos.extend(prods)
                print(f"   ✅ {len(prods)} productos")
            except Exception as e:
                print(f"   ❌ Error: {e}")
        
        await browser.close()
    
    # Guardar JSON
    print(f"\n🎉 Total: {len(todos)} productos minorista")
    if todos:
        with open(JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(todos, f, ensure_ascii=False, indent=2)
        print(f"📁 Guardado en {JSON_FILE}")
        enviar_al_panel(todos)
    else:
        print("⚠ Sin productos.")

if __name__ == "__main__":
    asyncio.run(main())
