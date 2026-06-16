CAMBIOS NECESARIOS EN mekk_scraper_v4.py

PASO 1 — Agregar lectura del bypass token (después de línea 45):

Después de:
INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")

Agregar:
VERCEL_BYPASS_TOKEN = os.environ.get("VERCEL_BYPASS_TOKEN", "")

---

PASO 2 — Modificar el POST (línea 398-406):

CAMBIAR ESTO:
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

POR ESTO:
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

---

Una vez hecho esto, commitea el archivo a GitHub y ejecuta el workflow nuevamente.
