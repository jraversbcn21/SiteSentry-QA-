# Screenshots por Issue — Design Spec

**Fecha:** 2026-06-20
**Fase:** 1 de 3 (Fundacion Visual)
**Enfoque:** A — Fundacion Visual

## Resumen

Agregar captura de screenshots al scanner de SiteSentry. Cada scan produce un screenshot full-page y screenshots de elemento para issues HIGH. Los screenshots se sirven via API, se muestran en el frontend, y sientan la base para Visual Regression (Fase 2) y Flujos Interactivos (Fase 3).

---

## 1. Captura de Screenshots

### Tipos de captura

| Tipo | Metodo | Cuando |
|------|--------|--------|
| Full-page | `page.screenshot({ fullPage: true, type: 'png' })` | 1 por scan, siempre, al finalizar checkers |
| Elemento | `elementHandle.screenshot({ type: 'png' })` | Solo issues HIGH con selector CSS en metadata |

### Flujo en ScanWorker

```
1. Ejecutar PageAnalyzer.analyze(url)
2. Ejecutar los 6 checkers → issues[]
3. Capturar full-page screenshot → data/screenshots/{scanId}/full.png
4. Para cada issue HIGH con metadata.selector:
   a. page.locator(selector).first()
   b. element.screenshot() → data/screenshots/{scanId}/{issueId}.png
   c. Asignar issue.screenshot_path = '{scanId}/{issueId}.png'
5. Persistir issues en DB
```

### Selectores desde los checkers

Cada checker que detecte issues HIGH incluye un campo `selector` en el metadata del issue con un selector CSS valido hacia el elemento problematico. Los checkers no toman screenshots — solo proveen el selector.

| Checker | Issues HIGH que generan selector |
|---------|-------------------------------|
| BrokenResourcesChecker | Imagenes rotas (img[src="..."]), scripts rotos (script[src="..."]) |
| FailedAPIChecker | Ninguno — errores de red sin elemento visual |
| InteractivityChecker | Ninguno — solo MEDIUM/LOW |
| ContentChecker | Contenedores vacios (#results, .error-message, main, etc.) |
| LazyLoadChecker | Spinners atascados (.loading-spinner, .skeleton, etc.) |
| FormModalChecker | Ninguno — solo MEDIUM/LOW |

### Formato

- PNG sin compresion adicional
- Playwright maneja la codificacion internamente

---

## 2. Almacenamiento

### Filesystem

```
backend/data/screenshots/{scan_id}/
├── full.png
├── {issue_id_1}.png
├── {issue_id_2}.png
└── ...
```

### Base de datos

Columna nueva en tabla `issues`:

```sql
ALTER TABLE issues ADD COLUMN screenshot_path TEXT;
```

- `NULL` si el issue no tiene screenshot
- Ruta relativa al directorio `screenshots/`, ej: `abc123/full.png` o `abc123/def456.png`

### Limpieza

Al eliminar un scan, se borra su directorio de screenshots con `fs.rmSync(dir, { recursive: true })`.

---

## 3. API — Serving

### Nueva ruta

```
GET /screenshots/:scanId/:filename
```

- Lee `data/screenshots/:scanId/:filename`
- Responde con `Content-Type: image/png`
- Header `Cache-Control: public, max-age=86400`
- Si el archivo no existe → 404

El proxy de Vite (`/screenshots` → `http://127.0.0.1:3001`) ya existe en `frontend/vite.config.ts`, sin cambios necesarios.

### Campo nuevo en GET /api/reports/:id

```json
{
  "fullPageScreenshot": "scan-abc/full.png",
  "issues": [
    {
      "id": "uuid-1",
      "screenshot_path": "scan-abc/uuid-1.png",
      ...
    }
  ],
  ...
}
```

`fullPageScreenshot` es `null` si la captura fallo.

---

## 4. Frontend

### Componentes nuevos

| Componente | Proposito |
|-----------|-----------|
| `ScreenshotThumb` | Thumbnail con lazy-load, placeholder, click → abre Lightbox. Props: `path: string`, `alt: string`, `maxHeight?: number` |
| `Lightbox` | Modal full-screen con overlay. Imagen a tamano completo con scroll vertical. Cierre: boton X, tecla ESC, click fuera. |

### Cambios en componentes existentes

**ReportViewer.tsx** — Debajo del titulo y summary stats, si `fullPageScreenshot` existe, renderiza `<ScreenshotThumb>` con texto "Ver screenshot completo de la pagina".

**ErrorCard.tsx** — Dentro del dropdown "Detalles tecnicos", debajo de la tabla de metadatos y antes de los botones de accion, si `issue.screenshot_path` existe, renderiza `<ScreenshotThumb>`.

---

## 5. Manejo de Errores

### Principio: los screenshots son "best effort"

Un fallo de screenshot **nunca** hace fallar el scan.

| Escenario | Comportamiento |
|-----------|---------------|
| `page.screenshot()` falla | Warning en log, `fullPageScreenshot = null`, scan continua |
| `element.screenshot()` falla | Debug en log, se omite ese issue, scan continua |
| Directorio `screenshots/` no existe | Se crea con `mkdirSync({ recursive: true })`. Si falla, log + continuar sin screenshots |
| Disco lleno | Error de escritura capturado, log, continuar sin ese screenshot |
| Selector no encontrado en el DOM | `page.locator()` no matchea → se omite, sin error |
| Selector matchea multiples elementos | `.first()` captura solo el primero |
| Pagina muy larga (>50K px) | Playwright maneja full-page internamente. Si falla por memoria, fallback a viewport screenshot |
| Issue HIGH sin selector (ej: FAILED_API) | No se intenta capturar — es esperado |

---

## 6. Archivos Modificados

### Backend (8 archivos)

| Archivo | Cambio |
|---------|--------|
| `src/workers/ScanWorker.ts` | Funciones `captureFullPageScreenshot()` y `captureIssueScreenshots()`. Creacion de directorio. Asignacion de `screenshot_path` a issues. |
| `src/checkers/ContentChecker.ts` | Agregar `selector` al metadata de issues HIGH |
| `src/checkers/LazyLoadChecker.ts` | Agregar `selector` al metadata de issues HIGH |
| `src/checkers/BrokenResourcesChecker.ts` | Agregar `selector` al metadata de issues HIGH |
| `src/types/index.ts` | Campo `screenshot_path?: string` en interfaz `Issue`. Campo `fullPageScreenshot: string | null` en tipo de respuesta de report. |
| `src/database/db.ts` | `ALTER TABLE issues ADD COLUMN screenshot_path TEXT` |
| `src/api/routes/reports.ts` | Incluir `fullPageScreenshot` en respuesta de `GET /api/reports/:id` |
| `src/api/server.ts` | Nueva ruta `GET /screenshots/:scanId/:filename` |

### Frontend (4 archivos)

| Archivo | Cambio |
|---------|--------|
| `src/components/ScreenshotThumb/ScreenshotThumb.tsx` | NUEVO — thumbnail con lazy-load y click → lightbox |
| `src/components/Lightbox/Lightbox.tsx` | NUEVO — modal full-screen para imagenes |
| `src/components/ErrorCard/ErrorCard.tsx` | Renderizar `<ScreenshotThumb>` si `issue.screenshot_path` existe |
| `src/components/ReportViewer/ReportViewer.tsx` | Renderizar `<ScreenshotThumb>` para full-page screenshot |

---

## 7. Fuera de Scope (Fases 2 y 3)

- Visual Regression (comparacion pixel a pixel con baseline)
- Flujos interactivos (importar scripts codegen, ejecutar pasos)
- Screenshots en navegadores alternativos (Firefox, WebKit)
- PDF reports
- Accesibilidad
- Multi-dispositivo / mobile emulation
