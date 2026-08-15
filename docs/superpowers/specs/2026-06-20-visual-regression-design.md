# Visual Regression — Design Spec

**Fecha:** 2026-06-20
**Fase:** 2 de 3 (Visual Regression)
**Depende de:** Fase 1 — Screenshots por Issue

## Resumen

Agregar deteccion de regresion visual a SiteSentry comparando screenshots entre scans de la misma URL usando `pixelmatch`. Al finalizar un scan, el worker busca un baseline (manual o automatico), ejecuta el diff para full-page y por elemento, y persiste los resultados. El frontend muestra un comparador visual con slider, diff.png y porcentaje de diferencia.

---

## 1. Baseline Management

### Seleccion de baseline

| Modo | Comportamiento |
|------|---------------|
| Automatico (default) | Usa el ultimo scan completado de la misma URL (excluyendo el scan actual) |
| Manual | El usuario marca un scan como baseline via UI. Solo un baseline manual por URL. |

### Marcar/desmarcar baseline

- Nueva ruta: `POST /api/scans/:id/set-baseline`
- Body: `{ "isBaseline": true }` o `{ "isBaseline": false }`
- Al marcar un scan como baseline, se desmarca cualquier otro baseline manual de la misma URL (solo puede haber uno)
- El baseline manual tiene prioridad sobre el automatico

### Columna en BD

```sql
ALTER TABLE scans ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0;
```

- `1` = baseline manual, `0` = no es baseline manual
- El baseline automatico no usa esta columna (se deduce: ultimo scan completado)

---

## 2. Almacenamiento de Diffs

### Nueva tabla `visual_diffs`

```sql
CREATE TABLE IF NOT EXISTS visual_diffs (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL,
  baseline_scan_id TEXT NOT NULL,
  diff_type TEXT NOT NULL,        -- 'full_page' | 'element'
  issue_id TEXT,                  -- NULL para full_page; FK informal a issues.id para element
  element_identifier TEXT,        -- selector CSS o "type:url" usado para emparejar
  diff_percentage REAL NOT NULL,  -- 0.0 a 100.0
  diff_image_path TEXT,           -- "{scanId}/diff-{full|issueId}.png"
  threshold_used REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE,
  FOREIGN KEY (baseline_scan_id) REFERENCES scans(id) ON DELETE CASCADE
);
```

### Filesystem

Los diffs se guardan en el mismo directorio de screenshots del scan:

```
backend/data/screenshots/{scan_id}/
├── full.png
├── diff-full.png              ← nuevo
├── {issue_id_1}.png
├── diff-{issue_id_1}.png      ← nuevo (si el elemento matcheo)
├── {issue_id_2}.png
└── ...
```

### Migracion

Idempotente via `try/catch` con deteccion de `duplicate column name` / `duplicate table`, igual que las migraciones existentes en `db.ts`.

---

## 3. Worker — Visual Regression Step

### Ubicacion

Nuevo paso en `ScanWorker.processScanJob()`, despues de persistir issues y antes de marcar el scan como COMPLETED.

### Algoritmo `runVisualRegression(scanId, url, allIssues, config)`

```
1. Buscar baseline:
   a) SELECT * FROM scans WHERE url = ? AND is_baseline = 1 ORDER BY created_at DESC LIMIT 1
   b) Si no hay → SELECT * FROM scans WHERE url = ? AND id != ? AND status = 'COMPLETED' ORDER BY created_at DESC LIMIT 1
   c) Si no hay → salir (primer scan de esta URL, no hay nada que comparar)

2. Determinar threshold:
   config.visualDiffThreshold ?? process.env.VISUAL_DIFF_THRESHOLD ?? 0.05

3. Full-page diff:
   a) Cargar data/screenshots/{baselineScanId}/full.png
   b) Cargar data/screenshots/{scanId}/full.png
   c) Si alguna no existe → skip full-page diff
   d) Redimensionar ambas al tamaño comun mas pequeño (pixelmatch requiere mismas dimensiones)
   e) Ejecutar pixelmatch → diffPixels, diffImage (PNG buffer)
   f) Guardar diffImage en data/screenshots/{scanId}/diff-full.png
   g) INSERT INTO visual_diffs (diff_type='full_page')

4. Element diffs:
   Para cada issue HIGH del scan actual con screenshot_path:
   a) Buscar issue equivalente en el baseline:
      - Primero: mismo metadata.selector (string exacta)
      - Fallback: mismo IssueType + misma url
   b) Si el issue del baseline tiene screenshot_path:
      - Cargar ambas imagenes de elemento
      - Redimensionar al tamaño comun mas pequeño
      - Ejecutar pixelmatch
      - Guardar diffImage en data/screenshots/{scanId}/diff-{issueId}.png
      - INSERT INTO visual_diffs (diff_type='element', issue_id, element_identifier)
   c) Si no matchea → skip ese elemento
```

### Manejo de errores

- El paso de visual regression es **best effort**: un fallo en el diff no hace fallar el scan
- Si `pixelmatch` falla (ej. imagenes corruptas) → log warning, continuar
- Si el baseline no tiene `full.png` → skip full-page diff
- Si una imagen de elemento no se encuentra → skip ese element diff
- Todo envuelto en try/catch; el catch loguea y deja el scan marcado COMPLETED

---

## 4. API

### `GET /api/reports/:id` — Campos nuevos en la respuesta

```json
{
  "visualDiffs": [
    {
      "id": "uuid",
      "diffType": "full_page",
      "baselineScanId": "uuid-del-baseline",
      "diffPercentage": 2.3,
      "diffImagePath": "scanId/diff-full.png",
      "thresholdUsed": 0.05,
      "elementIdentifier": null,
      "issueId": null
    },
    {
      "id": "uuid",
      "diffType": "element",
      "baselineScanId": "uuid-del-baseline",
      "diffPercentage": 5.1,
      "diffImagePath": "scanId/diff-issue-uuid.png",
      "thresholdUsed": 0.05,
      "elementIdentifier": ".main-content",
      "issueId": "uuid-del-issue-actual"
    }
  ],
  "baselineInfo": {
    "scanId": "uuid-del-baseline",
    "isManual": true,
    "createdAt": "2026-06-20T10:00:00.000Z"
  }
}
```

- `visualDiffs`: array vacio si no hay baseline (primer scan)
- `baselineInfo`: null si no hay baseline

### `POST /api/scans/:id/set-baseline`

- Body: `{ "isBaseline": boolean }`
- Si `isBaseline=true`: desmarca cualquier otro baseline de la misma URL, marca este
- Si `isBaseline=false`: desmarca este scan
- Responde 200 con `{ success: true }`
- Responde 404 si el scan no existe

### `POST /api/scan` — Nuevo parametro opcional

```json
{
  "url": "https://example.com",
  "visualDiffThreshold": 0.03   // opcional, overridea VISUAL_DIFF_THRESHOLD
}
```

- Se almacena en `scans.config` como JSON
- El worker lo lee de ahi

### Servir diffs

La ruta `GET /screenshots/:scanId/:filename` ya sirve cualquier archivo en el directorio de screenshots, incluyendo `diff-full.png` y `diff-{issueId}.png`. Sin cambios necesarios.

---

## 5. Frontend

### Nuevo componente: `VisualDiffViewer`

**Props:**
```ts
interface VisualDiffViewerProps {
  baselineSrc: string;       // URL de la imagen baseline
  currentSrc: string;        // URL de la imagen actual
  diffSrc: string;           // URL del diff.png
  diffPercentage: number;    // 0-100
  threshold: number;         // umbral usado
  alt: string;
}
```

**Comportamiento:**
1. Slider horizontal: muestra `baselineSrc` a la izquierda y `currentSrc` a la derecha, con un handle deslizable que mueve la linea divisoria
2. Debajo del slider: el `diffSrc` con pixeles diferentes resaltados en rojo
3. Badge de porcentaje: "X.X% diferente" — rojo si > threshold, verde si <= threshold
4. Label: "Baseline" a la izquierda, "Actual" a la derecha

**Implementacion del slider:** CSS `clip-path` o dos `div` con `overflow: hidden` y un `input[type=range]` controlando el ancho. Sin dependencias externas.

### Cambios en `ReportViewer.tsx`

- Nueva seccion "Regresion Visual" despues del resumen de issues (score, byType, bySeverity) y antes de la lista de issues
- Full-page diff: renderiza `<VisualDiffViewer>` con las 3 rutas de screenshots
- Si no hay baseline: muestra mensaje "Sin baseline para comparar. Realiza otro scan de esta URL para ver diffs."
- Boton "Marcar como baseline" / "Quitar baseline" en el header del reporte
- Info del baseline usado: "Comparado contra scan del DD/MM/AAAA" con indicador "(manual)" si aplica

### Cambios en `ErrorCard.tsx`

- Si el issue tiene un element diff asociado (buscando en `visualDiffs` por `issueId`), renderizar `<VisualDiffViewer>` dentro del `<details>` de "Detalles tecnicos"
- El `VisualDiffViewer` del elemento usa menos altura maxima (maxHeight=200)

### Nuevos tipos en `frontend/src/types/index.ts`

```ts
export interface VisualDiff {
  id: string;
  diffType: 'full_page' | 'element';
  baselineScanId: string;
  diffPercentage: number;
  diffImagePath: string;
  thresholdUsed: number;
  elementIdentifier?: string;
  issueId?: string;
}

export interface BaselineInfo {
  scanId: string;
  isManual: boolean;
  createdAt: string;
}

// Agregar a ReportResponse
export interface ReportResponse {
  // ... existentes
  visualDiffs: VisualDiff[];
  baselineInfo: BaselineInfo | null;
}
```

### Dependencias nuevas (backend)

```json
"pixelmatch": "^5.3.0",   // comparacion pixel a pixel (puro JS)
"pngjs": "^7.0.0",         // decode/encode PNG a raw pixels
"sharp": "^0.33.0"         // redimension de imagenes para igualar dimensiones
```

`pixelmatch` requiere que ambas imagenes tengan las mismas dimensiones. `sharp` se usa para redimensionar ambas al tamaño comun mas pequeño antes del diff. `pngjs` convierte entre PNG y buffers de pixeles RGBA que `pixelmatch` consume/produce.

---

## 6. Configuracion

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `VISUAL_DIFF_THRESHOLD` | `0.05` | Umbral global de pixelmatch (0.0-1.0). Menor = mas sensible. |

Override por scan via `POST /api/scan` body `visualDiffThreshold`.

---

## 7. Manejo de Errores

| Escenario | Comportamiento |
|-----------|---------------|
| No hay baseline (primer scan) | `visualDiffs: []`, `baselineInfo: null`. Sin error. |
| `full.png` del baseline no existe | Skip full-page diff, log warning |
| Imagen de elemento no encontrada en baseline | Skip ese element diff, log debug |
| `pixelmatch` lanza error | Log warning, skip ese diff, continuar |
| Directorio screenshots no existe | No se llega a este punto (ya fue creado en paso de screenshots) |
| Disco lleno al escribir diff | Log error, skip ese diff, continuar |
| Baseline eliminado (scan borrado) | El diff queda huerfano. Reporte muestra el diff existente pero sin `baselineInfo`. |
| `POST /api/scans/:id/set-baseline` con scan inexistente | 404 |

### Principio

La regresion visual es **best effort**. Un fallo en cualquier paso de diff nunca hace fallar el scan. El scan se marca COMPLETED independientemente.

---

## 8. Archivos Modificados

### Backend (7 archivos)

| Archivo | Cambio |
|---------|--------|
| `src/workers/ScanWorker.ts` | Nueva funcion `runVisualRegression()`. Importar `pixelmatch` y `pngjs`. |
| `src/database/db.ts` | `ALTER TABLE scans ADD COLUMN is_baseline` + `CREATE TABLE visual_diffs` |
| `src/types/index.ts` | Nuevas interfaces `VisualDiff`, `BaselineInfo`. Campo `visualDiffs` y `baselineInfo` en respuesta de report. |
| `src/api/routes/reports.ts` | Query a `visual_diffs` y `scans` para incluir diffs y baselineInfo en GET /api/reports/:id |
| `src/api/routes/scan.ts` | Nuevo parametro `visualDiffThreshold` en POST /api/scan. Guardar en scans.config. |
| `src/api/server.ts` | Nueva ruta `POST /api/scans/:id/set-baseline` |
| `package.json` | Agregar `pixelmatch`, `pngjs` (decode/encode PNG) y `sharp` (redimension) |

### Frontend (5 archivos)

| Archivo | Cambio |
|---------|--------|
| `src/components/VisualDiffViewer/VisualDiffViewer.tsx` | NUEVO — slider side-by-side + diff.png + badge |
| `src/components/VisualDiffViewer/VisualDiffViewer.css` | NUEVO — estilos del slider y diff |
| `src/components/ReportViewer/ReportViewer.tsx` | Seccion "Regresion Visual" + boton marcar/desmarcar baseline + info baseline |
| `src/components/ErrorCard/ErrorCard.tsx` | Renderizar `<VisualDiffViewer>` si hay element diff para ese issue |
| `src/types/index.ts` | Interfaces `VisualDiff`, `BaselineInfo`. Actualizar `ReportResponse`. |
| `src/services/api.ts` | Nuevo metodo `setBaseline(scanId, isBaseline)` |

---

## 9. Fuera de Scope

- Comparacion entre diferentes URLs
- Multiples baselines por URL
- Aprobacion/rechazo de diffs (solo deteccion)
- Historial de diffs (solo se muestra el diff contra el baseline actual)
- Diffs en navegadores alternativos (solo Chromium)
- Diffs de elementos no-HIGH (solo elementos con screenshot, que son HIGH con selector)
