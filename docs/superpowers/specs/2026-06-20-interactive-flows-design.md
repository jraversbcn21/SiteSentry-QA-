# Interactive Flows — Design Spec

**Fecha:** 2026-06-20
**Fase:** 3 de 3 (Interactive Flows)
**Depende de:** Fase 1 (Screenshots) + Fase 2 (Visual Regression)

## Resumen

Agregar soporte para flujos interactivos multi-paso en SiteSentry. El usuario define pasos (navegar, click, escribir, esperar) en formato JSON declarativo o importa scripts de Playwright codegen. El scanner ejecuta cada paso, corre los 9 checkers al final de cada paso, captura screenshots por paso, y presenta resultados en tabs por paso en el frontend. Reutiliza toda la infraestructura de screenshots (Fase 1) y visual regression (Fase 2).

---

## 1. Formato de Pasos

### JSON declarativo

```json
[
  { "action": "navigate", "url": "https://example.com/login" },
  { "action": "type", "selector": "#username", "value": "admin" },
  { "action": "type", "selector": "#password", "value": "pass123" },
  { "action": "click", "selector": "button[type=submit]" },
  { "action": "wait", "ms": 2000 },
  { "action": "checkpoint" }
]
```

### Acciones soportadas

| Acción | Parámetros | Descripción |
|--------|-----------|-------------|
| `navigate` | `url` (string) | Navega a una URL. Resetea network/console events para este paso. |
| `click` | `selector` (string) | Click en el primer elemento que matchea el selector CSS. |
| `type` | `selector` (string), `value` (string) | Escribe texto en un input/textarea. |
| `wait` | `ms` (number) | Espera N milisegundos. |
| `select` | `selector` (string), `value` (string) | Selecciona una opcion en un `<select>` por value. |
| `hover` | `selector` (string) | Hover sobre un elemento. |
| `press` | `key` (string) | Presiona una tecla (Enter, Tab, Escape, etc.). |
| `checkpoint` | — (sin params) | Dispara ejecucion de checkers + captura de screenshots en este punto del flujo. |

### Conversor codegen → JSON

El usuario pega un script generado por `playwright codegen` en la UI. SiteSentry parsea el script y extrae las acciones:

| Codegen | JSON |
|---------|------|
| `await page.goto('https://...')` | `{ "action": "navigate", "url": "..." }` |
| `await page.click('#btn')` | `{ "action": "click", "selector": "#btn" }` |
| `await page.fill('#input', 'text')` | `{ "action": "type", "selector": "#input", "value": "text" }` |
| `await page.waitForTimeout(1000)` | `{ "action": "wait", "ms": 1000 }` |
| `await page.selectOption('#s', 'v')` | `{ "action": "select", "selector": "#s", "value": "v" }` |
| `await page.hover('#el')` | `{ "action": "hover", "selector": "#el" }` |
| `await page.press('#el', 'Enter')` | `{ "action": "press", "selector": "#el", "key": "Enter" }` |

El parseo es regex-based (no ejecuta el script). Acciones no reconocidas se ignoran con warning.

---

## 2. Almacenamiento de Flujos

### Nueva tabla `flows`

```sql
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,         -- JSON array de pasos
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### API CRUD de flujos

| Método | Ruta | Body / Response |
|--------|------|-----------------|
| `GET` | `/api/flows` | `[ { id, name, steps, createdAt, updatedAt } ]` |
| `GET` | `/api/flows/:id` | `{ id, name, steps, createdAt, updatedAt }` |
| `POST` | `/api/flows` | Body: `{ name, steps }` → 201 |
| `PUT` | `/api/flows/:id` | Body: `{ name?, steps? }` → 200 |
| `DELETE` | `/api/flows/:id` | → 200 `{ success: true }` |

Validaciones: `name` requerido (1-200 chars), `steps` requerido (array valido JSON con al menos 1 paso, cada paso con `action` valido).

---

## 3. POST /api/scan Extendido

```json
{
  "url": "https://example.com",
  "visualDiffThreshold": 0.03,
  "flow": {
    "name": "Login flow",
    "steps": [
      { "action": "navigate", "url": "https://example.com/login" },
      { "action": "type", "selector": "#user", "value": "admin" },
      { "action": "click", "selector": "button" }
    ]
  },
  "flowId": "uuid-de-flujo-guardado"
}
```

**Resolucion:**
- Si `flow` esta presente → se usa inline (tiene prioridad).
- Si solo `flowId` → se carga de la tabla `flows`.
- Si ninguno → scan normal sin flujo.
- El worker siempre recibe `config.flow = { name, steps }` resuelto.

**GET /api/scan/:id/status** incluye progreso por paso:
```json
{
  "progress": {
    "phase": "running_flow_step",
    "step": { "index": 2, "total": 5, "action": "click" }
  }
}
```

---

## 4. Worker — Ejecucion del Flujo

### Modo sin flujo (sin cambios)

Comportamiento actual sin modificaciones.

### Modo con flujo

```
1. Crear browser + contexto fresco
2. Crear page inicial
3. Para cada step (index 0..N-1):
   a. Ejecutar accion del paso (click, type, navigate, wait, etc.)
   b. Si el paso es "navigate": resetear networkEvents y consoleErrors
      (se recrean los listeners para capturar solo eventos de este paso)
   c. Si es checkpoint O es el ultimo paso O es navigate:
      - Ejecutar PageAnalyzer.fullScroll(page)
      - Ejecutar los 9 checkers con page + networkEvents + consoleErrors actuales
      - Asignar stepIndex a cada issue detectado
      - Capturar full-page screenshot → data/screenshots/{scanId}/step-{index}-full.png
      - Capturar element screenshots para issues HIGH con selector
      - Los screenshots usan prefijo "step-{index}-" en el filename
4. Cerrar page
5. Persistir todos los issues (con step_index)
6. Visual regression: comparar el full-page del ultimo paso contra baseline
   (misma URL, mismo comportamiento que Fase 2)
7. Marcar scan COMPLETED
```

### Nuevo campo en issues

```sql
ALTER TABLE issues ADD COLUMN step_index INTEGER;
```

- `NULL` = scan normal sin flujo
- `0, 1, 2...` = indice del paso donde se detecto el issue

### Manejo de errores por paso

- Si una accion falla (selector no encontrado, timeout): se registra un issue `FLOW_ERROR` con severity HIGH y se continua con el siguiente paso.
- Si `navigate` falla (404, timeout): se registra `FLOW_ERROR` y se aborta el flujo (no tiene sentido continuar sin pagina).
- El principio best-effort de Fase 2 se mantiene: un fallo en un paso no hace fallar el scan completo.

### Nuevo IssueType

```typescript
FLOW_ERROR = 'FLOW_ERROR'
```

Usado para errores de ejecucion del flujo (accion fallida, navegacion fallida). Severity HIGH.

---

## 5. API — GET /api/reports/:id Extendido

```json
{
  "id": "uuid",
  "url": "https://example.com",
  "status": "COMPLETED",
  "flow": {
    "name": "Login flow",
    "steps": [
      { "index": 0, "action": "navigate", "url": "https://example.com/login" },
      { "index": 1, "action": "type", "selector": "#user" },
      { "index": 2, "action": "click", "selector": "button" }
    ]
  },
  "steps": [
    {
      "index": 0,
      "action": "navigate",
      "label": "Navegar a /login",
      "issues": [ ... ],
      "fullPageScreenshot": "scanId/step-0-full.png",
      "summary": { "total": 3, "byType": {...}, "bySeverity": {...} }
    }
  ],
  "issues": [ ... ],
  "fullPageScreenshot": "scanId/step-last-full.png",
  "visualDiffs": [ ... ],
  "baselineInfo": { ... },
  "summary": { ... }
}
```

- `flow`: presente solo si el scan uso flujo. Incluye name + steps (con sus definiciones originales).
- `steps[]`: resultados por paso. `label` generado automaticamente: "Navegar a /login", "Escribir en #user", "Click en button", "Esperar 2s", etc.
- `issues[]`: todos los issues con `stepIndex`.
- `fullPageScreenshot`: screenshot del ultimo paso (usado para visual regression).
- `summary`: total de todos los pasos combinados.

---

## 6. Screenshots por Paso

```
backend/data/screenshots/{scan_id}/
├── step-0-full.png          ← full-page del paso 0
├── step-0-{issueId}.png     ← elemento del paso 0
├── step-1-full.png
├── step-1-{issueId}.png
├── step-2-full.png          ← ultimo paso (usado para diff)
├── diff-full.png            ← visual regression
└── ...
```

Sirviendo: `GET /screenshots/:scanId/:filename` ya funciona sin cambios.

---

## 7. Frontend — Creacion de Flujos

### Componente FlowEditor

- **Textarea "Script Codegen"**: el usuario pega un script de Playwright codegen.
- **Boton "Convertir"**: parsea el script y genera la lista de pasos editables.
- **Lista de pasos**: cada paso es una fila con:
  - Icono de accion (🌐 navigate, 🖱️ click, ⌨️ type, ⏱️ wait, 📋 select, 👆 hover, ⌨️ press, 📸 checkpoint)
  - Selector/valor editables
  - Botones: 🗑️ eliminar, ↕️ reordenar (drag o flechas)
- **Boton "+ Agregar paso"**: agrega un paso vacio para editar manualmente.
- **Input "Nombre del flujo"**: para guardar.
- **Botones**: "Guardar flujo" (POST/PUT), "Usar en este scan" (cierra editor y setea flow inline).

### Cambios en Home.tsx

- Nuevo selector: dropdown de flujos guardados (`GET /api/flows`).
- Boton "Nuevo flujo" que abre el FlowEditor en un modal.
- Boton "Pegar codegen" para abrir el editor con el textarea enfocado.
- Al iniciar scan, incluye `flow` o `flowId` en `startScan()`.

---

## 8. Frontend — Resultados por Paso

### ReportViewer — Tabs de pasos

Cuando `report.flow` existe, se renderiza una barra de tabs arriba del reporte:

```
[ 📄 Paso 1: Navegar a /login (3) ] [ ⌨️ Paso 2: Escribir en #user (1) ] [ 🖱️ Paso 3: Click en button (5) ] [ 📊 Resumen ]
```

- Cada tab muestra el paso con su accion + label + contador de issues.
- Tab "Resumen" muestra todos los issues combinados (vista actual del ReportViewer).
- Al clickear un tab, se filtran `issues` por `stepIndex`.
- Cada tab tiene su propio score, summary cards, y full-page screenshot.
- La seccion de visual regression aparece en el tab "Resumen" (dif del ultimo paso).
- Los filtros de tipo/severidad aplican dentro del paso seleccionado.

### Cambios en tipos

**Nuevo `IssueType`:**
```typescript
FLOW_ERROR = 'FLOW_ERROR'
```

**Nuevas interfaces frontend:**
```typescript
interface FlowStep {
  action: string;
  url?: string;
  selector?: string;
  value?: string;
  ms?: number;
  key?: string;
}

interface FlowInfo {
  name: string;
  steps: FlowStep[];
}

interface StepResult {
  index: number;
  action: string;
  label: string;
  issues: Issue[];
  fullPageScreenshot: string | null;
  summary: {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}
```

**ReportResponse actualizado:**
```typescript
interface ReportResponse {
  // ... existentes
  flow?: FlowInfo;
  steps?: StepResult[];
}
```

**ScanRequest actualizado:**
```typescript
interface ScanRequest {
  url: string;
  visualDiffThreshold?: number;
  flow?: { name: string; steps: FlowStep[] };
  flowId?: string;
  config?: { timeout?: number };
}
```

### Registro de FLOW_ERROR en typeConfig/typeIcon/typeLabel

Agregar en los 3 lugares (ErrorGroup, ErrorCard, ReportViewer):
```typescript
[IssueType.FLOW_ERROR]: { label: 'Error de Flujo', icon: '🔀', color: '#dc2626' }
```

---

## 9. Conversor Codegen → JSON

### Algoritmo

El conversor usa regex para extraer acciones de un script codegen:

```
Input: string (script completo)
Output: FlowStep[] (array de pasos en formato JSON)
```

**Patrones de extraccion:**

| Regex | Accion |
|-------|--------|
| `page\.goto\(['"]([^'"]+)['"]\)` | `navigate` con url=$1 |
| `page\.click\(['"]([^'"]+)['"]\)` | `click` con selector=$1 |
| `page\.fill\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)` | `type` con selector=$1, value=$2 |
| `page\.waitForTimeout\((\d+)\)` | `wait` con ms=$1 |
| `page\.selectOption\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)` | `select` con selector=$1, value=$2 |
| `page\.hover\(['"]([^'"]+)['"]\)` | `hover` con selector=$1 |
| `page\.press\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)` | `press` con selector=$1, key=$2 |

**Ubicacion:** Funcion pura en `frontend/src/services/codegenConverter.ts` (sin dependencias externas). Se ejecuta en el frontend al hacer click en "Convertir".

Se agrega automaticamente un `checkpoint` al final del flujo convertido.

---

## 10. Archivos Modificados

### Backend (9 archivos)

| Archivo | Cambio |
|---------|--------|
| `src/types/index.ts` | Nuevo `IssueType.FLOW_ERROR`. Interfaces `FlowStep`, `FlowInfo`, `StepResult`. Actualizar `ScanConfig` con campo `flow`. |
| `src/database/db.ts` | `CREATE TABLE flows` + `ALTER TABLE issues ADD COLUMN step_index` |
| `src/workers/ScanWorker.ts` | Modo flujo: ejecutar pasos, correr checkers por paso, asignar step_index, screenshots por paso. Manejo de errores de paso. |
| `src/analyzer/PageAnalyzer.ts` | Nuevo metodo `executeStep(step)` o integracion en el flujo principal. Opcional: exponer reset de listeners. |
| `src/api/routes/scan.ts` | Extender Zod schema con `flow`, `flowId`. Resolver flow antes de encolar. |
| `src/api/routes/reports.ts` | Query con step_index. Agrupar issues por paso. Incluir `flow` y `steps` en respuesta. |
| `src/api/routes/flows.ts` | NUEVO — CRUD de flujos (5 endpoints) |
| `src/api/server.ts` | Montar `flowsRoutes` en `/api/flows` |
| `src/checkers/index.ts` | Exportar nuevo `FlowErrorChecker` (opcional — puede manejarse en el worker) |

### Frontend (9 archivos)

| Archivo | Cambio |
|---------|--------|
| `src/types/index.ts` | `FLOW_ERROR` en enum. Interfaces `FlowStep`, `FlowInfo`, `StepResult`. Actualizar `ReportResponse`, `ScanRequest`. |
| `src/services/api.ts` | Nuevos metodos: `getFlows()`, `createFlow()`, `updateFlow()`, `deleteFlow()`. Actualizar `startScan()`. |
| `src/services/codegenConverter.ts` | NUEVO — parsea scripts codegen a FlowStep[] |
| `src/components/FlowEditor/FlowEditor.tsx` | NUEVO — editor de flujos con textarea codegen + lista de pasos |
| `src/components/FlowEditor/FlowEditor.css` | NUEVO — estilos del editor |
| `src/components/FlowTabs/FlowTabs.tsx` | NUEVO — barra de tabs por paso |
| `src/components/FlowTabs/FlowTabs.css` | NUEVO — estilos de tabs |
| `src/pages/Home.tsx` | Dropdown de flujos, boton nuevo flujo, enviar flow/flowId en startScan |
| `src/components/ReportViewer/ReportViewer.tsx` | Integrar FlowTabs, filtrar issues por stepIndex, mostrar screenshot por paso |
| `src/components/ErrorGroup/ErrorGroup.tsx` | Agregar `FLOW_ERROR` a typeConfig |
| `src/components/ErrorCard/ErrorCard.tsx` | Agregar `FLOW_ERROR` a typeConfig |

---

## 11. Fuera de Scope

- Autenticacion gestionada (manejo de cookies/sesiones entre scans)
- Ejecucion paralela de flujos
- Condicionales o loops en los pasos (if, while)
- Variables entre pasos (extraer y reutilizar valores)
- Grabacion de flujos desde SiteSentry (solo importacion de codegen)
- Comparacion visual entre pasos del mismo flujo
- Screenshots de steps intermedios (no-checkpoint) — solo checkpoints y ultimo paso
