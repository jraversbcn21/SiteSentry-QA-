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

Crea `backend/.env` (todo tiene defaults funcionales, no es obligatorio):

```env
PORT=3001
FRONTEND_URL=http://localhost:5173
DB_PATH=./data/sitesentry.db
PAGE_TIMEOUT=60000
VISUAL_DIFF_THRESHOLD=0.05
```

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
Esperado: `SiteSentry QA Backend iniciado en puerto 3001`

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
