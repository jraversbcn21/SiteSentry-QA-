# API Documentation

Base URL: `http://localhost:3001` (puerto configurable via `PORT`, ver `AGENTS.md`).

## Autenticacion

Todas las rutas `/api/*` requieren cabecera `x-api-key` **solo si** la variable de entorno `API_KEY` esta definida en `backend/.env`. Sin `API_KEY`, el backend queda abierto (modo desarrollo).

```
x-api-key: <tu-api-key>
```

## Rate limiting

| Ruta | Limite |
|---|---|
| `POST /api/scan` | 10 peticiones/min |
| `/api/ai/*` | 30 peticiones/min |

## Endpoints

### POST /api/scan

Inicia un nuevo analisis de una pagina web. Validado con zod (`src/api/schemas.ts`).

**Request Body:**
```json
{
  "url": "https://example.com",
  "config": { "timeout": 60000 },
  "flow": [{ "action": "navigate", "url": "https://example.com/login" }],
  "flowId": "uuid-de-flujo-guardado",
  "visualDiffThreshold": 0.05
}
```

Solo `url` es obligatorio.
- `config.timeout`: opcional, default 60000ms.
- `flow`: pasos inline (ver formato en `AGENTS.md` > Phase 3). Mutuamente excluyente con `flowId`.
- `flowId`: referencia a un flujo guardado via `/api/flows`.
- `visualDiffThreshold`: opcional, default 0.05 (override de `VISUAL_DIFF_THRESHOLD`).

URLs a `localhost`/`127.0.0.1`/IPs privadas son rechazadas (proteccion SSRF), salvo con `ALLOW_LOCAL_SCAN=1` en el servidor (ver `AGENTS.md` > Security).

**Response (201):**
```json
{
  "id": "uuid-del-scan",
  "status": "PENDING",
  "url": "https://example.com",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

### GET /api/scan/:id/status

Obtiene el estado actual de un analisis. La `progress` viene del job activo en memoria, o de la columna `progress` en SQLite como fallback si el proceso se reinicio mientras el scan estaba `RUNNING`.

**Response (200):**
```json
{
  "id": "uuid-del-scan",
  "status": "RUNNING",
  "url": "https://example.com",
  "progress": { "phase": "running_checks" },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "completedAt": null
}
```

**Fases de progreso:**
- `launching_browser`: Iniciando navegador
- `loading_page`: Cargando la pagina
- `running_checks`: Ejecutando checkers
- `saving_results`: Guardando resultados

**Status posibles:** `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`

### GET /api/reports/:id

Obtiene el reporte completo de un analisis, incluyendo screenshots, regresion visual y resultados por paso (modo flujo).

**Response (200):**
```json
{
  "id": "uuid-del-scan",
  "url": "https://example.com",
  "status": "COMPLETED",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "completedAt": "2026-01-01T00:00:45.000Z",
  "fullPageScreenshot": "uuid-del-scan/full.png",
  "issues": [
    {
      "id": "uuid-del-issue",
      "type": "BROKEN_RESOURCE",
      "severity": "HIGH",
      "url": "https://example.com/image.png",
      "sourceUrl": "https://example.com",
      "description": "Imagen no se cargo: /image.png (404)",
      "metadata": { "statusCode": 404, "resourceType": "image" },
      "screenshotPath": "uuid-del-scan/uuid-del-issue.png",
      "stepIndex": null
    }
  ],
  "summary": {
    "total": 9,
    "score": 72,
    "byType": {
      "BROKEN_RESOURCE": 2, "FAILED_API": 1, "INTERACTIVITY": 1,
      "EMPTY_CONTENT": 1, "LAZY_LOAD": 0, "FORM_MODAL": 0,
      "CONSOLE_ERROR": 2, "PERFORMANCE": 1, "ACCESSIBILITY": 1, "FLOW_ERROR": 0
    },
    "bySeverity": { "HIGH": 4, "MEDIUM": 4, "LOW": 1 }
  },
  "visualDiffs": [
    {
      "diffType": "full_page",
      "diffPercentage": 0.012,
      "diffImagePath": "uuid-del-scan/diff-full.png",
      "thresholdUsed": 0.05
    }
  ],
  "baselineInfo": { "scanId": "uuid-scan-baseline", "isManual": true, "createdAt": "2026-01-01T00:00:00.000Z" },
  "stepResults": []
}
```

`visualDiffs`, `baselineInfo` y `stepResults` solo aparecen cuando aplica (regresion visual con baseline previa / modo flujo).

### GET /api/reports

Lista los reportes historicos, paginados.

**Query Parameters:**
- `limit` (opcional, default 20)
- `offset` (opcional, default 0)

### POST /api/scans/:id/set-baseline

Marca o desmarca un scan como baseline manual para regresion visual. Al marcar uno, desmarca cualquier otro baseline manual de la misma URL.

**Request Body:** `{ "isBaseline": true }`

**Response (200):** `{ "success": true }`

### GET /api/flows

Lista los flujos guardados (`id`, `name`, `createdAt`, `updatedAt`; sin `steps` para aligerar la respuesta).

### GET /api/flows/:id

Obtiene un flujo guardado completo, incluyendo `steps`.

### POST /api/flows

Crea un flujo. **Body:** `{ "name": "Login", "steps": [...] }` (steps validados con `FlowStepSchema`).

### PUT /api/flows/:id

Actualiza nombre y/o pasos de un flujo existente.

### DELETE /api/flows/:id

Elimina un flujo guardado.

### POST /api/ai/explain

Genera una explicacion en espanol de un issue via OpenRouter (ver `AGENTS.md` > OpenRouter LLM Integration).

**Request Body:**
```json
{
  "type": "BROKEN_RESOURCE",
  "severity": "HIGH",
  "description": "Imagen no se cargo: /image.png (404)",
  "url": "https://example.com",
  "model": "google/gemini-2.5-flash-lite"
}
```

`model` es opcional (default del servidor); si se envia, debe estar en la whitelist de `AiService.ts`.

**Response (200):** `{ "explanation": "..." }`

**Errores:** `400` (modelo no permitido / body invalido), `503` (falta `OPENROUTER_API_KEY` en el servidor), `502` (error de OpenRouter), `504` (timeout, 20s).

### GET /api/ai/status

**Response (200):** `{ "configured": true, "defaultModel": "google/gemini-2.5-flash-lite" }`

### GET /screenshots/:scanId/:filename

Sirve un screenshot capturado. `scanId` validado como UUID v4; `filename` rechaza `..`, `/` y `\`.

### GET /health

Sin autenticacion. `{ "status": "ok", "timestamp": "..." }`

## Tipos de Issues

| Tipo | Severidad | Descripcion |
|---|---|---|
| `BROKEN_RESOURCE` | HIGH/MEDIUM | Recursos que no cargan (imagenes, CSS, JS, fuentes) |
| `FAILED_API` | HIGH/MEDIUM | Llamadas XHR/fetch fallidas, lentas o con error CORS |
| `INTERACTIVITY` | MEDIUM/LOW | Botones muertos, enlaces sin destino |
| `EMPTY_CONTENT` | HIGH | Contenedores vacios, errores visibles |
| `LAZY_LOAD` | HIGH/MEDIUM | Imagenes no cargadas, spinners atascados |
| `FORM_MODAL` | MEDIUM | Formularios sin submit/action, modales sin cierre, banners bloqueantes |
| `CONSOLE_ERROR` | HIGH/MEDIUM | Errores JS o CORS en consola del navegador |
| `PERFORMANCE` | HIGH/MEDIUM/LOW | TTFB, DOMContentLoaded, carga total, nodos DOM |
| `ACCESSIBILITY` | HIGH/MEDIUM/LOW | Violaciones WCAG via axe-core |
| `FLOW_ERROR` | HIGH | Fallo al ejecutar un paso de un flujo interactivo |

## Severidades

| Nivel | Descripcion |
|---|---|
| `HIGH` | Problema critico que afecta funcionalidad |
| `MEDIUM` | Problema significativo que impacta la experiencia |
| `LOW` | Mejora recomendada |
