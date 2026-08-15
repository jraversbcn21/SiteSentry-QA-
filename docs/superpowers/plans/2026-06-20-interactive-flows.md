# Interactive Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-step interactive flow support to SiteSentry — users define flows in JSON or via Playwright codegen import, the scanner executes each step running checkers after each, and results display in per-step tabs.

**Architecture:** New `flows` table stores reusable flows. POST /api/scan extended with `flow` (inline) or `flowId` (saved). ScanWorker loops over steps executing actions (click, type, navigate), runs checkers at checkpoints/navigations/last step, captures per-step screenshots. Issues gain `step_index`. Frontend adds FlowEditor (with codegen→JSON converter) and FlowTabs for per-step report views.

**Tech Stack:** Playwright (step execution), better-sqlite3 (flows table, step_index column), React (FlowEditor, FlowTabs), regex (codegen parser). No new npm dependencies.

## Global Constraints

- `page.evaluate()` calls MUST use template string IIFEs with `var`/`function`/`for` — no `const`/`let`/arrow functions inside evaluate strings
- Use `import { randomUUID } from 'crypto'`, not `crypto.randomUUID()`
- DB migrations: idempotent try/catch with duplicate detection
- UI language: Spanish
- Backend: CommonJS, tsx runner
- Frontend: ESM, Vite, `@/` alias → `src/`
- Flow execution is best effort — a failed step does not fail the scan
- New IssueType `FLOW_ERROR` must be registered in: backend enum, frontend enum, ErrorCard typeConfig, ErrorGroup typeConfig, ReportViewer getTypeIcon/getTypeLabel
- New `flows` table + `step_index` column use SQLite via better-sqlite3
- Screenshots per step use naming: `step-{N}-full.png`, `step-{N}-{issueId}.png`

---

### Task 1: Backend Types — FLOW_ERROR + Flow Interfaces

**Files:**
- Modify: `backend/src/types/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `IssueType.FLOW_ERROR`, `FlowStep`, `FlowInfo`, `StepResult`, updated `ScanConfig`

- [ ] **Step 1: Add FLOW_ERROR to IssueType enum**

In `backend/src/types/index.ts`, add after line 21 (`ACCESSIBILITY = 'ACCESSIBILITY',`):

```typescript
  FLOW_ERROR = 'FLOW_ERROR',
```

- [ ] **Step 2: Add flow interfaces after IChecker (end of file)**

```typescript
export interface FlowStep {
  action: string;
  url?: string;
  selector?: string;
  value?: string;
  ms?: number;
  key?: string;
}

export interface FlowInfo {
  name: string;
  steps: FlowStep[];
}

export interface StepResult {
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

- [ ] **Step 3: Update ScanConfig**

Change the existing `ScanConfig` interface (lines 39-42) to include `flow`:

```typescript
export interface ScanConfig {
  timeout: number;
  visualDiffThreshold?: number;
  flow?: FlowInfo;
}
```

- [ ] **Step 4: Type-check and commit**

```bash
cd backend; npx tsc --noEmit
git add backend/src/types/index.ts
git commit -m "feat: add FLOW_ERROR IssueType and flow interfaces to backend types"
```

---

### Task 2: DB Migrations — flows table + step_index

**Files:**
- Modify: `backend/src/database/db.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `flows` table, `step_index` column on `issues`

- [ ] **Step 1: Add migrations to db.ts**

In `backend/src/database/db.ts`, add after the last existing migration block:

```typescript
  // Migracion: crear tabla flows (Fase 3 - Interactive Flows)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        steps TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch (e: any) {
    if (!e.message.includes('already exists')) {
      console.warn('Migration warning (flows):', e.message);
    }
  }

  // Migracion: agregar step_index a issues (Fase 3 - Interactive Flows)
  try {
    db.exec('ALTER TABLE issues ADD COLUMN step_index INTEGER');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.warn('Migration warning (step_index):', e.message);
    }
  }
```

- [ ] **Step 2: Type-check and commit**

```bash
cd backend; npx tsc --noEmit
git add backend/src/database/db.ts
git commit -m "feat: add flows table and step_index column for interactive flows"
```

---

### Task 3: Flow CRUD API Routes

**Files:**
- Create: `backend/src/api/routes/flows.ts`
- Modify: `backend/src/api/server.ts`

**Interfaces:**
- Consumes: `getDb` from db.ts, `randomUUID` from crypto
- Produces: 5 CRUD endpoints under `/api/flows`

- [ ] **Step 1: Create flows.ts with full CRUD**

File: `backend/src/api/routes/flows.ts`

```typescript
import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../../database/db';

export const flowsRoutes = Router();

// GET /api/flows - Listar flujos
flowsRoutes.get('/', (_req: Request, res: Response) => {
  try {
    var db = getDb();
    var flows = db.prepare('SELECT * FROM flows ORDER BY updated_at DESC').all() as Array<{
      id: string;
      name: string;
      steps: string;
      created_at: string;
      updated_at: string;
    }>;
    return res.json(flows.map(function(f) {
      return {
        id: f.id,
        name: f.name,
        steps: JSON.parse(f.steps),
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      };
    }));
  } catch (error) {
    console.error('Error listando flujos:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/flows/:id - Obtener flujo
flowsRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    var db = getDb();
    var flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(req.params.id) as {
      id: string; name: string; steps: string; created_at: string; updated_at: string;
    } | undefined;
    if (!flow) return res.status(404).json({ error: 'Flujo no encontrado' });
    return res.json({
      id: flow.id,
      name: flow.name,
      steps: JSON.parse(flow.steps),
      createdAt: flow.created_at,
      updatedAt: flow.updated_at,
    });
  } catch (error) {
    console.error('Error obteniendo flujo:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/flows - Crear flujo
flowsRoutes.post('/', (req: Request, res: Response) => {
  try {
    var { name, steps } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
      return res.status(400).json({ error: 'Nombre requerido (1-200 caracteres)' });
    }
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'Steps requerido (array no vacio)' });
    }
    for (var i = 0; i < steps.length; i++) {
      if (!steps[i].action) return res.status(400).json({ error: 'Cada paso requiere una accion' });
    }

    var db = getDb();
    var id = randomUUID();
    var now = new Date().toISOString();
    db.prepare('INSERT INTO flows (id, name, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name.trim(), JSON.stringify(steps), now, now);
    return res.status(201).json({ id, name: name.trim(), steps, createdAt: now, updatedAt: now });
  } catch (error) {
    console.error('Error creando flujo:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/flows/:id - Actualizar flujo
flowsRoutes.put('/:id', (req: Request, res: Response) => {
  try {
    var db = getDb();
    var existing = db.prepare('SELECT * FROM flows WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Flujo no encontrado' });

    var { name, steps } = req.body;
    var newName = name || existing.name;
    var newSteps = steps ? JSON.stringify(steps) : existing.steps;
    var now = new Date().toISOString();

    db.prepare('UPDATE flows SET name = ?, steps = ?, updated_at = ? WHERE id = ?')
      .run(newName, newSteps, now, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando flujo:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/flows/:id - Eliminar flujo
flowsRoutes.delete('/:id', (req: Request, res: Response) => {
  try {
    var db = getDb();
    var existing = db.prepare('SELECT id FROM flows WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Flujo no encontrado' });
    db.prepare('DELETE FROM flows WHERE id = ?').run(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error eliminando flujo:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});
```

- [ ] **Step 2: Mount in server.ts**

In `backend/src/api/server.ts`, add import after line 7 (`import { reportsRoutes } from './routes/reports';`):

```typescript
import { flowsRoutes } from './routes/flows';
```

Add mount after line 44 (`app.use('/api/reports', reportsRoutes);`):

```typescript
app.use('/api/flows', flowsRoutes);
```

- [ ] **Step 3: Type-check and commit**

```bash
cd backend; npx tsc --noEmit
git add backend/src/api/routes/flows.ts backend/src/api/server.ts
git commit -m "feat: add flow CRUD API routes (/api/flows)"
```

---

### Task 4: Extend POST /api/scan — flow + flowId

**Files:**
- Modify: `backend/src/api/routes/scan.ts`

**Interfaces:**
- Consumes: `FlowStep`, `FlowInfo` types, `flows` DB table
- Produces: `flow` / `flowId` accepted in scan body, resolved to `config.flow`

- [ ] **Step 1: Update Zod schema**

In `backend/src/api/routes/scan.ts`, change the `ScanRequestSchema` (lines 9-17) to add `flow` and `flowId`:

```typescript
const FlowStepSchema = z.object({
  action: z.enum(['navigate', 'click', 'type', 'wait', 'select', 'hover', 'press', 'checkpoint']),
  url: z.string().optional(),
  selector: z.string().optional(),
  value: z.string().optional(),
  ms: z.number().int().min(0).optional(),
  key: z.string().optional(),
});

const ScanRequestSchema = z.object({
  url: z.string().url('URL invalida - debe incluir http:// o https://'),
  visualDiffThreshold: z.number().min(0).max(1).optional(),
  flow: z.object({
    name: z.string().min(1).max(200),
    steps: z.array(FlowStepSchema).min(1),
  }).optional(),
  flowId: z.string().optional(),
  config: z
    .object({
      timeout: z.number().int().min(5000).max(120000).optional(),
    })
    .optional(),
});
```

- [ ] **Step 2: Resolve flow before enqueuing**

In the POST handler, after URL normalization (line 31) and before `prisma.scan.create`, add flow resolution:

```typescript
    // Resolver flow
    var resolvedFlow: { name: string; steps: typeof validation.data.flow extends undefined ? never : typeof validation.data.flow.steps } | undefined;

    if (validation.data.flow) {
      resolvedFlow = validation.data.flow;
    } else if (validation.data.flowId) {
      var { getDb } = require('../../database/db');
      var db = getDb();
      var savedFlow = db.prepare('SELECT name, steps FROM flows WHERE id = ?').get(validation.data.flowId) as { name: string; steps: string } | undefined;
      if (!savedFlow) {
        return res.status(404).json({ error: 'Flujo no encontrado' });
      }
      resolvedFlow = { name: savedFlow.name, steps: JSON.parse(savedFlow.steps) };
    }
```

Then in the job config (around line 33), merge the resolved flow:

```typescript
    var jobConfig = {
      ...(config || {}),
      ...(validation.data.visualDiffThreshold !== undefined
        ? { visualDiffThreshold: validation.data.visualDiffThreshold }
        : {}),
      ...(resolvedFlow ? { flow: resolvedFlow } : {}),
    };
```

- [ ] **Step 3: Type-check and commit**

```bash
cd backend; npx tsc --noEmit
git add backend/src/api/routes/scan.ts
git commit -m "feat: accept flow and flowId in POST /api/scan"
```

---

### Task 5: Extend Reports Route — flow + steps

**Files:**
- Modify: `backend/src/api/routes/reports.ts`

**Interfaces:**
- Consumes: `FlowInfo`, `StepResult` types, `step_index` column
- Produces: `flow` and `steps` fields in report response

- [ ] **Step 1: Build per-step results**

In `backend/src/api/routes/reports.ts`, after the existing issues parsing (around line 84), add:

```typescript
    // Build per-step results if flow scan
    var flow: { name: string; steps: Array<{ index: number; action: string; url?: string; selector?: string; value?: string; ms?: number; key?: string }> } | undefined;
    var steps: Array<{
      index: number;
      action: string;
      label: string;
      issues: any[];
      fullPageScreenshot: string | null;
      summary: { total: number; byType: Record<string, number>; bySeverity: Record<string, number> };
    }> | undefined;

    try {
      var configObj = JSON.parse(scan.config);
      if (configObj.flow && configObj.flow.steps) {
        var flowSteps = configObj.flow.steps as Array<{ action: string; url?: string; selector?: string; value?: string; ms?: number; key?: string }>;
        flow = { name: configObj.flow.name, steps: flowSteps.map(function(s: any, i: number) { return { index: i, ...s }; }) };

        steps = flowSteps.map(function(step: { action: string; url?: string; selector?: string; value?: string; ms?: number; key?: string }, index: number) {
          var stepIssues = parsedIssues.filter(function(issue: any) { return issue.stepIndex === index; });
          var stepByType: Record<string, number> = {};
          var stepBySeverity: Record<string, number> = {};
          for (var si = 0; si < stepIssues.length; si++) {
            var sIssue = stepIssues[si];
            stepByType[sIssue.type] = (stepByType[sIssue.type] || 0) + 1;
            stepBySeverity[sIssue.severity] = (stepBySeverity[sIssue.severity] || 0) + 1;
          }

          var label = buildStepLabel(step);

          var stepScreenshotPath = path.join(process.cwd(), 'data', 'screenshots', scan.id, 'step-' + index + '-full.png');
          var stepScreenshot = fs.existsSync(stepScreenshotPath) ? scan.id + '/step-' + index + '-full.png' : null;

          return {
            index: index,
            action: step.action,
            label: label,
            issues: stepIssues,
            fullPageScreenshot: stepScreenshot,
            summary: { total: stepIssues.length, byType: stepByType, bySeverity: stepBySeverity },
          };
        });
      }
    } catch {}

    function buildStepLabel(step: { action: string; url?: string; selector?: string; value?: string; ms?: number; key?: string }): string {
      if (step.action === 'navigate' && step.url) return 'Navegar a ' + step.url.replace(/^https?:\/\//, '').substring(0, 40);
      if (step.action === 'click' && step.selector) return 'Click en ' + step.selector;
      if (step.action === 'type' && step.selector) return 'Escribir en ' + step.selector;
      if (step.action === 'wait' && step.ms) return 'Esperar ' + step.ms + 'ms';
      if (step.action === 'select' && step.selector) return 'Seleccionar en ' + step.selector;
      if (step.action === 'hover' && step.selector) return 'Hover en ' + step.selector;
      if (step.action === 'press' && step.key) return 'Presionar ' + step.key;
      if (step.action === 'checkpoint') return 'Checkpoint';
      return 'Paso ' + step.action;
    }
```

- [ ] **Step 2: Add stepIndex to parsed issues**

In the `parsedIssues` map (around line 73), add `stepIndex`:

```typescript
    const parsedIssues = issues.map((i) => ({
      id: i.id,
      scanId: i.scan_id,
      type: i.type,
      severity: i.severity,
      url: i.url,
      sourceUrl: i.source_url,
      description: i.description,
      metadata: i.metadata ? JSON.parse(i.metadata) : null,
      screenshot_path: i.screenshot_path || null,
      stepIndex: (i as any).step_index ?? null,
      createdAt: i.created_at,
    }));
```

- [ ] **Step 3: Add flow + steps to response**

In the `return res.json(...)` object, add `flow` and `steps`:

```typescript
      flow,
      steps,
      visualDiffs: parsedVisualDiffs,
      baselineInfo,
```

- [ ] **Step 4: Type-check and commit**

```bash
cd backend; npx tsc --noEmit
git add backend/src/api/routes/reports.ts
git commit -m "feat: add flow and per-step results to GET /api/reports/:id"
```

---

### Task 6: ScanWorker — Flow Execution Mode

**Files:**
- Modify: `backend/src/workers/ScanWorker.ts`

**Interfaces:**
- Consumes: `FlowStep`, `FlowInfo` types, `IChecker.check()`, `PageAnalyzer.analyze()`, existing screenshot + visual regression infra
- Produces: Per-step checkers execution, step_index on issues, per-step screenshots

- [ ] **Step 1: Add flow execution logic**

After the existing `analyzer.analyze(url)` call and before the checkers loop (currently after line 229 `const analysis = await analyzer.analyze(url);` and before line 243 `for (const checker of checkers)`), insert the flow execution block:

```typescript
    var flowConfig = config.flow;
    var allIssues: import('../types').Issue[] = [];
    var stepNetworkEvents = analysis.networkEvents;
    var stepConsoleErrors = analysis.consoleErrors;
    var currentPage = analysis.page;

    if (flowConfig && flowConfig.steps && flowConfig.steps.length > 0) {
      console.log('[ScanWorker] Ejecutando flujo interactivo: ' + flowConfig.name + ' (' + flowConfig.steps.length + ' pasos)');

      for (var stepIdx = 0; stepIdx < flowConfig.steps.length; stepIdx++) {
        var step = flowConfig.steps[stepIdx];
        if (job.updateProgress) {
          try { job.updateProgress({ phase: 'running_flow_step', step: { index: stepIdx, total: flowConfig.steps.length, action: step.action } }); } catch {}
        }

        // Ejecutar accion del paso
        try {
          if (step.action === 'navigate') {
            // Reset event listeners para nuevo paso
            stepNetworkEvents = [];
            stepConsoleErrors = [];
            currentPage.on('response', function(response: any) {
              stepNetworkEvents.push({
                url: response.url(),
                method: response.request().method(),
                resourceType: response.request().resourceType(),
                status: response.status(),
                timing: 0,
                size: 0,
                mimeType: response.headers()['content-type'] || '',
              });
            });
            currentPage.on('requestfailed', function(request: any) {
              stepNetworkEvents.push({
                url: request.url(),
                method: request.method(),
                resourceType: request.resourceType(),
                status: 0,
                timing: 0,
                size: 0,
                mimeType: '',
              });
            });
            currentPage.on('console', function(msg: any) {
              if (msg.type() === 'error') {
                stepConsoleErrors.push({ text: msg.text(), type: msg.type() });
              }
            });
            await currentPage.goto(step.url || '', { waitUntil: 'domcontentloaded', timeout: config.timeout || 30000 });
            await currentPage.waitForLoadState('networkidle').catch(function() {});
            currentPage = currentPage;
          } else if (step.action === 'click' && step.selector) {
            await currentPage.locator(step.selector).first().click({ timeout: 10000 });
            await currentPage.waitForTimeout(1000);
          } else if (step.action === 'type' && step.selector && step.value !== undefined) {
            await currentPage.locator(step.selector).first().fill(step.value, { timeout: 10000 });
          } else if (step.action === 'wait' && step.ms) {
            await currentPage.waitForTimeout(step.ms);
          } else if (step.action === 'select' && step.selector && step.value !== undefined) {
            await currentPage.locator(step.selector).first().selectOption(step.value, { timeout: 10000 });
          } else if (step.action === 'hover' && step.selector) {
            await currentPage.locator(step.selector).first().hover({ timeout: 10000 });
          } else if (step.action === 'press' && step.key) {
            if (step.selector) {
              await currentPage.locator(step.selector).first().press(step.key, { timeout: 10000 });
            } else {
              await currentPage.keyboard.press(step.key);
            }
          }
        } catch (stepErr) {
          var errorMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);
          console.warn('[ScanWorker] Error en paso ' + stepIdx + ' (' + step.action + '):', errorMsg);
          allIssues.push({
            type: 'FLOW_ERROR' as any,
            severity: 'HIGH' as any,
            url: url,
            description: 'Error en paso ' + stepIdx + ' (' + step.action + '): ' + errorMsg,
            metadata: { stepIndex: stepIdx, action: step.action, error: errorMsg.substring(0, 300) },
            screenshot_path: undefined,
          } as any);
          (allIssues[allIssues.length - 1] as any).stepIndex = stepIdx;

          if (step.action === 'navigate') {
            console.warn('[ScanWorker] Navegacion fallida, abortando flujo');
            break;
          }
          continue;
        }

        // Ejecutar checkers en checkpoint, navigate, o ultimo paso
        var isCheckpoint = step.action === 'checkpoint' || step.action === 'navigate' || stepIdx === flowConfig.steps.length - 1;

        if (isCheckpoint) {
          // Full scroll
          try {
            await analyzer.fullScroll(currentPage);
          } catch {}

          // Run checkers
          for (var ci = 0; ci < checkers.length; ci++) {
            var checker = checkers[ci];
            try {
              var issues = await checker.check(url, currentPage, stepNetworkEvents, stepConsoleErrors);
              for (var ii = 0; ii < issues.length; ii++) {
                (issues[ii] as any).stepIndex = stepIdx;
              }
              allIssues.push(...issues);
              console.log('[ScanWorker] ' + checker.name + ' (paso ' + stepIdx + '): ' + issues.length + ' issues');
            } catch (checkerErr) {
              console.error('[ScanWorker] ' + checker.name + ' fallo en paso ' + stepIdx + ':', checkerErr);
            }
          }

          // Screenshots
          try {
            var stepScreenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
            // Full-page for this step
            var stepFullPath = path.join(stepScreenshotDir, 'step-' + stepIdx + '-full.png');
            await currentPage.screenshot({ path: stepFullPath, fullPage: true, type: 'png' });

            // Element screenshots for HIGH severity issues from this step
            var stepIssues = allIssues.filter(function(iss: any) { return (iss as any).stepIndex === stepIdx; });
            for (var si = 0; si < stepIssues.length; si++) {
              var sIssue = stepIssues[si];
              if (sIssue.severity !== 'HIGH') continue;
              var selector = sIssue.metadata?.selector as string | undefined;
              if (!selector) continue;
              try {
                var el = currentPage.locator(selector).first();
                var issueId = (sIssue as any).id;
                if (!issueId) {
                  issueId = randomUUID();
                  (sIssue as any).id = issueId;
                }
                var elFileName = 'step-' + stepIdx + '-' + issueId + '.png';
                var elFilePath = path.join(stepScreenshotDir, elFileName);
                await el.screenshot({ path: elFilePath, type: 'png' });
                sIssue.screenshot_path = scanId + '/' + elFileName;
              } catch {}
            }
          } catch (screenshotErr) {
            console.warn('[ScanWorker] Screenshots fallaron en paso ' + stepIdx + ':', screenshotErr);
          }
        }
      }

      await analyzer.close(currentPage);
    } else {
      // Modo normal (sin flujo) — codigo existente
      for (const checker of checkers) {
        try {
          const issues = await checker.check(url, analysis.page, analysis.networkEvents, analysis.consoleErrors);
          allIssues.push(...issues);
          console.log(`[ScanWorker] ${checker.name}: ${issues.length} issues`);
        } catch (error) {
          console.error(`[ScanWorker] ${checker.name} fallo:`, error);
        }
      }
      await analyzer.close(analysis.page);
    }
```

**IMPORTANT:** The existing checkers loop and page close (lines 243-292 of the original ScanWorker.ts) must be replaced by or merged with this conditional block. The normal mode code path must remain intact for scans without flows.

- [ ] **Step 2: Update Issue INSERT to include step_index**

In the issue insertion block, add `step_index` to the INSERT and VALUES:

Change the INSERT statement from:
```sql
INSERT OR IGNORE INTO issues (id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

To:
```sql
INSERT OR IGNORE INTO issues (id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, step_index, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

And add `(issue as any).stepIndex ?? null` as the 10th parameter (before `created_at`).

- [ ] **Step 3: Full-page screenshot for last step (visual regression)**

After the flow completes, ensure the last step's full-page screenshot is also saved as `full.png` for visual regression compatibility:

```typescript
    // Copy last step full-page screenshot as full.png for visual regression
    if (flowConfig && flowConfig.steps && flowConfig.steps.length > 0) {
      var lastIdx = flowConfig.steps.length - 1;
      var lastFullPath = path.join(process.cwd(), 'data', 'screenshots', scanId, 'step-' + lastIdx + '-full.png');
      var fullPath = path.join(process.cwd(), 'data', 'screenshots', scanId, 'full.png');
      if (fs.existsSync(lastFullPath)) {
        fs.copyFileSync(lastFullPath, fullPath);
      }
    }
```

Add this BEFORE the visual regression call (runVisualRegression uses `full.png`).

- [ ] **Step 4: Type-check and commit**

```bash
cd backend; npx tsc --noEmit
git add backend/src/workers/ScanWorker.ts
git commit -m "feat: add interactive flow execution to ScanWorker"
```

---

### Task 7: Codegen Converter

**Files:**
- Create: `frontend/src/services/codegenConverter.ts`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces: `parseCodegenScript(script: string): FlowStep[]`

- [ ] **Step 1: Create codegenConverter.ts**

```typescript
import type { FlowStep } from '../types';

var GOTO_RE = /page\.goto\(['"]([^'"]+)['"]\)/g;
var CLICK_RE = /page\.click\(['"]([^'"]+)['"]\)/g;
var FILL_RE = /page\.fill\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/g;
var WAIT_RE = /page\.waitForTimeout\((\d+)\)/g;
var SELECTOPTION_RE = /page\.selectOption\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/g;
var HOVER_RE = /page\.hover\(['"]([^'"]+)['"]\)/g;
var PRESS_RE = /page\.press\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/g;

export function parseCodegenScript(script: string): FlowStep[] {
  var steps: FlowStep[] = [];
  var lines = script.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('import ') || line.startsWith('const ') || line.startsWith('(async')) continue;

    var match: RegExpExecArray | null;

    GOTO_RE.lastIndex = 0;
    if ((match = GOTO_RE.exec(line)) !== null) {
      steps.push({ action: 'navigate', url: match[1] });
      continue;
    }

    CLICK_RE.lastIndex = 0;
    if ((match = CLICK_RE.exec(line)) !== null) {
      steps.push({ action: 'click', selector: match[1] });
      continue;
    }

    FILL_RE.lastIndex = 0;
    if ((match = FILL_RE.exec(line)) !== null) {
      steps.push({ action: 'type', selector: match[1], value: match[2] });
      continue;
    }

    WAIT_RE.lastIndex = 0;
    if ((match = WAIT_RE.exec(line)) !== null) {
      steps.push({ action: 'wait', ms: parseInt(match[1], 10) });
      continue;
    }

    SELECTOPTION_RE.lastIndex = 0;
    if ((match = SELECTOPTION_RE.exec(line)) !== null) {
      steps.push({ action: 'select', selector: match[1], value: match[2] });
      continue;
    }

    HOVER_RE.lastIndex = 0;
    if ((match = HOVER_RE.exec(line)) !== null) {
      steps.push({ action: 'hover', selector: match[1] });
      continue;
    }

    PRESS_RE.lastIndex = 0;
    if ((match = PRESS_RE.exec(line)) !== null) {
      steps.push({ action: 'press', selector: match[1], key: match[2] });
      continue;
    }
  }

  // Add final checkpoint
  if (steps.length > 0) {
    steps.push({ action: 'checkpoint' });
  }

  return steps;
}
```

- [ ] **Step 2: Type-check and commit**

```bash
cd frontend; npx tsc --noEmit
git add frontend/src/services/codegenConverter.ts
git commit -m "feat: add Playwright codegen script to JSON converter"
```

---

### Task 8: Frontend Types + API Methods

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Consumes: nothing
- Produces: Updated types and API methods for flows

- [ ] **Step 1: Update frontend types**

In `frontend/src/types/index.ts`:

Add `FLOW_ERROR` to `IssueType` enum (after `ACCESSIBILITY`):

```typescript
  FLOW_ERROR = 'FLOW_ERROR',
```

Add interfaces after existing types (before end of file):

```typescript
export interface FlowStep {
  action: string;
  url?: string;
  selector?: string;
  value?: string;
  ms?: number;
  key?: string;
}

export interface FlowInfo {
  name: string;
  steps: FlowStep[];
}

export interface FlowDefinition {
  id: string;
  name: string;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface StepResult {
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

Update `ScanRequest` to add `flow` and `flowId`:

```typescript
export interface ScanRequest {
  url: string;
  visualDiffThreshold?: number;
  flow?: { name: string; steps: FlowStep[] };
  flowId?: string;
  config?: {
    timeout?: number;
  };
}
```

Update `ReportResponse` to add `flow` and `steps`:

```typescript
export interface ReportResponse {
  // ...existing...
  flow?: FlowInfo;
  steps?: StepResult[];
}
```

Add `stepIndex` to `Issue`:

```typescript
export interface Issue {
  id?: string;
  type: IssueType;
  severity: IssueSeverity;
  url: string;
  sourceUrl?: string;
  description: string;
  metadata?: Record<string, unknown>;
  screenshot_path?: string | null;
  stepIndex?: number | null;
}
```

- [ ] **Step 2: Update frontend API**

In `frontend/src/services/api.ts`, add flow CRUD methods and update `startScan`:

```typescript
import type { FlowDefinition, FlowStep } from '../types';

// Add to scanApi:
  getFlows: async (): Promise<FlowDefinition[]> => {
    var response = await api.get<FlowDefinition[]>('/flows');
    return response.data;
  },

  getFlow: async (id: string): Promise<FlowDefinition> => {
    var response = await api.get<FlowDefinition>('/flows/' + id);
    return response.data;
  },

  createFlow: async (name: string, steps: FlowStep[]): Promise<FlowDefinition> => {
    var response = await api.post<FlowDefinition>('/flows', { name, steps });
    return response.data;
  },

  updateFlow: async (id: string, name: string, steps: FlowStep[]): Promise<void> => {
    await api.put('/flows/' + id, { name, steps });
  },

  deleteFlow: async (id: string): Promise<void> => {
    await api.delete('/flows/' + id);
  },
```

- [ ] **Step 3: Type-check and commit**

```bash
cd frontend; npx tsc --noEmit
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: add flow types and API methods to frontend"
```

---

### Task 9: Register FLOW_ERROR in typeConfigs

**Files:**
- Modify: `frontend/src/components/ErrorGroup/ErrorGroup.tsx`
- Modify: `frontend/src/components/ErrorCard/ErrorCard.tsx`
- Modify: `frontend/src/components/ReportViewer/ReportViewer.tsx`

**Interfaces:**
- Consumes: `IssueType.FLOW_ERROR`
- Produces: FLOW_ERROR visible with icon/label/color in UI

- [ ] **Step 1: Add to ErrorGroup typeConfig**

In `ErrorGroup.tsx`, add after the `ACCESSIBILITY` entry in `typeConfig`:

```typescript
  [IssueType.FLOW_ERROR]: { label: 'Error de Flujo', icon: '🔀', color: '#dc2626' },
```

- [ ] **Step 2: Add to ErrorCard typeConfig**

In `ErrorCard.tsx`, add after the `FORM_MODAL` entry:

```typescript
    [IssueType.CONSOLE_ERROR]: { label: 'Error de Consola', icon: '🐛' },
    [IssueType.PERFORMANCE]: { label: 'Rendimiento', icon: '⚡' },
    [IssueType.ACCESSIBILITY]: { label: 'Accesibilidad', icon: '♿' },
    [IssueType.FLOW_ERROR]: { label: 'Error de Flujo', icon: '🔀' },
```

- [ ] **Step 3: Add to ReportViewer getTypeIcon/getTypeLabel**

In `ReportViewer.tsx`, add to `getTypeIcon`:

```typescript
    [IssueType.FLOW_ERROR]: '🔀',
```

Add to `getTypeLabel`:

```typescript
    [IssueType.FLOW_ERROR]: 'Error de Flujo',
```

- [ ] **Step 4: Lint, type-check, commit**

```bash
cd frontend; npx tsc --noEmit; if ($?) { npx eslint . --ext ts,tsx --max-warnings 0 }
git add frontend/src/components/ErrorGroup/ErrorGroup.tsx frontend/src/components/ErrorCard/ErrorCard.tsx frontend/src/components/ReportViewer/ReportViewer.tsx
git commit -m "feat: register FLOW_ERROR in typeConfig, typeIcon, and typeLabel"
```

---

### Task 10: FlowEditor Component

**Files:**
- Create: `frontend/src/components/FlowEditor/FlowEditor.tsx`
- Create: `frontend/src/components/FlowEditor/FlowEditor.css`

**Interfaces:**
- Consumes: `FlowStep`, `FlowDefinition` types, `parseCodegenScript` from Task 7, `scanApi` flow methods from Task 8
- Produces: Full flow editor UI with codegen import + manual step editing + save

- [ ] **Step 1: Create FlowEditor.css**

```css
.flow-editor { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
.flow-editor h3 { margin: 0 0 12px; font-size: 16px; }
.fe-name-input { width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 14px; margin-bottom: 12px; }
.fe-codegen-section { margin-bottom: 16px; }
.fe-codegen-section label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 4px; }
.fe-codegen-textarea { width: 100%; min-height: 120px; font-family: monospace; font-size: 12px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; resize: vertical; }
.fe-convert-btn { margin-top: 8px; padding: 6px 14px; background: #3b82f6; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
.fe-convert-btn:hover { background: #2563eb; }
.fe-steps-list { list-style: none; padding: 0; margin: 0; }
.fe-step-item { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #e2e8f0; border-radius: 4px; margin-bottom: 6px; background: #f8fafc; }
.fe-step-index { font-size: 11px; color: #94a3b8; min-width: 24px; }
.fe-step-action-select { padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; min-width: 100px; }
.fe-step-input { padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; flex: 1; min-width: 0; }
.fe-step-delete { padding: 4px 8px; background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; border-radius: 4px; cursor: pointer; font-size: 12px; }
.fe-add-step { margin-top: 8px; padding: 6px 14px; background: #f1f5f9; color: #475569; border: 1px dashed #cbd5e1; border-radius: 4px; cursor: pointer; font-size: 13px; width: 100%; }
.fe-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
.fe-save-btn { padding: 8px 20px; background: #16a34a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
.fe-cancel-btn { padding: 8px 20px; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; font-size: 14px; }
```

- [ ] **Step 2: Create FlowEditor.tsx**

```tsx
import { useState } from 'react';
import type { FlowStep, FlowDefinition } from '../../types';
import { parseCodegenScript } from '../../services/codegenConverter';
import { scanApi } from '../../services/api';
import './FlowEditor.css';

interface FlowEditorProps {
  editFlow?: FlowDefinition;
  onSave: (flow: { name: string; steps: FlowStep[] }) => void;
  onCancel: () => void;
}

var ACTION_OPTIONS = [
  { value: 'navigate', label: '🌐 Navegar' },
  { value: 'click', label: '🖱️ Click' },
  { value: 'type', label: '⌨️ Escribir' },
  { value: 'wait', label: '⏱️ Esperar' },
  { value: 'select', label: '📋 Seleccionar' },
  { value: 'hover', label: '👆 Hover' },
  { value: 'press', label: '⌨️ Tecla' },
  { value: 'checkpoint', label: '📸 Checkpoint' },
];

export default function FlowEditor({ editFlow, onSave, onCancel }: FlowEditorProps) {
  var [name, setName] = useState(editFlow?.name || '');
  var [steps, setSteps] = useState<FlowStep[]>(editFlow?.steps || []);
  var [codegenScript, setCodegenScript] = useState('');
  var [saving, setSaving] = useState(false);

  function handleConvert() {
    var parsed = parseCodegenScript(codegenScript);
    if (parsed.length > 0) setSteps(parsed);
  }

  function handleStepChange(index: number, field: string, value: string | number | undefined) {
    var newSteps = steps.map(function(s, i) {
      if (i === index) return { ...s, [field]: value };
      return s;
    });
    setSteps(newSteps);
  }

  function handleDeleteStep(index: number) {
    setSteps(steps.filter(function(_, i) { return i !== index; }));
  }

  function handleAddStep() {
    setSteps([...steps, { action: 'click' }]);
  }

  async function handleSave() {
    if (!name.trim() || steps.length === 0) return;
    var flow = { name: name.trim(), steps };
    if (editFlow?.id) {
      setSaving(true);
      try {
        await scanApi.updateFlow(editFlow.id, flow.name, flow.steps);
      } finally { setSaving(false); }
    }
    onSave(flow);
  }

  function renderStepFields(step: FlowStep, index: number) {
    var fields: JSX.Element[] = [];
    if (step.action === 'navigate') {
      fields.push(<input key="url" className="fe-step-input" placeholder="URL" value={step.url || ''} onChange={function(e) { handleStepChange(index, 'url', e.target.value); }} />);
    } else if (step.action === 'click' || step.action === 'hover') {
      fields.push(<input key="selector" className="fe-step-input" placeholder="Selector CSS" value={step.selector || ''} onChange={function(e) { handleStepChange(index, 'selector', e.target.value); }} />);
    } else if (step.action === 'type') {
      fields.push(<input key="selector" className="fe-step-input" placeholder="Selector CSS" value={step.selector || ''} onChange={function(e) { handleStepChange(index, 'selector', e.target.value); }} />);
      fields.push(<input key="value" className="fe-step-input" placeholder="Valor" value={step.value || ''} onChange={function(e) { handleStepChange(index, 'value', e.target.value); }} />);
    } else if (step.action === 'wait') {
      fields.push(<input key="ms" className="fe-step-input" type="number" placeholder="Milisegundos" value={step.ms || ''} onChange={function(e) { handleStepChange(index, 'ms', parseInt(e.target.value, 10) || undefined); }} />);
    } else if (step.action === 'select') {
      fields.push(<input key="selector" className="fe-step-input" placeholder="Selector CSS" value={step.selector || ''} onChange={function(e) { handleStepChange(index, 'selector', e.target.value); }} />);
      fields.push(<input key="value" className="fe-step-input" placeholder="Valor" value={step.value || ''} onChange={function(e) { handleStepChange(index, 'value', e.target.value); }} />);
    } else if (step.action === 'press') {
      fields.push(<input key="selector" className="fe-step-input" placeholder="Selector CSS (opcional)" value={step.selector || ''} onChange={function(e) { handleStepChange(index, 'selector', e.target.value); }} />);
      fields.push(<input key="key" className="fe-step-input" placeholder="Tecla (Enter, Tab...)" value={step.key || ''} onChange={function(e) { handleStepChange(index, 'key', e.target.value); }} />);
    }
    return fields;
  }

  return (
    <div className="flow-editor">
      <h3>{editFlow ? 'Editar Flujo' : 'Nuevo Flujo'}</h3>
      <input className="fe-name-input" placeholder="Nombre del flujo" value={name} onChange={function(e) { setName(e.target.value); }} />

      <div className="fe-codegen-section">
        <label>Pegar script de Playwright Codegen</label>
        <textarea className="fe-codegen-textarea" value={codegenScript} onChange={function(e) { setCodegenScript(e.target.value); }} placeholder={`await page.goto('https://...');\nawait page.click('#login');\nawait page.fill('#user', 'admin');`} />
        <button className="fe-convert-btn" onClick={handleConvert}>Convertir a pasos</button>
      </div>

      <ul className="fe-steps-list">
        {steps.map(function(step, index) {
          return (
            <li key={index} className="fe-step-item">
              <span className="fe-step-index">#{index + 1}</span>
              <select className="fe-step-action-select" value={step.action} onChange={function(e) { handleStepChange(index, 'action', e.target.value); }}>
                {ACTION_OPTIONS.map(function(opt) { return <option key={opt.value} value={opt.value}>{opt.label}</option>; })}
              </select>
              {renderStepFields(step, index)}
              <button className="fe-step-delete" onClick={function() { handleDeleteStep(index); }}>🗑️</button>
            </li>
          );
        })}
      </ul>

      <button className="fe-add-step" onClick={handleAddStep}>+ Agregar paso</button>

      <div className="fe-actions">
        <button className="fe-cancel-btn" onClick={onCancel}>Cancelar</button>
        <button className="fe-save-btn" onClick={handleSave} disabled={saving || !name.trim() || steps.length === 0}>
          {saving ? 'Guardando...' : (editFlow ? 'Actualizar flujo' : 'Guardar flujo')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and commit**

```bash
cd frontend; npx tsc --noEmit
git add frontend/src/components/FlowEditor/FlowEditor.tsx frontend/src/components/FlowEditor/FlowEditor.css
git commit -m "feat: add FlowEditor component with codegen import and manual step editing"
```

---

### Task 11: FlowTabs Component

**Files:**
- Create: `frontend/src/components/FlowTabs/FlowTabs.tsx`
- Create: `frontend/src/components/FlowTabs/FlowTabs.css`

**Interfaces:**
- Consumes: `StepResult`, `FlowInfo`, `Issue` types
- Produces: Tab bar for per-step navigation, filtered issues by step

- [ ] **Step 1: Create FlowTabs.css**

```css
.flow-tabs { display: flex; gap: 0; border-bottom: 2px solid #e2e8f0; margin-bottom: 16px; overflow-x: auto; }
.flow-tab {
  padding: 10px 16px;
  border: none;
  background: none;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color 0.15s, border-color 0.15s;
}
.flow-tab:hover { color: #334155; }
.flow-tab.active { color: #3b82f6; border-bottom-color: #3b82f6; font-weight: 600; }
.flow-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: #e2e8f0;
  color: #475569;
}
.flow-tab.active .flow-tab-badge { background: #dbeafe; color: #1d4ed8; }
```

- [ ] **Step 2: Create FlowTabs.tsx**

```tsx
import type { StepResult, Issue } from '../../types';
import './FlowTabs.css';

interface FlowTabsProps {
  steps: StepResult[];
  activeStepIndex: number;
  allIssuesCount: number;
  onStepChange: (index: number) => void;
}

var STEP_ICONS: Record<string, string> = {
  navigate: '🌐',
  click: '🖱️',
  type: '⌨️',
  wait: '⏱️',
  select: '📋',
  hover: '👆',
  press: '⌨️',
  checkpoint: '📸',
};

export default function FlowTabs({ steps, activeStepIndex, allIssuesCount, onStepChange }: FlowTabsProps) {
  var icon = function(action: string) { return STEP_ICONS[action] || '▶️'; };

  return (
    <div className="flow-tabs">
      {steps.map(function(step) {
        var isActive = activeStepIndex === step.index;
        var label = icon(step.action) + ' ' + step.label;
        return (
          <button key={step.index} className={'flow-tab' + (isActive ? ' active' : '')} onClick={function() { onStepChange(step.index); }}>
            <span>{label}</span>
            <span className="flow-tab-badge">{step.summary.total}</span>
          </button>
        );
      })}
      <button className={'flow-tab' + (activeStepIndex === -1 ? ' active' : '')} onClick={function() { onStepChange(-1); }}>
        <span>📊 Resumen</span>
        <span className="flow-tab-badge">{allIssuesCount}</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and commit**

```bash
cd frontend; npx tsc --noEmit
git add frontend/src/components/FlowTabs/FlowTabs.tsx frontend/src/components/FlowTabs/FlowTabs.css
git commit -m "feat: add FlowTabs component for per-step navigation"
```

---

### Task 12: Home.tsx — Flow Integration

**Files:**
- Modify: `frontend/src/pages/Home.tsx`

**Interfaces:**
- Consumes: `FlowDefinition`, `FlowStep` types, `scanApi` flow methods, `FlowEditor`
- Produces: Flow selector dropdown, "new flow" button, flow sent with scan

- [ ] **Step 1: Add imports and state**

In `frontend/src/pages/Home.tsx`, add imports:

```tsx
import { useState, useEffect } from 'react';
import FlowEditor from '../components/FlowEditor/FlowEditor';
import { scanApi } from '../services/api';
import type { FlowDefinition, FlowStep } from '../types';
```

Add state variables:

```tsx
  const [savedFlows, setSavedFlows] = useState<FlowDefinition[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [showFlowEditor, setShowFlowEditor] = useState(false);
  const [inlineFlow, setInlineFlow] = useState<{ name: string; steps: FlowStep[] } | undefined>();
```

Load flows on mount:

```tsx
  useEffect(() => {
    scanApi.getFlows().then(setSavedFlows).catch(() => {});
  }, []);
```

- [ ] **Step 2: Add flow selector UI**

Before the URL input, add:

```tsx
          <div className="flow-selector">
            <select
              value={selectedFlowId}
              onChange={(e) => {
                setSelectedFlowId(e.target.value);
                setInlineFlow(undefined);
              }}
              className="flow-select"
            >
              <option value="">Sin flujo (scan normal)</option>
              {savedFlows.map((f) => (
                <option key={f.id} value={f.id}>{f.name} ({f.steps.length} pasos)</option>
              ))}
            </select>
            <button className="new-flow-btn" onClick={() => setShowFlowEditor(true)}>
              + Nuevo flujo
            </button>
          </div>
```

- [ ] **Step 3: Update handleStartScan**

Modify `handleStartScan` to include flow data:

```tsx
  const handleStartScan = async (url: string) => {
    // ... existing validation ...

    const scanRequest: any = { url };
    if (inlineFlow) {
      scanRequest.flow = inlineFlow;
    } else if (selectedFlowId) {
      scanRequest.flowId = selectedFlowId;
    }

    const response = await scanApi.startScan(scanRequest);
    // ... rest of existing code ...
  };
```

- [ ] **Step 4: Add FlowEditor modal**

```tsx
      {showFlowEditor && (
        <div className="modal-overlay" onClick={() => setShowFlowEditor(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <FlowEditor
              onSave={(flow) => {
                setInlineFlow(flow);
                setSelectedFlowId('');
                setShowFlowEditor(false);
                // Refresh saved flows list
                scanApi.getFlows().then(setSavedFlows).catch(() => {});
              }}
              onCancel={() => setShowFlowEditor(false)}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 5: Lint, type-check, commit**

```bash
cd frontend; npx tsc --noEmit; if ($?) { npx eslint . --ext ts,tsx --max-warnings 0 }
git add frontend/src/pages/Home.tsx
git commit -m "feat: add flow selector and FlowEditor integration to Home page"
```

---

### Task 13: ReportViewer — FlowTabs Integration

**Files:**
- Modify: `frontend/src/components/ReportViewer/ReportViewer.tsx`

**Interfaces:**
- Consumes: `FlowTabs`, `StepResult`, `ReportResponse.flow`, `ReportResponse.steps`
- Produces: Per-step tab filtering, step screenshot display

- [ ] **Step 1: Add imports**

```tsx
import FlowTabs from '@/components/FlowTabs/FlowTabs';
import type { StepResult } from '../../types';
```

- [ ] **Step 2: Add step state and filtering**

```tsx
  const [activeStepIndex, setActiveStepIndex] = useState(-1); // -1 = all steps

  const currentStepIssues = activeStepIndex === -1
    ? report.issues
    : report.issues.filter(function(i) { return i.stepIndex === activeStepIndex; });

  const currentStepResult = activeStepIndex >= 0
    ? report.steps?.find(function(s) { return s.index === activeStepIndex; })
    : undefined;
```

- [ ] **Step 3: Add FlowTabs above summary cards**

After report header and before summary-cards, add:

```tsx
      {report.flow && report.steps && (
        <FlowTabs
          steps={report.steps}
          activeStepIndex={activeStepIndex}
          allIssuesCount={report.summary.total}
          onStepChange={setActiveStepIndex}
        />
      )}
```

- [ ] **Step 4: Update step screenshot display**

When on a specific step index, show that step's screenshot instead of the main full-page one:

```tsx
      {currentStepResult?.fullPageScreenshot ? (
        <div className="report-screenshot">
          <ScreenshotThumb path={currentStepResult.fullPageScreenshot} alt={'Screenshot del paso ' + activeStepIndex} maxHeight={300} />
          <span className="report-screenshot-label">Screenshot del paso: {currentStepResult.label}</span>
        </div>
      ) : (activeStepIndex === -1 && report.fullPageScreenshot && (
        <div className="report-screenshot">
          <ScreenshotThumb path={report.fullPageScreenshot} alt={'Screenshot completo de ' + report.url} maxHeight={300} />
          <span className="report-screenshot-label">Screenshot completo de la pagina</span>
        </div>
      ))}
```

- [ ] **Step 5: Filter issues by step in the groups**

Change the issues filtering to use `currentStepIssues`:

```tsx
  const filteredIssues = currentStepIssues.filter((issue) => {
    if (filterType !== 'ALL' && issue.type !== filterType) return false;
    if (filterSeverity !== 'ALL' && issue.severity !== filterSeverity) return false;
    if (searchQuery && !issue.description.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !issue.url.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });
```

- [ ] **Step 6: Lint, type-check, commit**

```bash
cd frontend; npx tsc --noEmit; if ($?) { npx eslint . --ext ts,tsx --max-warnings 0 }
git add frontend/src/components/ReportViewer/ReportViewer.tsx
git commit -m "feat: add FlowTabs integration to ReportViewer with per-step filtering"
```
