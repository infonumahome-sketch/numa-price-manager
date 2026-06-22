"""
MËKK Minorista Scraper v1
===========================
Scraperiza mekkhome.com.ar (público, sin login)
Extrae: nombre, categoría, precio_minorista, imagen, link
Envía directamente a /api/import-mekk del panel

Configuración (GitHub Secrets):
  - PANEL_API_URL: https://numa-price-manager.vercel.app/api/import-mekk
  - INTERNAL_API_TOKEN: token interno
  - VERCEL_BYPASS_TOKEN: bypass para Vercel Deployment Protection
"""

import asyncio
import json
import os
import re
import html
from datetime import datetime
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

CATEGORIAS = [
    ("Vajilla - Sets completos",      "/demesa/vajilla1/sets/"),
    ("Vajilla - Platos playos",       "/demesa/vajilla1/platos-playo/"),
    ("Vajilla - Platos hondos/bowls", "/demesa/vajilla1/plato-hondo/"),
    ("Vajilla - Platos postre",       "/demesa/vajilla1/platos-postre1/"),
    ("Vajilla - Platos de pasta",     "/demesa/vajilla1/platos-de-pasta/"),
    ("Vajilla - Tazas",               "/demesa/vajilla1/tazas1/"),
    ("Vajilla - Compoteras",          "/demesa/vajilla1/compoteras/"),
    ("Vajilla - Sets Sushi",          "/demesa/vajilla1/platos-de-sushi/"),
    ("Vajilla - Ensaladeras/fuentes", "/demesa/vajilla1/ensaladeras-y-fuentes/"),
    ("Cubiertos - De mesa",           "/demesa/cubiertos/de-mesa/"),
    ("Cubiertos - De ensalada",       "/demesa/cubiertos/de-ensalada/"),
    ("Cubiertos - Copetín/postre",    "/demesa/cubiertos/de-copetin-y-postre/"),
    ("Vasos, copas y jarras",         "/demesa/vasos-cristaleria/"),
    ("Bandejas y tablas",             "/demesa/bandejas-tablas/"),
    ("Textiles de mesa",              "/demesa/individuales/"),
    ("Individuales y servilleteros",  "/demesa/individuales1/"),
    ("Accesorios y complementos",     "/demesa/accesorios-y-complementos/"),
    ("Frascos - condimentos",         "/demesa/frascos/"),
    ("Deco - Bandejas",               "/organizacion-y-deco/bandejas/"),
    ("Deco - Jarrones y floreros",    "/organizacion-y-deco/jarrones-floreros/"),
    ("Deco - Aromas",                 "/organizacion-y-deco/velas/"),
    ("Deco - Velas",                  "/organizacion-y-deco/velas1/"),
    ("Deco - Candelabros",            "/organizacion-y-deco/candelabros/"),
    ("Deco - Caja/Libro",             "/organizacion-y-deco/caja-libros/"),
    ("Deco - Canastos y canastas",    "/organizacion-y-deco/canastos/"),
    ("Deco - Iluminación",            "/organizacion-y-deco/iluminacion/"),
    ("Deco - Deco de pared",          "/organizacion-y-deco/deco-de-pared/"),
    ("Deco - Objetos",                "/organizacion-y-deco/objetos/"),
    ("Deco - Espejos",                "/organizacion-y-deco/espejos/"),
    ("Baño - Sets de baño",           "/accesorios-de-bano/sets-de-bano/"),
    ("Baño - Canastos",               "/accesorios-de-bano/canastos1/"),
]
# ─────────────────────────────────────────


def ensure_dirs():
    os.makedirs(OUTPUT_DIR, exist_ok=True)


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


async def scrape_categoria(page, nombre_cat, path):
    productos = []
    url = urljoin(BASE_URL, path)
    pagina = 1
    vistos = set()

    while url:
        print(f"   📄 Pág {pagina}: {url}")
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_timeout(2000)
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(1000)

        items = await page.query_selector_all("div.js-item-product")
        nuevos = 0

        for item in items:
            try:
                # Nombre
                nombre_el = await item.query_selector(".js-item-name")
                nombre = (await nombre_el.inner_text()).strip() if nombre_el else ""
                if not nombre or nombre in vistos:
                    continue
                vistos.add(nombre)

                # Link
                link_el = await item.query_selector("a")
                link = ""
                if link_el:
                    href = await link_el.get_attribute("href") or ""
                    link = href if href.startswith("http") else urljoin(BASE_URL, href)

                # Imagen
                img_el = await item.query_selector("img")
                imagen_url = ""
                if img_el:
                    src = await img_el.get_attribute("src") or ""
                    imagen_url = src if src.startswith("http") else urljoin(BASE_URL, src)

                # Datos desde data-variants (JSON embebido)
                precio_minorista = None
                variants_el = await item.query_selector("[data-variants]")
                if variants_el:
                    raw = await variants_el.get_attribute("data-variants")
                    try:
                        # El JSON puede venir con &quot; escapados, necesita unescape
                        import html
                        raw_unescaped = html.unescape(raw)
                        v = json.loads(raw_unescaped)[0]
                        
                        # Intentar en este orden: discount -> normal -> sin impuestos
                        precio_str = (
                            v.get("price_with_payment_discount_short", "") or 
                            v.get("price_short", "") or
                            v.get("price_long", "")
                        )
                        precio_minorista = parsear_precio(precio_str)
                    except Exception as e:
                        # Debug: loguear si falla el parseo
                        print(f"         ⚠ Error parseando JSON de {nombre}: {e}")
                        pass

                if nombre and precio_minorista:
                    productos.append({
                        "categoria": nombre_cat,
                        "nombre": nombre,
                        "precio_minorista": precio_minorista,
                        "imagen_url": imagen_url,
                        "link": link,
                    })
                    nuevos += 1

            except Exception:
                continue

        print(f"      → {nuevos} productos con precio")

        # Paginación
        next_el = await page.query_selector('a[rel="next"], .js-pagination-next')
        if next_el:
            next_href = await next_el.get_attribute("href") or ""
            if next_href:
                url = next_href if next_href.startswith("http") else urljoin(BASE_URL, next_href)
                pagina += 1
            else:
                url = None
        else:
            url = None

    return productos


def enviar_al_panel(productos):
    if not PANEL_API_URL or not INTERNAL_API_TOKEN:
        print("⚠  PANEL_API_URL o INTERNAL_API_TOKEN no configurados.")
        print("   Los datos quedaron solo en el JSON local, no se enviaron al panel.")
        return

    print(f"\n📤 Enviando {len(productos)} productos minorista a {PANEL_API_URL}...")
    payload = [
        {
            "nombre": p["nombre"],
            "categoria": p["categoria"],
            "link": p["link"],
            "imagen_url": p["imagen_url"],
            "precio_minorista": p["precio_minorista"],
        }
        for p in productos
    ]

    try:
        # Agregar bypass token a la URL si está disponible
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
        print(f"   ❌ Error enviando al panel: {e}")


async def main():
    ensure_dirs()
    print("=" * 52)
    print("  MËKK Minorista Scraper v1")
    print("=" * 52)

    todos = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        for nombre, path in CATEGORIAS:
            print(f"\n📂 {nombre}")
            try:
                prods = await scrape_categoria(page, nombre, path)
                todos.extend(prods)
                print(f"   ✅ {len(prods)} productos")
            except Exception as e:
                print(f"   ❌ Error: {e}")

        await browser.close()

    # Deduplicar por nombre
    vistos = set()
    unicos = []
    for p in todos:
        key = p["nombre"].lower().strip()
        if key not in vistos:
            vistos.add(key)
            unicos.append(p)

    print(f"\n🎉 Total: {len(unicos)} productos minorista únicos")

    if unicos:
        with open(JSON_FILE, "w", encoding="utf-8") as f:
            json.dump(unicos, f, ensure_ascii=False, indent=2)
        print(f"📁 Guardado en {JSON_FILE}")
        enviar_al_panel(unicos)
    else:
        print("⚠ Sin productos.")


if __name__ == "__main__":
    asyncio.run(main())
