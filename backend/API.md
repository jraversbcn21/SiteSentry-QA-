# API Documentation

## Endpoints

### POST /api/scan

Inicia un nuevo analisis de una pagina web.

**Request Body:**
```json
{
  "url": "https://example.com",
  "config": {
    "timeout": 60000
  }
}
```

Solo `url` es obligatorio. `config.timeout` es opcional (default: 60000ms).

**Response (201):**
```json
{
  "id": "uuid-del-scan",
  "status": "PENDING",
  "url": "https://example.com",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### GET /api/scan/:id/status

Obtiene el estado actual de un analisis.

**Response (200):**
```json
{
  "id": "uuid-del-scan",
  "status": "RUNNING",
  "url": "https://example.com",
  "progress": {
    "phase": "running_checks"
  },
  "createdAt": "2024-01-01T00:00:00.000Z",
  "completedAt": null
}
```

**Fases de progreso:**
- `launching_browser`: Iniciando navegador
- `loading_page`: Cargando la pagina
- `running_checks`: Ejecutando checkers
- `saving_results`: Guardando resultados

**Status posibles:**
- `PENDING`: En cola
- `RUNNING`: En progreso
- `COMPLETED`: Completado
- `FAILED`: Fallido

### GET /api/reports/:id

Obtiene el reporte completo de un analisis.

**Response (200):**
```json
{
  "id": "uuid-del-scan",
  "url": "https://example.com",
  "status": "COMPLETED",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "completedAt": "2024-01-01T00:00:45.000Z",
  "issues": [
    {
      "type": "BROKEN_RESOURCE",
      "severity": "HIGH",
      "url": "https://example.com/image.png",
      "sourceUrl": "https://example.com",
      "description": "Imagen no se cargo: /image.png (404)",
      "metadata": {
        "statusCode": 404,
        "resourceType": "image"
      }
    }
  ],
  "summary": {
    "total": 5,
    "byType": {
      "BROKEN_RESOURCE": 2,
      "FAILED_API": 1,
      "INTERACTIVITY": 1,
      "EMPTY_CONTENT": 1,
      "LAZY_LOAD": 0,
      "FORM_MODAL": 0
    },
    "bySeverity": {
      "HIGH": 2,
      "MEDIUM": 2,
      "LOW": 1
    }
  }
}
```

### GET /api/reports

Lista los reportes historicos.

**Query Parameters:**
- `limit` (opcional): Maximo de resultados (default: 20)
- `offset` (opcional): Offset para paginacion (default: 0)

## Tipos de Issues

| Tipo | Descripcion |
|---|---|
| `BROKEN_RESOURCE` | Recursos que no cargan (imagenes, CSS, JS, fuentes) |
| `FAILED_API` | Llamadas XHR/fetch fallidas, lentas o con error CORS |
| `INTERACTIVITY` | Botones muertos, enlaces sin destino, estados inconsistentes |
| `EMPTY_CONTENT` | Contenedores vacios, errores visibles, fallo de renderizado |
| `LAZY_LOAD` | Imagenes no cargadas, spinners atascados, placeholders |
| `FORM_MODAL` | Formularios sin submit/action, modales sin cierre, banners bloqueantes |

## Severidades

| Nivel | Descripcion |
|---|---|
| `HIGH` | Problema critico que afecta funcionalidad |
| `MEDIUM` | Problema significativo que impacta la experiencia |
| `LOW` | Mejora recomendada |
