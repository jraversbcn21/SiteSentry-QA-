# Visual Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual regression detection to SiteSentry by comparing full-page and element screenshots between scans of the same URL using pixelmatch, with automatic (last scan) and manual baseline selection.

**Architecture:** New `runVisualRegression()` step in ScanWorker executes after screenshots are captured. It finds a baseline scan for the same URL, runs pixelmatch for full-page and per-element diffs, persists results to a new `visual_diffs` table, and saves diff PNGs alongside existing screenshots. The frontend displays diffs via a new `VisualDiffViewer` component with side-by-side slider, diff image, and percentage badge.

**Tech Stack:** pixelmatch (pure JS pixel comparison), pngjs (PNG decode/encode), sharp (image resizing), better-sqlite3 (new table + column), Express route for set-baseline, React component for diff viewer.

## Global Constraints

- `VISUAL_DIFF_THRESHOLD` env var (default `0.05`), overridable per scan via POST body `visualDiffThreshold`
- Visual regression is **best effort** — failures do not fail the scan
- Only screenshots for HIGH severity issues with `selector` in metadata are diffed (per-element)
- Full-page diff always attempted (if baseline full.png exists)
- Baseline: manual (is_baseline=1) takes priority over automatic (last completed scan of same URL)
- UI language: Spanish
- Backend: CommonJS (`"module": "commonjs"`), tsx runner
- Frontend: ESM (`"type": "module"`), Vite, `@/` alias → `src/`
- Use `import { randomUUID } from 'crypto'`, not `crypto.randomUUID()`
- DB migrations: idempotent try/catch with duplicate detection, same pattern as existing db.ts

---

## File Structure

| File | Responsibility |
|------|---------------|
| `backend/package.json` | Dependencies (pixelmatch, pngjs, sharp) |
| `backend/src/database/db.ts` | Migrations: is_baseline column, visual_diffs table |
| `backend/src/types/index.ts` | Interfaces: VisualDiff (backend), BaselineInfo. ReportResponse types. |
| `backend/src/workers/ScanWorker.ts` | `runVisualRegression()` — baseline lookup, full-page diff, element diff |
| `backend/src/api/routes/scan.ts` | Accept `visualDiffThreshold` in POST body |
| `backend/src/api/routes/reports.ts` | Query visual_diffs + baseline info for GET /api/reports/:id |
| `backend/src/api/server.ts` | POST /api/scans/:id/set-baseline route |
| `frontend/src/types/index.ts` | Interfaces: VisualDiff, BaselineInfo, update ReportResponse, ScanRequest, add `id` to Issue |
| `frontend/src/services/api.ts` | setBaseline() method |
| `frontend/src/components/VisualDiffViewer/VisualDiffViewer.tsx` | NEW — slider side-by-side + diff.png + percentage badge |
| `frontend/src/components/VisualDiffViewer/VisualDiffViewer.css` | NEW — slider/diff/badge styles |
| `frontend/src/components/ReportViewer/ReportViewer.tsx` | Visual regression section, baseline button, pass diffs to ErrorGroup |
| `frontend/src/components/ErrorGroup/ErrorGroup.tsx` | Accept visualDiffsMap, pass to ErrorCard |
| `frontend/src/components/ErrorCard/ErrorCard.tsx` | Accept visualDiff prop, render VisualDiffViewer |

---

### Task 1: Backend Dependencies

**Files:**
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `pixelmatch`, `pngjs`, `sharp` available for import

- [ ] **Step 1: Install dependencies**

```bash
npm install pixelmatch pngjs sharp && npm install -D @types/pngjs
```

Run: `cd backend; npm install pixelmatch pngjs sharp; if ($?) { npm install -D @types/pngjs }`
Expected: packages added to package.json and node_modules

- [ ] **Step 2: Verify pixelmatch can be imported**

```bash
node -e "const pm = require('pixelmatch'); console.log('pixelmatch OK:', typeof pm)"
```

Run: `cd backend; node -e "const pm = require('pixelmatch'); console.log('pixelmatch OK:', typeof pm)"`
Expected: `pixelmatch OK: function`

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add pixelmatch, pngjs, and sharp dependencies for visual regression"
```

---

### Task 2: Database Migrations

**Files:**
- Modify: `backend/src/database/db.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `scans.is_baseline` column, `visual_diffs` table

- [ ] **Step 1: Add migrations to db.ts**

In `backend/src/database/db.ts`, add after line 57 (after the screenshot_path migration block):

```typescript
  // Migracion: agregar is_baseline a scans (Fase 2 - Visual Regression)
  try {
    db.exec('ALTER TABLE scans ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.warn('Migration warning (is_baseline):', e.message);
    }
  }

  // Migracion: crear tabla visual_diffs (Fase 2 - Visual Regression)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS visual_diffs (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL,
        baseline_scan_id TEXT NOT NULL,
        diff_type TEXT NOT NULL,
        issue_id TEXT,
        element_identifier TEXT,
        diff_percentage REAL NOT NULL,
        diff_image_path TEXT,
        threshold_used REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE,
        FOREIGN KEY (baseline_scan_id) REFERENCES scans(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_visual_diffs_scan_id ON visual_diffs(scan_id);
      CREATE INDEX IF NOT EXISTS idx_visual_diffs_issue_id ON visual_diffs(issue_id);
    `);
  } catch (e: any) {
    if (!e.message.includes('already exists')) {
      console.warn('Migration warning (visual_diffs):', e.message);
    }
  }
```

- [ ] **Step 2: Run type-check to verify**

```bash
npx tsc --noEmit
```

Run: `cd backend; npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/database/db.ts
git commit -m "feat: add is_baseline column and visual_diffs table migrations"
```

---

### Task 3: Backend Types

**Files:**
- Modify: `backend/src/types/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `VisualDiff` interface, `BaselineInfo` interface, updated report response type

- [ ] **Step 1: Add new interfaces**

In `backend/src/types/index.ts`, add after line 46:

```typescript
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

export interface ReportResponse {
  id: string;
  url: string;
  status: ScanStatus;
  createdAt: string;
  completedAt?: string;
  issues: Array<{
    id: string;
    scanId: string;
    type: IssueType;
    severity: IssueSeverity;
    url: string;
    sourceUrl: string | null;
    description: string;
    metadata: Record<string, unknown> | null;
    screenshot_path: string | null;
    createdAt: string;
  }>;
  fullPageScreenshot?: string | null;
  visualDiffs: VisualDiff[];
  baselineInfo: BaselineInfo | null;
  summary: {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit
```

Run: `cd backend; npx tsc --noEmit`
Expected: No errors. If there are errors from reports.ts (expected — the route doesn't return visualDiffs/baselineInfo yet), proceed to Task 6.

- [ ] **Step 3: Commit**

```bash
git add backend/src/types/index.ts
git commit -m "feat: add VisualDiff, BaselineInfo types and ReportResponse interface"
```

---

### Task 4: Scan Route — visualDiffThreshold param

**Files:**
- Modify: `backend/src/api/routes/scan.ts:9-16` (ScanRequestSchema)

**Interfaces:**
- Consumes: `ScanRequestSchema` from existing code
- Produces: `visualDiffThreshold` accepted in POST body, stored in config JSON

- [ ] **Step 1: Update ScanRequestSchema**

In `backend/src/api/routes/scan.ts`, change lines 9-16 from:

```typescript
const ScanRequestSchema = z.object({
  url: z.string().url('URL invalida - debe incluir http:// o https://'),
  config: z
    .object({
      timeout: z.number().int().min(5000).max(120000).optional(),
    })
    .optional(),
});
```

To:

```typescript
const ScanRequestSchema = z.object({
  url: z.string().url('URL invalida - debe incluir http:// o https://'),
  visualDiffThreshold: z.number().min(0).max(1).optional(),
  config: z
    .object({
      timeout: z.number().int().min(5000).max(120000).optional(),
    })
    .optional(),
});
```

- [ ] **Step 2: Pass visualDiffThreshold into config**

In `backend/src/api/routes/scan.ts`, change lines 40-44 from:

```typescript
    await scanQueue.add('process-scan', {
      scanId: scan.id,
      url: normalizedUrl,
      config: config || {},
    });
```

To:

```typescript
    const jobConfig = {
      ...(config || {}),
      ...(validation.data.visualDiffThreshold !== undefined
        ? { visualDiffThreshold: validation.data.visualDiffThreshold }
        : {}),
    };

    await scanQueue.add('process-scan', {
      scanId: scan.id,
      url: normalizedUrl,
      config: jobConfig,
    });
```

- [ ] **Step 3: Run type-check**

```bash
npx tsc --noEmit
```

Run: `cd backend; npx tsc --noEmit`
Expected: No errors in scan.ts

- [ ] **Step 4: Commit**

```bash
git add backend/src/api/routes/scan.ts
git commit -m "feat: accept visualDiffThreshold param in POST /api/scan"
```

---

### Task 5: Set-Baseline Route

**Files:**
- Modify: `backend/src/api/server.ts`

**Interfaces:**
- Consumes: `getDb` from db.ts, `randomUUID` from crypto
- Produces: `POST /api/scans/:id/set-baseline` — marks/unmarks scan as manual baseline

- [ ] **Step 1: Add route to server.ts**

In `backend/src/api/server.ts`, add after line 44 (`app.use('/api/reports', reportsRoutes);`):

```typescript
// Set/unset manual baseline
app.post('/api/scans/:id/set-baseline', (req, res) => {
  try {
    const { id } = req.params;
    const { isBaseline } = req.body;

    if (!/^[a-f0-9-]{36}$/.test(id)) {
      res.status(400).json({ error: 'ID de scan invalido' });
      return;
    }

    if (typeof isBaseline !== 'boolean') {
      res.status(400).json({ error: 'isBaseline debe ser booleano' });
      return;
    }

    const db = require('../database/db').getDb();
    const scan = db.prepare('SELECT id, url FROM scans WHERE id = ?').get(id) as { id: string; url: string } | undefined;

    if (!scan) {
      res.status(404).json({ error: 'Scan no encontrado' });
      return;
    }

    if (isBaseline) {
      // Desmarcar cualquier otro baseline manual de la misma URL
      db.prepare('UPDATE scans SET is_baseline = 0 WHERE url = ? AND is_baseline = 1 AND id != ?').run(scan.url, id);
      // Marcar este scan como baseline
      db.prepare('UPDATE scans SET is_baseline = 1 WHERE id = ?').run(id);
    } else {
      db.prepare('UPDATE scans SET is_baseline = 0 WHERE id = ?').run(id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error setting baseline:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit
```

Run: `cd backend; npx tsc --noEmit`
Expected: No errors. Ignore any pre-existing errors from reports.ts (to be fixed in Task 6).

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/server.ts
git commit -m "feat: add POST /api/scans/:id/set-baseline route"
```

---

### Task 6: Reports Route — visualDiffs and baselineInfo

**Files:**
- Modify: `backend/src/api/routes/reports.ts`

**Interfaces:**
- Consumes: `getDb` from db.ts
- Produces: `visualDiffs` array and `baselineInfo` object in `GET /api/reports/:id` response

- [ ] **Step 1: Add visual diff queries to GET /api/reports/:id**

In `backend/src/api/routes/reports.ts`, after line 95 (the `fullPageScreenshot` line), add:

```typescript
    // Visual diffs
    const visualDiffs = db.prepare(
      'SELECT * FROM visual_diffs WHERE scan_id = ? ORDER BY diff_type, created_at'
    ).all(id) as Array<{
      id: string;
      scan_id: string;
      baseline_scan_id: string;
      diff_type: string;
      issue_id: string | null;
      element_identifier: string | null;
      diff_percentage: number;
      diff_image_path: string | null;
      threshold_used: number;
      created_at: string;
    }>;

    const parsedVisualDiffs = visualDiffs.map((d) => ({
      id: d.id,
      diffType: d.diff_type,
      baselineScanId: d.baseline_scan_id,
      diffPercentage: d.diff_percentage,
      diffImagePath: d.diff_image_path,
      thresholdUsed: d.threshold_used,
      elementIdentifier: d.element_identifier || undefined,
      issueId: d.issue_id || undefined,
    }));

    // Baseline info
    let baselineInfo: { scanId: string; isManual: boolean; createdAt: string } | null = null;
    if (visualDiffs.length > 0) {
      const baselineScan = db.prepare(
        'SELECT id, is_baseline, created_at FROM scans WHERE id = ?'
      ).get(visualDiffs[0].baseline_scan_id) as {
        id: string;
        is_baseline: number;
        created_at: string;
      } | undefined;

      if (baselineScan) {
        baselineInfo = {
          scanId: baselineScan.id,
          isManual: baselineScan.is_baseline === 1,
          createdAt: baselineScan.created_at,
        };
      }
    }
```

- [ ] **Step 2: Update the response object**

In `backend/src/api/routes/reports.ts`, change the return statement (lines 97-110) from:

```typescript
    return res.json({
      id: scan.id,
      url: scan.url,
      status: scan.status,
      createdAt: scan.created_at,
      completedAt: scan.completed_at,
      issues: parsedIssues,
      fullPageScreenshot,
      summary: {
        total: parsedIssues.length,
        byType,
        bySeverity,
      },
    });
```

To:

```typescript
    return res.json({
      id: scan.id,
      url: scan.url,
      status: scan.status,
      createdAt: scan.created_at,
      completedAt: scan.completed_at,
      issues: parsedIssues,
      fullPageScreenshot,
      visualDiffs: parsedVisualDiffs,
      baselineInfo,
      summary: {
        total: parsedIssues.length,
        byType,
        bySeverity,
      },
    });
```

- [ ] **Step 3: Run type-check**

```bash
npx tsc --noEmit
```

Run: `cd backend; npx tsc --noEmit`
Expected: No errors (the ReportResponse type defined in Task 3 should cover this)

- [ ] **Step 4: Commit**

```bash
git add backend/src/api/routes/reports.ts
git commit -m "feat: add visualDiffs and baselineInfo to GET /api/reports/:id"
```

---

### Task 7: ScanWorker — runVisualRegression

**Files:**
- Modify: `backend/src/workers/ScanWorker.ts`

**Interfaces:**
- Consumes: `getDb` from db.ts, `randomUUID` from crypto, `pixelmatch`, `pngjs`, `sharp`
- Produces: `runVisualRegression(scanId, url, allIssues, config)` — persisted visual diffs

- [ ] **Step 1: Add imports**

In `backend/src/workers/ScanWorker.ts`, add after line 8 (`import fs from 'fs';`):

```typescript
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
```

- [ ] **Step 2: Add runVisualRegression function**

In `backend/src/workers/ScanWorker.ts`, add before line 16 (`export async function processScanJob`):

```typescript
interface RunVisualRegressionParams {
  scanId: string;
  url: string;
  allIssues: import('../types').Issue[];
  config: { timeout?: number; visualDiffThreshold?: number };
}

async function runVisualRegression(params: RunVisualRegressionParams) {
  const { scanId, url, allIssues, config } = params;
  const db = getDb();

  try {
    // 1. Find baseline
    var baselineScan = db.prepare(
      'SELECT id FROM scans WHERE url = ? AND is_baseline = 1 ORDER BY created_at DESC LIMIT 1'
    ).get(url) as { id: string } | undefined;

    if (!baselineScan) {
      baselineScan = db.prepare(
        'SELECT id FROM scans WHERE url = ? AND id != ? AND status = ? ORDER BY created_at DESC LIMIT 1'
      ).get(url, scanId, ScanStatus.COMPLETED) as { id: string } | undefined;
    }

    if (!baselineScan) {
      console.log('[ScanWorker] Sin baseline para regresion visual (primer scan de esta URL)');
      return;
    }

    console.log(`[ScanWorker] Baseline encontrado: ${baselineScan.id}`);

    // 2. Threshold
    var threshold = config.visualDiffThreshold ?? parseFloat(process.env.VISUAL_DIFF_THRESHOLD || '0.05');

    var screenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
    var baselineDir = path.join(process.cwd(), 'data', 'screenshots', baselineScan.id);

    // 3. Full-page diff
    var currentFullPath = path.join(screenshotDir, 'full.png');
    var baselineFullPath = path.join(baselineDir, 'full.png');

    if (fs.existsSync(currentFullPath) && fs.existsSync(baselineFullPath)) {
      try {
        var diffResult = await diffImages(baselineFullPath, currentFullPath, threshold);
        var diffFullPath = path.join(screenshotDir, 'diff-full.png');
        fs.writeFileSync(diffFullPath, PNG.sync.write(diffResult.diffImage));
        var diffId = randomUUID();
        db.prepare(`
          INSERT INTO visual_diffs (id, scan_id, baseline_scan_id, diff_type, issue_id, element_identifier, diff_percentage, diff_image_path, threshold_used, created_at)
          VALUES (?, ?, ?, 'full_page', NULL, NULL, ?, ?, ?, ?)
        `).run(diffId, scanId, baselineScan.id, diffResult.diffPercentage, `${scanId}/diff-full.png`, threshold, new Date().toISOString());
        console.log(`[ScanWorker] Full-page diff: ${diffResult.diffPercentage.toFixed(1)}% diferente`);
      } catch (err) {
        console.warn('[ScanWorker] Full-page diff fallo:', err);
      }
    }

    // 4. Element diffs
    var baselineIssues = db.prepare(
      "SELECT id, type, url, metadata, screenshot_path FROM issues WHERE scan_id = ?"
    ).all(baselineScan.id) as Array<{
      id: string;
      type: string;
      url: string;
      metadata: string | null;
      screenshot_path: string | null;
    }>;

    for (var i = 0; i < allIssues.length; i++) {
      var issue = allIssues[i];
      var issueId = (issue as any).id as string;
      if (issue.severity !== 'HIGH') continue;
      if (!issue.screenshot_path) continue;

      var currentIssuePath = path.join(screenshotDir, `${issueId}.png`);

      // Buscar issue equivalente en el baseline
      var matchedBaseline: typeof baselineIssues[0] | null = null;
      var elementIdentifier = '';

      var selector = issue.metadata?.selector as string | undefined;

      for (var j = 0; j < baselineIssues.length; j++) {
        var baselineIssue = baselineIssues[j];
        if (!baselineIssue.screenshot_path) continue;

        // Match por selector
        if (selector && baselineIssue.metadata) {
          try {
            var baselineMeta = JSON.parse(baselineIssue.metadata);
            if (baselineMeta.selector === selector) {
              matchedBaseline = baselineIssue;
              elementIdentifier = selector;
              break;
            }
          } catch {}
        }
      }

      // Fallback: match por tipo + URL
      if (!matchedBaseline) {
        for (var k = 0; k < baselineIssues.length; k++) {
          var bi = baselineIssues[k];
          if (!bi.screenshot_path) continue;
          if (bi.type === issue.type && bi.url === issue.url) {
            matchedBaseline = bi;
            elementIdentifier = `${bi.type}:${bi.url}`;
            break;
          }
        }
      }

      if (!matchedBaseline) continue;

      var baselineIssuePath = path.join(baselineDir, `${matchedBaseline.id}.png`);

      if (!fs.existsSync(baselineIssuePath)) continue;

      try {
        var elDiffResult = await diffImages(baselineIssuePath, currentIssuePath, threshold);
        var diffIssuePath = path.join(screenshotDir, `diff-${issueId}.png`);
        fs.writeFileSync(diffIssuePath, PNG.sync.write(elDiffResult.diffImage));
        var elDiffId = randomUUID();
        db.prepare(`
          INSERT INTO visual_diffs (id, scan_id, baseline_scan_id, diff_type, issue_id, element_identifier, diff_percentage, diff_image_path, threshold_used, created_at)
          VALUES (?, ?, ?, 'element', ?, ?, ?, ?, ?, ?)
        `).run(elDiffId, scanId, baselineScan.id, issueId, elementIdentifier, elDiffResult.diffPercentage, `${scanId}/diff-${issueId}.png`, threshold, new Date().toISOString());
      } catch (err) {
        console.debug(`[ScanWorker] Element diff fallo para issue ${issueId}:`, err);
      }
    }

    console.log('[ScanWorker] Regresion visual completada');
  } catch (err) {
    console.warn('[ScanWorker] Regresion visual fallo (best effort):', err);
  }
}

interface DiffResult {
  diffPercentage: number;
  diffImage: PNG;
}

async function diffImages(baselinePath: string, currentPath: string, threshold: number): Promise<DiffResult> {
  var baselinePng = PNG.sync.read(fs.readFileSync(baselinePath));
  var currentPng = PNG.sync.read(fs.readFileSync(currentPath));

  // Redimensionar al tamano comun mas pequeno
  var targetWidth = Math.min(baselinePng.width, currentPng.width);
  var targetHeight = Math.min(baselinePng.height, currentPng.height);

  if (baselinePng.width !== targetWidth || baselinePng.height !== targetHeight) {
    var resized = await sharp(fs.readFileSync(baselinePath))
      .resize(targetWidth, targetHeight)
      .raw()
      .toBuffer({ resolveWithObject: true });
    baselinePng = new PNG({ width: targetWidth, height: targetHeight });
    resized.data.copy(baselinePng.data);
  }

  if (currentPng.width !== targetWidth || currentPng.height !== targetHeight) {
    var resized2 = await sharp(fs.readFileSync(currentPath))
      .resize(targetWidth, targetHeight)
      .raw()
      .toBuffer({ resolveWithObject: true });
    currentPng = new PNG({ width: targetWidth, height: targetHeight });
    resized2.data.copy(currentPng.data);
  }

  var diffPng = new PNG({ width: targetWidth, height: targetHeight });
  var diffPixels = pixelmatch(
    baselinePng.data,
    currentPng.data,
    diffPng.data,
    targetWidth,
    targetHeight,
    { threshold: threshold }
  );

  var totalPixels = targetWidth * targetHeight;
  var diffPercentage = (diffPixels / totalPixels) * 100;

  return { diffPercentage, diffImage: diffPng };
}
```

- [ ] **Step 3: Call runVisualRegression in processScanJob**

In `backend/src/workers/ScanWorker.ts`, after line 138 (`insertMany(allIssues);`) and the closing `}` of the `if (allIssues.length > 0)` block (which is at line 138), add:

```typescript

    // --- Visual Regression ---
    await runVisualRegression({
      scanId,
      url,
      allIssues,
      config: config as { timeout?: number; visualDiffThreshold?: number },
    });
```

- [ ] **Step 4: Run type-check**

```bash
npx tsc --noEmit
```

Run: `cd backend; npx tsc --noEmit`
Expected: No errors. pixelmatch types should be available from DefinitelyTyped.

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/ScanWorker.ts
git commit -m "feat: add runVisualRegression step to ScanWorker"
```

---

### Task 8: Frontend Types

**Files:**
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `VisualDiff`, `BaselineInfo`, updated `ReportResponse`, updated `ScanRequest`, `id` field on `Issue`

- [ ] **Step 1: Add types to frontend/src/types/index.ts**

Add `id` to the `Issue` interface (line 27), changing:

```typescript
export interface Issue {
  type: IssueType;
```

To:

```typescript
export interface Issue {
  id?: string;
  type: IssueType;
```

Add `visualDiffThreshold` to `ScanRequest` (after line 42), changing:

```typescript
export interface ScanRequest {
  url: string;
  config?: {
    timeout?: number;
  };
}
```

To:

```typescript
export interface ScanRequest {
  url: string;
  visualDiffThreshold?: number;
  config?: {
    timeout?: number;
  };
}
```

Add after line 74 (end of `ReportResponse` interface), before the closing of the file:

```typescript
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
```

Update `ReportResponse` (around line 61-74) to add the new fields:

```typescript
export interface ReportResponse {
  id: string;
  url: string;
  status: ScanStatus;
  createdAt: string;
  completedAt?: string;
  issues: Issue[];
  fullPageScreenshot?: string | null;
  visualDiffs: VisualDiff[];
  baselineInfo: BaselineInfo | null;
  summary: {
    total: number;
    byType: Record<IssueType, number>;
    bySeverity: Record<IssueSeverity, number>;
  };
}
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit
```

Run: `cd frontend; npx tsc --noEmit`
Expected: Errors from components that don't yet pass visualDiffs/baselineInfo (expected, will be fixed in later tasks). But no errors in types/index.ts itself.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: add VisualDiff, BaselineInfo frontend types and update ReportResponse"
```

---

### Task 9: Frontend API — setBaseline

**Files:**
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Consumes: `VisualDiff`, `BaselineInfo`, updated `ReportResponse` types from Task 8
- Produces: `setBaseline(scanId, isBaseline)` method

- [ ] **Step 1: Add setBaseline method**

In `frontend/src/services/api.ts`, add after line 32 (`getReports` method):

```typescript
  setBaseline: async (scanId: string, isBaseline: boolean): Promise<void> => {
    await api.post(`/scans/${scanId}/set-baseline`, { isBaseline });
  },
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit
```

Run: `cd frontend; npx tsc --noEmit`
Expected: No new errors (existing errors from un-updated components are expected)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: add setBaseline API method"
```

---

### Task 10: VisualDiffViewer Component

**Files:**
- Create: `frontend/src/components/VisualDiffViewer/VisualDiffViewer.tsx`
- Create: `frontend/src/components/VisualDiffViewer/VisualDiffViewer.css`

**Interfaces:**
- Consumes: nothing external
- Produces: `VisualDiffViewer` component with props: `baselineSrc`, `currentSrc`, `diffSrc`, `diffPercentage`, `threshold`, `alt`, `maxHeight`

- [ ] **Step 1: Create VisualDiffViewer.css**

```css
.visual-diff-viewer {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: #f8fafc;
  margin: 12px 0;
}

.visual-diff-viewer.compact {
  max-width: 400px;
}

.vd-slider-container {
  position: relative;
  width: 100%;
  overflow: hidden;
  user-select: none;
}

.vd-slider-container img {
  display: block;
  width: 100%;
  height: auto;
}

.vd-slider-current {
  width: 100%;
}

.vd-slider-baseline {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  overflow: hidden;
}

.vd-slider-baseline img {
  position: absolute;
  top: 0;
  left: 0;
  width: auto;
  height: 100%;
  max-width: none;
}

.vd-slider-range {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: col-resize;
  z-index: 3;
  margin: 0;
}

.vd-slider-line {
  position: absolute;
  top: 0;
  height: 100%;
  width: 2px;
  background: #3b82f6;
  z-index: 2;
  pointer-events: none;
  box-shadow: 0 0 4px rgba(59, 130, 246, 0.5);
}

.vd-slider-handle {
  position: absolute;
  top: 50%;
  width: 28px;
  height: 28px;
  background: #3b82f6;
  border: 2px solid #fff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
  pointer-events: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.vd-labels {
  display: flex;
  justify-content: space-between;
  padding: 4px 12px;
  font-size: 12px;
  color: #64748b;
  background: #f1f5f9;
}

.vd-diff-section {
  padding: 8px 12px 12px;
}

.vd-diff-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.vd-diff-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
}

.vd-diff-badge.over {
  background: #fee2e2;
  color: #dc2626;
}

.vd-diff-badge.under {
  background: #dcfce7;
  color: #16a34a;
}

.vd-diff-image-container {
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  overflow: hidden;
}

.vd-diff-image-container img {
  display: block;
  width: 100%;
  height: auto;
}

.vd-threshold-info {
  font-size: 11px;
  color: #94a3b8;
}
```

- [ ] **Step 2: Create VisualDiffViewer.tsx**

```tsx
import { useState, useRef, useCallback } from 'react';
import './VisualDiffViewer.css';

interface VisualDiffViewerProps {
  baselineSrc: string;
  currentSrc: string;
  diffSrc: string;
  diffPercentage: number;
  threshold: number;
  alt: string;
  maxHeight?: number;
  compact?: boolean;
}

export default function VisualDiffViewer({
  baselineSrc,
  currentSrc,
  diffSrc,
  diffPercentage,
  threshold,
  alt,
  maxHeight = 400,
  compact = false,
}: VisualDiffViewerProps) {
  var [sliderPos, setSliderPos] = useState(50);
  var containerRef = useRef<HTMLDivElement>(null);

  var handleSliderChange = useCallback(function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSliderPos(Number(e.target.value));
  }, []);

  var isOverThreshold = diffPercentage > threshold * 100;

  return (
    <div className={`visual-diff-viewer${compact ? ' compact' : ''}`}>
      <div
        className="vd-slider-container"
        ref={containerRef}
        style={{ maxHeight: `${maxHeight}px` }}
      >
        <div className="vd-slider-current">
          <img src={`/screenshots/${currentSrc}`} alt={`${alt} (actual)`} />
        </div>
        <div
          className="vd-slider-baseline"
          style={{ width: `${sliderPos}%` }}
        >
          <img
            src={`/screenshots/${baselineSrc}`}
            alt={`${alt} (baseline)`}
            style={{ width: `${100 / (sliderPos / 100)}%` }}
          />
        </div>
        <div className="vd-slider-line" style={{ left: `${sliderPos}%` }} />
        <div className="vd-slider-handle" style={{ left: `${sliderPos}%` }} />
        <input
          type="range"
          className="vd-slider-range"
          min={0}
          max={100}
          value={sliderPos}
          onChange={handleSliderChange}
          aria-label="Comparar baseline vs actual"
        />
      </div>
      <div className="vd-labels">
        <span>Baseline</span>
        <span>Actual</span>
      </div>
      <div className="vd-diff-section">
        <div className="vd-diff-header">
          <span className={`vd-diff-badge ${isOverThreshold ? 'over' : 'under'}`}>
            {isOverThreshold ? '⚠️' : '✅'} {diffPercentage.toFixed(1)}% diferente
          </span>
          <span className="vd-threshold-info">Umbral: {(threshold * 100).toFixed(1)}%</span>
        </div>
        <div className="vd-diff-image-container">
          <img src={`/screenshots/${diffSrc}`} alt={`Diff: ${alt}`} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run type-check**

```bash
npx tsc --noEmit
```

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors in VisualDiffViewer.tsx. Ignore errors from other files not yet updated.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/VisualDiffViewer/VisualDiffViewer.tsx frontend/src/components/VisualDiffViewer/VisualDiffViewer.css
git commit -m "feat: add VisualDiffViewer component with slider, diff image, and percentage badge"
```

---

### Task 11: ReportViewer — Visual Regression Section

**Files:**
- Modify: `frontend/src/components/ReportViewer/ReportViewer.tsx`

**Interfaces:**
- Consumes: `VisualDiff`, `BaselineInfo` types, `scanApi.setBaseline()` from Task 9, `VisualDiffViewer` from Task 10
- Produces: Visual regression section with full-page diff, baseline button, element diff propagation

- [ ] **Step 1: Add imports and state**

In `frontend/src/components/ReportViewer/ReportViewer.tsx`, change line 1 from:

```tsx
import { useState } from 'react';
```

To:

```tsx
import { useState, useMemo } from 'react';
```

Add import after line 5:

```tsx
import VisualDiffViewer from '@/components/VisualDiffViewer/VisualDiffViewer';
import { VisualDiff } from '../../types';
import { scanApi } from '../../services/api';
```

Change the interface (lines 88-90) to include `onBaselineChange`:

```tsx
interface ReportViewerProps {
  report: ReportResponse;
  onBaselineChange?: () => void;
}
```

- [ ] **Step 2: Add state and build diff map**

In the `ReportViewer` function, after line 97 (`const [searchQuery, setSearchQuery] = useState('');`), add:

```tsx
  const [baselineLoading, setBaselineLoading] = useState(false);

  const elementDiffsMap = useMemo(function buildElementDiffsMap() {
    var map: Record<string, VisualDiff> = {};
    for (var i = 0; i < report.visualDiffs.length; i++) {
      var diff = report.visualDiffs[i];
      if (diff.diffType === 'element' && diff.issueId) {
        map[diff.issueId] = diff;
      }
    }
    return map;
  }, [report.visualDiffs]);

  var fullPageDiff = report.visualDiffs.find(function findFullPageDiff(d) { return d.diffType === 'full_page'; });
  var isBaseline = report.baselineInfo?.isManual ?? false;
```

- [ ] **Step 3: Add baseline toggle handler**

After the elementDiffsMap block, add:

```tsx
  var handleToggleBaseline = async function handleToggleBaseline() {
    setBaselineLoading(true);
    try {
      await scanApi.setBaseline(report.id, !isBaseline);
      if (report.onBaselineChange) report.onBaselineChange();
      // Re-fetch by reloading
      window.location.reload();
    } catch (err) {
      console.error('Error setting baseline:', err);
    } finally {
      setBaselineLoading(false);
    }
  };
```

- [ ] **Step 4: Add visual regression section in the render**

After the full-page screenshot section (lines 190-199, the `{report.fullPageScreenshot && (` block), add:

```tsx
      {/* Visual Regression Section */}
      {(fullPageDiff || report.baselineInfo) && (
        <div className="report-section visual-regression-section">
          <div className="section-header">
            <h3>📸 Regresion Visual</h3>
            {report.baselineInfo && (
              <span className="baseline-meta">
                Comparado contra scan del{' '}
                {new Date(report.baselineInfo.createdAt).toLocaleDateString('es-ES')}
                {report.baselineInfo.isManual && ' (manual)'}
              </span>
            )}
          </div>

          {fullPageDiff && report.fullPageScreenshot && (
            <VisualDiffViewer
              baselineSrc={`${fullPageDiff.baselineScanId}/full.png`}
              currentSrc={report.fullPageScreenshot}
              diffSrc={fullPageDiff.diffImagePath}
              diffPercentage={fullPageDiff.diffPercentage}
              threshold={fullPageDiff.thresholdUsed}
              alt={`Full-page: ${report.url}`}
            />
          )}

          <div className="baseline-actions">
            <button
              className={`baseline-btn ${isBaseline ? 'is-baseline' : ''}`}
              onClick={handleToggleBaseline}
              disabled={baselineLoading}
            >
              {baselineLoading ? '⏳' : isBaseline ? '⭐ Quitar baseline' : '☆ Marcar como baseline'}
            </button>
          </div>
        </div>
      )}

      {!fullPageDiff && !report.baselineInfo && report.status === ScanStatus.COMPLETED && (
        <div className="report-section visual-regression-section">
          <div className="section-header">
            <h3>📸 Regresion Visual</h3>
          </div>
          <p className="no-baseline-msg">
            Sin baseline para comparar. Realiza otro scan de esta URL para ver diferencias visuales.
          </p>
          <div className="baseline-actions">
            <button
              className="baseline-btn"
              onClick={handleToggleBaseline}
              disabled={baselineLoading}
            >
              {baselineLoading ? '⏳' : '☆ Marcar como baseline'}
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Pass elementDiffsMap to ErrorGroup**

In the render, where ErrorGroup is rendered (around line 277):

```tsx
            <ErrorGroup
              key={type}
              type={type as IssueType}
              issues={issues}
              defaultOpen={false}
              visualDiffsMap={elementDiffsMap}
            />
```

- [ ] **Step 6: Run type-check and lint**

```bash
npx tsc --noEmit; if ($?) { npm run lint }
```

Run: `cd frontend; npx tsc --noEmit`
Expected: May have errors in ErrorGroup/ErrorCard (not yet updated). If only those, proceed. Fix any errors in ReportViewer.tsx itself.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ReportViewer/ReportViewer.tsx
git commit -m "feat: add visual regression section and baseline toggle to ReportViewer"
```

---

### Task 12: ErrorGroup and ErrorCard — Element Diffs

**Files:**
- Modify: `frontend/src/components/ErrorGroup/ErrorGroup.tsx`
- Modify: `frontend/src/components/ErrorCard/ErrorCard.tsx`

**Interfaces:**
- Consumes: `VisualDiff` type from Task 8
- Produces: Element diffs shown inside ErrorCard details. For elements, only diff.png + percentage badge is shown (no slider) because the baseline element screenshot path requires the baseline issue ID which is not stored in visual_diffs.

- [ ] **Step 1: Update ErrorGroup to accept and pass visualDiffsMap**

In `frontend/src/components/ErrorGroup/ErrorGroup.tsx`, change line 2 from:

```tsx
import { Issue, IssueType } from '../../types';
```

To:

```tsx
import { Issue, IssueType, VisualDiff } from '../../types';
```

Change the ErrorGroupProps interface (lines 6-10) to:

```tsx
interface ErrorGroupProps {
  type: IssueType;
  issues: Issue[];
  defaultOpen?: boolean;
  visualDiffsMap?: Record<string, VisualDiff>;
}
```

Change line 24 to destructure `visualDiffsMap`:

```tsx
export default function ErrorGroup({ type, issues, defaultOpen = false, visualDiffsMap }: ErrorGroupProps) {
```

Change the ErrorCard rendering (line 55) from:

```tsx
            <ErrorCard key={`${issue.url}-${index}`} issue={issue} />
```

To:

```tsx
            <ErrorCard
              key={`${issue.url}-${index}`}
              issue={issue}
              visualDiff={issue.id && visualDiffsMap ? visualDiffsMap[issue.id] : undefined}
            />
```

- [ ] **Step 2: Update ErrorCard to accept and render visualDiff**

In `frontend/src/components/ErrorCard/ErrorCard.tsx`, change line 1 from:

```tsx
import { useState } from 'react';
import { Issue, IssueSeverity, IssueType } from '../../types';
```

To:

```tsx
import { useState } from 'react';
import { Issue, IssueSeverity, IssueType, VisualDiff } from '../../types';
```

Change the ErrorCardProps interface (lines 7-9) to:

```tsx
interface ErrorCardProps {
  issue: Issue;
  visualDiff?: VisualDiff;
}
```

Destructure `visualDiff` (line 11):

```tsx
export default function ErrorCard({ issue, visualDiff }: ErrorCardProps) {
```

After the ScreenshotThumb block (around line 133), add the element diff display. For elements, show diff.png + badge only (no slider) since the baseline element path requires the baseline issue ID which is not available:

```tsx
          {visualDiff && (
            <div className="visual-diff-viewer compact">
              <div className="vd-diff-section">
                <div className="vd-diff-header">
                  <span className={`vd-diff-badge ${visualDiff.diffPercentage > visualDiff.thresholdUsed * 100 ? 'over' : 'under'}`}>
                    {visualDiff.diffPercentage > visualDiff.thresholdUsed * 100 ? '⚠️' : '✅'} {visualDiff.diffPercentage.toFixed(1)}% diferente
                  </span>
                  <span className="vd-threshold-info">Umbral: {(visualDiff.thresholdUsed * 100).toFixed(1)}%</span>
                </div>
                <div className="vd-diff-image-container">
                  <img src={`/screenshots/${visualDiff.diffImagePath}`} alt={`Diff: ${issue.description}`} />
                </div>
              </div>
            </div>
          )}
```

- [ ] **Step 3: Run type-check and lint**

```bash
npx tsc --noEmit; if ($?) { npm run lint }
```

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors across all files.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ErrorGroup/ErrorGroup.tsx frontend/src/components/ErrorCard/ErrorCard.tsx
git commit -m "feat: add element diff display to ErrorCard and visualDiffsMap to ErrorGroup"
```<｜end▁of▁thinking｜>Necesito ajustar el diseño del `VisualDiffViewer` y `ErrorCard` para simplificar los diffs por elemento (solo mostrar diff.png + badge, sin slider). Reescribo las Tasks 10 y 12.

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="read">
<｜｜DSML｜｜parameter name="filePath" string="true">C:\repositorio\SiteSentry-QA-\docs\superpowers\plans\2026-06-20-visual-regression.md