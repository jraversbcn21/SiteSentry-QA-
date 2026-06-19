# Screenshots por Issue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture full-page and element-level screenshots during scans, serve them via API, and display them in the frontend report.

**Architecture:** ScanWorker captures screenshots after checkers run — a full-page PNG and per-issue element PNGs for HIGH severity issues that include a CSS selector in metadata. Screenshots stored on filesystem under `data/screenshots/{scanId}/`, referenced via `screenshot_path` column in the issues table. A new Express route serves them. Frontend displays thumbnails with a Lightbox modal.

**Tech Stack:** Playwright (page.screenshot, elementHandle.screenshot), Express file serving, SQLite (ALTER TABLE), React (ScreenshotThumb + Lightbox components)

## Global Constraints

- Backend: CommonJS (`"module": "commonjs"` in tsconfig), Node 18, tsx runner
- `crypto.randomUUID()` is NOT available — use `import { randomUUID } from 'crypto'`
- `page.evaluate()` MUST use template strings (not arrow functions) per tsx/esbuild module-system gotcha
- Frontend: ESM (`"type": "module"`), Vite on port 5173, alias `@/` maps to `src/`
- Screenshot format: PNG, no additional compression
- Screenshot failures are non-fatal — they never fail the scan
- Use `fs.mkdirSync({ recursive: true })` for directory creation
- Proxy `/screenshots` already configured in `vite.config.ts` → `http://127.0.0.1:3001`

---

### Task 1: Database migration — add screenshot_path column

**Files:**
- Modify: `backend/src/database/db.ts` (add ALTER TABLE after CREATE TABLE IF NOT EXISTS)
- Modify: `backend/src/types/index.ts` (add `screenshot_path?` to Issue interface)

**Interfaces:**
- Consumes: existing `issues` table schema
- Produces: `Issue.screenshot_path?: string` field available for all downstream code

- [ ] **Step 1: Write failing test for the new column**

Create `backend/__tests__/screenshots-db.test.ts`:

```typescript
import { getDb } from '../src/database/db';
import { randomUUID } from 'crypto';

describe('screenshot_path column', () => {
  it('should allow storing screenshot_path on issues table', () => {
    const db = getDb();

    const scanId = randomUUID();
    db.prepare(`INSERT INTO scans (id, url, status, config, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      scanId, 'https://example.com', 'COMPLETED', '{}', new Date().toISOString()
    );

    const issueId = randomUUID();
    db.prepare(`INSERT INTO issues (id, scan_id, type, severity, url, description, screenshot_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      issueId, scanId, 'EMPTY_CONTENT', 'HIGH', 'https://example.com', 'test issue', `${scanId}/test.png`, new Date().toISOString()
    );

    const row = db.prepare('SELECT screenshot_path FROM issues WHERE id = ?').get(issueId) as any;
    expect(row.screenshot_path).toBe(`${scanId}/test.png`);

    db.prepare('DELETE FROM issues WHERE scan_id = ?').run(scanId);
    db.prepare('DELETE FROM scans WHERE id = ?').run(scanId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest __tests__/screenshots-db.test.ts --no-coverage`
Expected: FAIL — `screenshot_path` column does not exist

- [ ] **Step 3: Add ALTER TABLE in db.ts**

In `backend/src/database/db.ts`, after the `CREATE INDEX` statements inside `db.exec()`, add:

```typescript
    -- Agregar columna screenshot_path si no existe (migracion: screenshots por issue)
    ALTER TABLE issues ADD COLUMN screenshot_path TEXT;
```

Note: SQLite's `ALTER TABLE ADD COLUMN` will fail if the column already exists. Wrap it in a try/catch or use a pragmatic check. Since there's no migration framework, add the `ALTER TABLE` after the `CREATE TABLE IF NOT EXISTS` block but inside the same `db.exec()`. To handle re-runs, catch the "duplicate column" error:

In `getDb()`, after the `db.exec(...)` block, add a separate try/catch:

```typescript
  // Migracion: agregar screenshot_path a issues (Fase 1 - Screenshots)
  try {
    db.exec('ALTER TABLE issues ADD COLUMN screenshot_path TEXT');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.warn('Migration warning (screenshot_path):', e.message);
    }
  }
```

Full updated `getDb()` function in `db.ts`:

```typescript
export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'sitesentry.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      url TEXT NOT NULL,
      source_url TEXT,
      description TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
    CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at);
    CREATE INDEX IF NOT EXISTS idx_issues_scan_id ON issues(scan_id);
    CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(type);
    CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues(severity);
  `);

  // Migracion: agregar screenshot_path a issues (Fase 1 - Screenshots)
  try {
    db.exec('ALTER TABLE issues ADD COLUMN screenshot_path TEXT');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.warn('Migration warning (screenshot_path):', e.message);
    }
  }

  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest __tests__/screenshots-db.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Add screenshot_path to Issue interface**

In `backend/src/types/index.ts`, add the optional field to the `Issue` interface:

```typescript
export interface Issue {
  type: IssueType;
  severity: IssueSeverity;
  url: string;
  sourceUrl?: string;
  description: string;
  metadata?: Record<string, unknown>;
  screenshot_path?: string;
}
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/database/db.ts backend/src/types/index.ts backend/__tests__/screenshots-db.test.ts
git commit -m "feat: add screenshot_path column to issues table and Issue type"
```

---

### Task 2: Add CSS selectors to checker metadata for HIGH issues

**Files:**
- Modify: `backend/src/checkers/ContentChecker.ts`
- Modify: `backend/src/checkers/LazyLoadChecker.ts`
- Modify: `backend/src/checkers/BrokenResourcesChecker.ts`

**Interfaces:**
- Consumes: `Issue` interface (from Task 1)
- Produces: Issues with `metadata.selector` field for HIGH severity ones — consumed by Task 3 (ScanWorker)

- [ ] **Step 1: Update ContentChecker — add selector to empty containers**

In `backend/src/checkers/ContentChecker.ts`, inside the empty containers loop (~line 43), add the actual element selector. The `page.evaluate()` already captures `selector` (the query selector string) but for unique identification, build a more precise selector from the captured id/className:

Change the metadata for empty container issues from:
```typescript
        metadata: { tag: container.tag, className: container.className, id: container.id, height: container.height },
```
to:
```typescript
        metadata: { tag: container.tag, className: container.className, id: container.id, height: container.height, selector: container.selector },
```

For the error states (~line 79), it already has `selector` in metadata — no change needed.

For the near-empty main container (~line 106), build a selector from the captured tag/id:
```typescript
        metadata: { tag: hiddenWithContent.tag, id: hiddenWithContent.id, className: hiddenWithContent.className, selector: hiddenWithContent.tag || 'main' },
```

Also update the `page.evaluate()` for `hiddenWithContent` to include a `selector` field:
Change the return in `hiddenWithContent` evaluate (~line 89):
```typescript
          return {
            mainHasContent: false,
            tag: containers[i].tagName.toLowerCase(),
            id: containers[i].id || '',
            className: (containers[i].className && typeof containers[i].className === 'string') ? containers[i].className.substring(0, 40) : '',
            selector: containers[i].id ? '#' + containers[i].id : containers[i].tagName.toLowerCase()
          };
```

Full updated `ContentChecker.ts` — the `check` method with changes:

```typescript
  async check(url: string, page: Page, _networkEvents: NetworkEvent[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    const emptyContainers: Array<{ selector: string; tag: string; className: string; id: string; height: number }> = await page.evaluate(`(() => {
      var selectors = ['main','[role="main"]','.products','.product-list','.product-grid','.items','.results','.content','.listing','.grid','.cards','.feed','[data-testid]','ul.list','ol.list','section > div'];
      var results = [];
      for (var s = 0; s < selectors.length; s++) {
        var elements = document.querySelectorAll(selectors[s]);
        for (var i = 0; i < elements.length; i++) {
          var el = elements[i];
          var rect = el.getBoundingClientRect();
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          var childCount = el.children.length;
          var textLength = (el.textContent || '').trim().length;
          if (rect.height > 50 && rect.width > 100 && childCount === 0 && textLength === 0) {
            results.push({
              selector: selectors[s],
              tag: el.tagName.toLowerCase(),
              className: (el.className && typeof el.className === 'string') ? el.className.substring(0, 60) : '',
              id: el.id || '',
              height: Math.round(rect.height)
            });
          }
        }
      }
      return results.slice(0, 15);
    })()`);

    for (const container of emptyContainers) {
      const identifier = container.id
        ? `#${container.id}`
        : container.className
          ? `.${container.className.split(' ')[0]}`
          : `<${container.tag}>`;
      issues.push({
        type: IssueType.EMPTY_CONTENT,
        severity: IssueSeverity.HIGH,
        url,
        description: `Contenedor vacio que deberia tener contenido: ${identifier} (${container.height}px de alto)`,
        metadata: { tag: container.tag, className: container.className, id: container.id, height: container.height, selector: container.selector },
      });
    }

    const errorStates: Array<{ text: string; selector: string }> = await page.evaluate(`(() => {
      var errorSelectors = ['.error','.error-message','[class*="error"]','[class*="Error"]','.alert-danger','.alert-error','[role="alert"]','.no-results','.empty-state','.not-found'];
      var results = [];
      for (var s = 0; s < errorSelectors.length; s++) {
        try {
          var elements = document.querySelectorAll(errorSelectors[s]);
          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var style = window.getComputedStyle(el);
            var rect = el.getBoundingClientRect();
            var isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0 && rect.height > 0;
            if (isVisible) {
              var text = (el.textContent || '').trim().substring(0, 100);
              if (text.length > 0) results.push({ text: text, selector: errorSelectors[s] });
            }
          }
        } catch(e) {}
      }
      return results.slice(0, 10);
    })()`);

    for (const error of errorStates) {
      issues.push({
        type: IssueType.EMPTY_CONTENT,
        severity: IssueSeverity.HIGH,
        url,
        description: `Mensaje de error visible en pagina: "${error.text}"`,
        metadata: { selector: error.selector, text: error.text },
      });
    }

    const hiddenWithContent: { mainHasContent: boolean; tag?: string; id?: string; className?: string; selector?: string } = await page.evaluate(`(() => {
      var containers = document.querySelectorAll('main, [role="main"], .content, #content, #app, #root');
      if (containers.length === 0) return { mainHasContent: true };
      for (var i = 0; i < containers.length; i++) {
        var text = (containers[i].textContent || '').trim();
        if (text.length < 10) {
          return {
            mainHasContent: false,
            tag: containers[i].tagName.toLowerCase(),
            id: containers[i].id || '',
            className: (containers[i].className && typeof containers[i].className === 'string') ? containers[i].className.substring(0, 40) : '',
            selector: containers[i].id ? '#' + containers[i].id : containers[i].tagName.toLowerCase()
          };
        }
      }
      return { mainHasContent: true };
    })()`);

    if (!hiddenWithContent.mainHasContent && hiddenWithContent.tag) {
      issues.push({
        type: IssueType.EMPTY_CONTENT,
        severity: IssueSeverity.HIGH,
        url,
        description: `Contenedor principal practicamente vacio: <${hiddenWithContent.tag}> (posible fallo de renderizado)`,
        metadata: { tag: hiddenWithContent.tag, id: hiddenWithContent.id, className: hiddenWithContent.className, selector: hiddenWithContent.selector || hiddenWithContent.tag },
      });
    }

    return issues;
  }
```

- [ ] **Step 2: Update LazyLoadChecker — selector already present for spinners, add for lazy images**

In `backend/src/checkers/LazyLoadChecker.ts`:

The stuck spinners issues (~line 64) already include `selector` in metadata — no change needed.

For lazy images (~line 31), add a `selector` field: since these are images found via `img[loading="lazy"], img[data-src], img[data-lazy]`, use an attribute selector:

Change the metadata for lazy images from:
```typescript
        metadata: { src: img.src, dataSrc: img.dataSrc, width: img.width, height: img.height },
```
to:
```typescript
        metadata: { src: img.src, dataSrc: img.dataSrc, width: img.width, height: img.height, selector: img.src ? 'img[src="' + img.src.replace(/"/g, '\\"') + '"]' : 'img[loading="lazy"]' },
```

For placeholder images (~line 88), add a similar selector:
Change from:
```typescript
        metadata: { src: img.src, naturalWidth: img.naturalWidth, displayWidth: img.displayWidth },
```
to:
```typescript
        metadata: { src: img.src, naturalWidth: img.naturalWidth, displayWidth: img.displayWidth, selector: 'img[src="' + img.src.replace(/"/g, '\\"') + '"]' },
```

- [ ] **Step 3: Update BrokenResourcesChecker — add selector for DOM-detected broken images**

In `backend/src/checkers/BrokenResourcesChecker.ts`:

For network resource issues (FAILED_API, image not loading from network), no element selector is relevant — these are network-level issues.

For DOM-detected broken images (~line 54), add a `selector`:
Change metadata from:
```typescript
        metadata: {
          resourceType: 'image',
          alt: img.alt,
          width: img.width,
          height: img.height,
          statusCode: imgEvent?.status ?? null,
          timing: imgEvent?.timing,
          mimeType: imgEvent?.mimeType || undefined,
          size: imgEvent?.size || undefined,
        },
```
to:
```typescript
        metadata: {
          resourceType: 'image',
          alt: img.alt,
          width: img.width,
          height: img.height,
          selector: 'img[src="' + img.src.replace(/"/g, '\\"') + '"]',
          statusCode: imgEvent?.status ?? null,
          timing: imgEvent?.timing,
          mimeType: imgEvent?.mimeType || undefined,
          size: imgEvent?.size || undefined,
        },
```

For background-image issues (~line 94), no element selector — CSS background-images are not directly selectable via DOM element query.

- [ ] **Step 4: Commit**

```bash
git add backend/src/checkers/ContentChecker.ts backend/src/checkers/LazyLoadChecker.ts backend/src/checkers/BrokenResourcesChecker.ts
git commit -m "feat: add CSS selectors to checker metadata for HIGH severity issues"
```

---

### Task 3: ScanWorker screenshot capture

**Files:**
- Modify: `backend/src/workers/ScanWorker.ts`

**Interfaces:**
- Consumes: `Issue` with `screenshot_path?` and `metadata.selector` (from Tasks 1-2), Playwright `Browser` and `Page`
- Produces: Screenshots written to `data/screenshots/{scanId}/`, `issue.screenshot_path` assigned

- [ ] **Step 1: Write failing test for screenshot capture**

Create `backend/__tests__/screenshots-capture.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';

describe('screenshot directory creation', () => {
  const testDir = path.join(process.cwd(), 'data', 'screenshots', '__test__');

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should create nested screenshot directories', () => {
    const nestedPath = path.join(testDir, 'nested', 'deep');
    fs.mkdirSync(nestedPath, { recursive: true });
    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it('should not fail when directory already exists', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true }); // should not throw
    expect(fs.existsSync(testDir)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (infrastructure test)**

Run: `cd backend && npx jest __tests__/screenshots-capture.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Implement screenshot capture in ScanWorker**

In `backend/src/workers/ScanWorker.ts`, add imports at the top:

```typescript
import path from 'path';
import fs from 'fs';
```

Add two helper functions after the `processScanJob` function (or before it). Add the screenshot directory path constant:

Inside `processScanJob`, after the console errors loop (~line 81, after `allIssues.push(...)` for console errors) and before `await analyzer.close(analysis.page)` (~line 83), add:

```typescript
    // --- Screenshot capture ---
    const screenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
    fs.mkdirSync(screenshotDir, { recursive: true });

    // Full-page screenshot
    try {
      const fullPath = path.join(screenshotDir, 'full.png');
      await analysis.page.screenshot({ path: fullPath, fullPage: true, type: 'png' });
      console.log(`[ScanWorker] Full-page screenshot capturado: ${fullPath}`);
    } catch (err) {
      console.warn(`[ScanWorker] No se pudo capturar full-page screenshot:`, err);
    }

    // Element screenshots for HIGH severity issues with selectors
    for (const issue of allIssues) {
      if (issue.severity !== 'HIGH') continue;
      const selector = issue.metadata?.selector as string | undefined;
      if (!selector) continue;

      try {
        const el = analysis.page.locator(selector).first();
        const filePath = path.join(screenshotDir, `${issue.id || randomUUID()}.png`);
        await el.screenshot({ path: filePath, type: 'png' });
        issue.screenshot_path = `${scanId}/${path.basename(filePath)}`;
      } catch (err) {
        // Element not found or not visible — omit this screenshot
      }
    }
```

Wait — the issues haven't been assigned IDs yet at this point (IDs are generated in the `insertIssue` loop). We need to assign IDs before screenshot capture. Update the flow:

Change: assign a temporary `id` to each issue before the screenshot loop, then use system-assigned IDs in the insert. Actually, the `insertIssue` uses `randomUUID()` per issue. Let's assign the `id` field on each issue object before the screenshot capture and before the DB insert.

Add this right after the console errors loop completes (after line 81):

```typescript
    // Assign IDs to issues before screenshot capture
    for (const issue of allIssues) {
      (issue as any).id = randomUUID();
    }

    // --- Screenshot capture ---
    const screenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
    fs.mkdirSync(screenshotDir, { recursive: true });

    try {
      const fullPath = path.join(screenshotDir, 'full.png');
      await analysis.page.screenshot({ path: fullPath, fullPage: true, type: 'png' });
      console.log(`[ScanWorker] Full-page screenshot capturado`);
    } catch (err) {
      console.warn(`[ScanWorker] No se pudo capturar full-page screenshot:`, err);
    }

    for (const issue of allIssues) {
      if (issue.severity !== 'HIGH') continue;
      const selector = issue.metadata?.selector as string | undefined;
      if (!selector) continue;

      try {
        const el = analysis.page.locator(selector).first();
        const fileName = `${(issue as any).id}.png`;
        const filePath = path.join(screenshotDir, fileName);
        await el.screenshot({ path: filePath, type: 'png' });
        issue.screenshot_path = `${scanId}/${fileName}`;
      } catch {
        // elemento no encontrado — se omite el screenshot
      }
    }
```

Also update the `insertIssue` call (~line 95) to use the pre-assigned `id` instead of generating a new one. Change `randomUUID()` in the insert to `(issue as any).id`:

The insert loop changes from:
```typescript
          insertIssue.run(
            randomUUID(),
            ...
```
to:
```typescript
          insertIssue.run(
            (issue as any).id,
```

And add `screenshot_path` to the INSERT statement. Change the INSERT SQL from:
```typescript
      const insertIssue = db.prepare(`
        INSERT OR IGNORE INTO issues (id, scan_id, type, severity, url, source_url, description, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
```
to:
```typescript
      const insertIssue = db.prepare(`
        INSERT OR IGNORE INTO issues (id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
```

And update the insert call:
```typescript
        insertIssue.run(
          (issue as any).id,
          scanId,
          issue.type,
          issue.severity,
          issue.url,
          issue.sourceUrl || null,
          issue.description,
          issue.metadata ? JSON.stringify(issue.metadata) : null,
          issue.screenshot_path || null,
          new Date().toISOString()
        );
```

Also update the anti-bot block insert (~line 131) to include `screenshot_path`:
```typescript
      db.prepare(`
        INSERT INTO issues (id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        scanId,
        IssueType.FAILED_API,
        IssueSeverity.HIGH,
        url,
        url,
        `Acceso bloqueado: ...`,
        JSON.stringify({...}),
        null,  // no screenshot for anti-bot blocks
        new Date().toISOString()
      );
```

Full updated `ScanWorker.ts` (key sections only — see complete file in project):

```typescript
import { randomUUID } from 'crypto';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { getDb } from '../database/db';
import { ScanStatus, IssueType, IssueSeverity } from '../types';
import { PageAnalyzer } from '../analyzer/PageAnalyzer';
import { checkers } from '../checkers';

// ... (processScanJob function) ...

    // Asignar IDs a issues antes de screenshots
    for (const issue of allIssues) {
      (issue as any).id = randomUUID();
    }

    // --- Screenshot capture ---
    const screenshotDir = path.join(process.cwd(), 'data', 'screenshots', scanId);
    fs.mkdirSync(screenshotDir, { recursive: true });

    try {
      const fullPath = path.join(screenshotDir, 'full.png');
      await analysis.page.screenshot({ path: fullPath, fullPage: true, type: 'png' });
      console.log('[ScanWorker] Full-page screenshot capturado');
    } catch (err) {
      console.warn('[ScanWorker] No se pudo capturar full-page screenshot:', err);
    }

    for (const issue of allIssues) {
      if (issue.severity !== 'HIGH') continue;
      const selector = issue.metadata?.selector as string | undefined;
      if (!selector) continue;

      try {
        const el = analysis.page.locator(selector).first();
        const fileName = `${(issue as any).id}.png`;
        const filePath = path.join(screenshotDir, fileName);
        await el.screenshot({ path: filePath, type: 'png' });
        issue.screenshot_path = `${scanId}/${fileName}`;
      } catch {
        // elemento no encontrado — se omite el screenshot
      }
    }
```

And the updated insert:

```typescript
    if (allIssues.length > 0) {
      const insertIssue = db.prepare(`
        INSERT OR IGNORE INTO issues (id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((issues: import('../types').Issue[]) => {
        for (const issue of issues) {
          insertIssue.run(
            (issue as any).id,
            scanId,
            issue.type,
            issue.severity,
            issue.url,
            issue.sourceUrl || null,
            issue.description,
            issue.metadata ? JSON.stringify(issue.metadata) : null,
            issue.screenshot_path || null,
            new Date().toISOString()
          );
        }
      });

      insertMany(allIssues);
    }
```

- [ ] **Step 4: Run test to verify**

Run: `cd backend && npx jest __tests__/screenshots-capture.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/ScanWorker.ts backend/__tests__/screenshots-capture.test.ts
git commit -m "feat: capture full-page and element screenshots in ScanWorker"
```

---

### Task 4: API routes — serve screenshots + update report response

**Files:**
- Modify: `backend/src/api/server.ts` (add GET /screenshots route)
- Modify: `backend/src/api/routes/reports.ts` (include screenshot_path and fullPageScreenshot in response)

**Interfaces:**
- Consumes: Screenshots on filesystem at `data/screenshots/{scanId}/`, `screenshot_path` column in DB
- Produces: `GET /screenshots/:scanId/:filename` serving PNG files, `GET /api/reports/:id` including `screenshot_path` per issue and `fullPageScreenshot` at top level

- [ ] **Step 1: Add screenshot serving route in server.ts**

In `backend/src/api/server.ts`, add import for `path` and `fs`:

```typescript
import path from 'path';
import fs from 'fs';
```

Add the route before the 404 handler (~line 44):

```typescript
// Screenshots serving
app.get('/screenshots/:scanId/:filename', (req, res) => {
  const { scanId, filename } = req.params;
  const filePath = path.join(process.cwd(), 'data', 'screenshots', scanId, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Screenshot not found' });
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading screenshot' });
    }
  });
});
```

- [ ] **Step 2: Update reports route to include screenshot_path and fullPageScreenshot**

In `backend/src/api/routes/reports.ts`, update the `parsedIssues` mapping (~line 70) to include `screenshot_path`:

Change from:
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
      createdAt: i.created_at,
    }));
```

to:
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
      screenshot_path: (i as any).screenshot_path || null,
      createdAt: i.created_at,
    }));
```

Add `fullPageScreenshot` to the response object (~line 90). Add `fs` and `path` imports at top:

```typescript
import path from 'path';
import fs from 'fs';
```

Then in the response JSON:
```typescript
    const fullPagePath = path.join(process.cwd(), 'data', 'screenshots', scan.id, 'full.png');
    const fullPageScreenshot = fs.existsSync(fullPagePath) ? `${scan.id}/full.png` : null;

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

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/server.ts backend/src/api/routes/reports.ts
git commit -m "feat: add screenshot serving route and update report API response"
```

---

### Task 5: Frontend types — add screenshot fields

**Files:**
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Consumes: API response from `GET /api/reports/:id`
- Produces: Updated `Issue` and `ReportResponse` types consumed by ErrorCard and ReportViewer in Task 6

- [ ] **Step 1: Update Issue and ReportResponse interfaces**

In `frontend/src/types/index.ts`, add to the `Issue` interface:

```typescript
export interface Issue {
  type: IssueType;
  severity: IssueSeverity;
  url: string;
  sourceUrl?: string;
  description: string;
  metadata?: Record<string, unknown>;
  screenshot_path?: string | null;
}
```

Add to `ReportResponse`:

```typescript
export interface ReportResponse {
  id: string;
  url: string;
  status: ScanStatus;
  createdAt: string;
  completedAt?: string;
  issues: Issue[];
  fullPageScreenshot?: string | null;
  summary: {
    total: number;
    byType: Record<IssueType, number>;
    bySeverity: Record<IssueSeverity, number>;
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: add screenshot_path and fullPageScreenshot to frontend types"
```

---

### Task 6: New components — ScreenshotThumb and Lightbox

**Files:**
- Create: `frontend/src/components/ScreenshotThumb/ScreenshotThumb.tsx`
- Create: `frontend/src/components/ScreenshotThumb/ScreenshotThumb.css`
- Create: `frontend/src/components/Lightbox/Lightbox.tsx`
- Create: `frontend/src/components/Lightbox/Lightbox.css`

**Interfaces:**
- Consumes: `screenshot_path` from `Issue`, `fullPageScreenshot` from `ReportResponse`
- Produces: `<ScreenshotThumb>` and `<Lightbox>` components — consumed by ErrorCard and ReportViewer in Task 7

- [ ] **Step 1: Create Lightbox component**

Create `frontend/src/components/Lightbox/Lightbox.tsx`:

```typescript
import { useEffect, useCallback } from 'react';
import './Lightbox.css';

interface LightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export default function Lightbox({ src, alt, onClose }: LightboxProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-container" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
        <img src={src} alt={alt} className="lightbox-image" />
      </div>
    </div>
  );
}
```

Create `frontend/src/components/Lightbox/Lightbox.css`:

```css
.lightbox-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 20px;
  overflow-y: auto;
}

.lightbox-container {
  position: relative;
  max-width: 95vw;
}

.lightbox-close {
  position: fixed;
  top: 16px;
  right: 20px;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: white;
  font-size: 1.4rem;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  transition: background 0.15s;
}

.lightbox-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

.lightbox-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 2: Create ScreenshotThumb component**

Create `frontend/src/components/ScreenshotThumb/ScreenshotThumb.tsx`:

```typescript
import { useState } from 'react';
import Lightbox from '../Lightbox/Lightbox';
import './ScreenshotThumb.css';

interface ScreenshotThumbProps {
  path: string;
  alt: string;
  maxHeight?: number;
}

export default function ScreenshotThumb({ path, alt, maxHeight = 200 }: ScreenshotThumbProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const src = `/screenshots/${path}`;

  if (error) {
    return (
      <div className="screenshot-thumb-error">
        No se pudo cargar el screenshot
      </div>
    );
  }

  return (
    <>
      <div className="screenshot-thumb" style={{ maxHeight }} onClick={() => setLightboxOpen(true)}>
        {!loaded && <div className="screenshot-thumb-placeholder">Cargando screenshot...</div>}
        <img
          src={src}
          alt={alt}
          className={`screenshot-thumb-img ${loaded ? 'loaded' : ''}`}
          style={{ maxHeight }}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      </div>
      {lightboxOpen && (
        <Lightbox
          src={src}
          alt={alt}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
```

Create `frontend/src/components/ScreenshotThumb/ScreenshotThumb.css`:

```css
.screenshot-thumb {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  background: #f8fafc;
  transition: border-color 0.15s;
}

.screenshot-thumb:hover {
  border-color: #94a3b8;
}

.screenshot-thumb-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  color: #94a3b8;
}

.screenshot-thumb-img {
  width: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transition: opacity 0.2s;
}

.screenshot-thumb-img.loaded {
  opacity: 1;
}

.screenshot-thumb-error {
  padding: 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 0.72rem;
  color: #991b1b;
  text-align: center;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Lightbox/Lightbox.tsx frontend/src/components/Lightbox/Lightbox.css frontend/src/components/ScreenshotThumb/ScreenshotThumb.tsx frontend/src/components/ScreenshotThumb/ScreenshotThumb.css
git commit -m "feat: add ScreenshotThumb and Lightbox components"
```

---

### Task 7: Integrate screenshots into existing components

**Files:**
- Modify: `frontend/src/components/ErrorCard/ErrorCard.tsx`
- Modify: `frontend/src/components/ReportViewer/ReportViewer.tsx`

**Interfaces:**
- Consumes: `<ScreenshotThumb>` from Task 6, updated `Issue` and `ReportResponse` types from Task 5
- Produces: Screenshots visible in ErrorCard dropdown and ReportViewer header

- [ ] **Step 1: Add screenshot to ErrorCard**

In `frontend/src/components/ErrorCard/ErrorCard.tsx`, add the import at the top:

```typescript
import ScreenshotThumb from '@/components/ScreenshotThumb/ScreenshotThumb';
```

Inside the `<details className="error-card-metadata">` block, after the metadata table div and before the `.metadata-actions` div, add:

```typescript
          {issue.screenshot_path && (
            <ScreenshotThumb
              path={issue.screenshot_path}
              alt={issue.description}
            />
          )}
```

The updated JSX block around the metadata section (~line 116-155):

```typescript
      {issue.metadata && Object.keys(issue.metadata).length > 0 && (
        <details className="error-card-metadata">
          <summary>Detalles tecnicos</summary>
          <div className="metadata-table">
            {Object.entries(issue.metadata).map(([key, value]) => (
              <div className="metadata-row" key={key}>
                <span className="metadata-key">{formatMetadataKey(key)}</span>
                <span className="metadata-value">{formatMetadataValue(key, value)}</span>
              </div>
            ))}
          </div>
          {issue.screenshot_path && (
            <ScreenshotThumb
              path={issue.screenshot_path}
              alt={issue.description}
            />
          )}
          <div className="metadata-actions">
            ...
          </div>
          ...
        </details>
      )}
```

- [ ] **Step 2: Add full-page screenshot to ReportViewer**

In `frontend/src/components/ReportViewer/ReportViewer.tsx`, add the import:

```typescript
import ScreenshotThumb from '@/components/ScreenshotThumb/ScreenshotThumb';
```

After the `summary-cards` div (~line 187) and before the `type-breakdown` div (~line 189), add:

```typescript
      {report.fullPageScreenshot && (
        <div className="report-screenshot">
          <ScreenshotThumb
            path={report.fullPageScreenshot}
            alt={`Screenshot completo de ${report.url}`}
            maxHeight={300}
          />
          <span className="report-screenshot-label">Screenshot completo de la pagina</span>
        </div>
      )}
```

Add the corresponding CSS to `ReportViewer.css`:

```css
.report-screenshot {
  margin-bottom: 16px;
}

.report-screenshot-label {
  display: block;
  text-align: center;
  font-size: 0.72rem;
  color: #94a3b8;
  margin-top: 4px;
}
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ErrorCard/ErrorCard.tsx frontend/src/components/ReportViewer/ReportViewer.tsx frontend/src/components/ReportViewer/ReportViewer.css
git commit -m "feat: integrate screenshots into ErrorCard and ReportViewer"
```

---

### Task 8: Update metadata key labels for new fields

**Files:**
- Modify: `frontend/src/components/ErrorCard/ErrorCard.tsx` (metadataKeyLabels map)

- [ ] **Step 1: Add screenshot_path to metadata labels map**

The `metadataKeyLabels` map in `ErrorCard.tsx` already has `selector: 'Selector CSS'`. No other new metadata keys need labels since `screenshot_path` is rendered via `<ScreenshotThumb>`, not in the metadata table.

However, the `selector` field is now shown in the metadata table for issues that have it. The label already exists. But for the `formatMetadataValue` function, `selector` values are strings and will be displayed with `String(value)` by default — that's correct.

No changes needed in this step beyond verifying the existing `selector` label is present (it is, at line 161).

- [ ] **Step 2: Verify the frontend dev server works**

Run `cd frontend && npm run dev` and check that the app loads without errors (or just verify the build from Task 7 Step 3 already passed).

- [ ] **Step 3: Commit (only if there were changes)**

If no changes needed, skip this commit.

---

## Verification

After all tasks are complete, run a full scan and verify:

1. `POST /api/scan` with a known URL
2. Check `data/screenshots/{scanId}/full.png` exists on disk
3. Check `GET /api/reports/{scanId}` returns `fullPageScreenshot` and issues with `screenshot_path`
4. Check `GET /screenshots/{scanId}/full.png` returns a PNG image
5. Open the frontend report — full-page screenshot visible, element screenshots visible inside ErrorCard dropdowns for HIGH issues
