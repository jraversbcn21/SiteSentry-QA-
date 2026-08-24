# Guia de Setup - SiteSentry QA

## Requisitos

- Node.js 18+ ([descargar](https://nodejs.org/))

**No se requieren servicios externos.** SQLite se crea automaticamente en `backend/data/sitesentry.db`. La cola de trabajos es en memoria (EventEmitter). Todo corre en un solo proceso.

## Paso 1: Backend

```bash
cd backend
npm install
```

Instala Chromium para Playwright:
```bash
npx playwright install chromium
```

### Variables de entorno (opcional)

Crea `backend/.env` (todo tiene defaults funcionales, no es obligatorio salvo `OPENROUTER_API_KEY` si quieres usar las explicaciones con IA):

```env
PORT=3001
FRONTEND_URL=http://localhost:5173
DB_PATH=./data/sitesentry.db
PAGE_TIMEOUT=60000
VISUAL_DIFF_THRESHOLD=0.05
LOG_LEVEL=info
API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
ALLOW_LOCAL_SCAN=
```

| Variable | Default | Descripcion |
|---|---|---|
| `PORT` | `3001` | Puerto del backend (API + worker) |
| `FRONTEND_URL` | `http://localhost:5173` | Origen permitido por CORS |
| `DB_PATH` | `./data/sitesentry.db` | Ruta del archivo SQLite |
| `PAGE_TIMEOUT` | `60000` | Timeout de navegacion Playwright (ms) |
| `VISUAL_DIFF_THRESHOLD` | `0.05` | Umbral de diferencia para regresion visual |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `API_KEY` | (sin auth) | Si se define, todas las rutas `/api/*` exigen cabecera `x-api-key` |
| `OPENROUTER_API_KEY` | (IA deshabilitada) | Necesaria para las explicaciones con IA; sin ella el endpoint devuelve 503 |
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash-lite` | Modelo por defecto del servidor (el frontend suele enviar su propia preferencia) |
| `ALLOW_LOCAL_SCAN` | (desactivado) | `1` para poder escanear localhost/IPs privadas (dev only, ver `AGENTS.md`) |

`frontend/.env` (opcional): `BACKEND_PORT` (default `3001`, debe coincidir con el `PORT` del backend — es el target del proxy de Vite) y `FRONTEND_PORT` (default `5173`).

## Paso 2: Frontend

```bash
cd frontend
npm install
```

## Paso 3: Iniciar servicios

Necesitas **2 terminales** abiertas simultaneamente:

**Terminal 1 - Backend (API + Worker):**
```bash
cd backend
npm run dev
```
Esperado: `SiteSentry QA Backend iniciado en puerto 3001 (API + Worker single-process)`

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```
Esperado: `Local: http://localhost:5173/`

## Paso 4: Probar

1. Abre `http://localhost:5173`
2. Introduce una URL (ej: `https://example.com`)
3. Haz clic en "Analizar"
4. Espera 10-60 segundos
5. Revisa el reporte con los problemas detectados

## Solucion de Problemas

### No se crea la base de datos
- El archivo `backend/data/sitesentry.db` se crea automaticamente al iniciar el servidor
- Verifica que el directorio `backend/data/` tenga permisos de escritura

### El analisis no progresa
- El worker corre en el mismo proceso que la API, verifica los logs del backend

### Error de CORS
- Verifica que `FRONTEND_URL` en `.env` coincida con la URL del frontend
- Por defecto acepta `http://localhost:5173`

### Timeout en paginas pesadas
- Aumenta `PAGE_TIMEOUT` en `.env` (por defecto 60000ms = 60s)

### Playwright no encuentra navegador
- Ejecuta `npx playwright install chromium` en `backend/`

### "IA no configurada en el servidor" al pulsar "Explicar con IA"
- Falta `OPENROUTER_API_KEY` en `backend/.env`. Genera una key en openrouter.ai y reinicia el backend (no se recarga sola con el servidor corriendo).

### "No se permite escanear direcciones locales" al analizar localhost/VPN
- Proteccion SSRF intencional. Para desarrollo, define `ALLOW_LOCAL_SCAN=1` en `backend/.env` y reinicia el backend (ver `AGENTS.md` > Security). No usar en un backend desplegado publicamente.
