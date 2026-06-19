# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SiteSentry QA is a single-page functional web analyzer. Given one URL, it opens that page in a headless browser, intercepts network traffic, scrolls through the page, and runs 9 checkers to detect functional and quality problems. It does NOT crawl or follow links.

## Commands

### Backend (from `backend/`)
- `npm run dev` — Start API server with tsx watch (hot reload, port 3001)
- `npm run dev:worker` — Start BullMQ worker with tsx watch
- `npm run build` — TypeScript compile (`tsc`)
- `npx tsc --noEmit` — Type-check without emitting
- `npx jest --no-coverage` — Run test suite

### Frontend (from `frontend/`)
- `npm run dev` — Start Vite dev server (port 5173)
- `npm run build` — Type-check + Vite production build
- `npm run lint` — ESLint

### Running the app requires 3 terminals
1. `cd backend && npm run dev` (API on port 3001)
2. `cd backend && npm run dev:worker` (BullMQ worker, requires Redis)
3. `cd frontend && npm run dev` (Vite on port 5173)

## Architecture

### Flow
`POST /api/scan` → SQLite creates Scan row → BullMQ job queued → Worker picks up job → Playwright opens page → PageAnalyzer intercepts network + scrolls → 9 Checkers run → Issues + screenshots saved → Frontend polls `/api/scan/:id/status` until COMPLETED → Fetches `/api/reports/:id`

### Backend Key Files
- **`src/analyzer/PageAnalyzer.ts`** — Core engine. Creates a BrowserContext with a realistic fingerprint (userAgent, locale, Sec-CH-UA headers), intercepts all network requests/responses/failures, captures console errors, performs full-page scroll. Returns `PageAnalysis` with `page`, `NetworkEvent[]`, `ConsoleEvent[]`, `loadTime`, `scrollHeight`.
- **`src/checkers/`** — 9 checkers, each implements `IChecker.check(url, page, networkEvents, consoleErrors?)`. See checkers section below.
- **`src/workers/ScanWorker.ts`** — Orchestrates the full pipeline: launch browser → analyze → run checkers (passing `analysis.consoleErrors` as 4th arg) → capture screenshots (Phase 1) → save issues. Anti-bot blocks saved as `FAILED_API/HIGH` issue instead of failing.
- **`src/api/routes/scan.ts`** — POST scan, GET status.
- **`src/api/routes/reports.ts`** — GET report (includes `fullPageScreenshot` + `screenshot_path` per issue), GET all reports list.
- **`src/api/server.ts`** — Express app. Routes: `/api/scan`, `/api/reports`, `/screenshots/:scanId/:filename` (serves PNG files with path traversal protection).
- **`src/types/index.ts`** — Shared enums (`IssueType`, `IssueSeverity`, `ScanStatus`), `Issue` interface (includes `screenshot_path?: string`), and `IChecker` interface.
- **`src/database/db.ts`** — SQLite schema via `better-sqlite3`. Tables: `scans`, `issues` (with `screenshot_path` column added in Phase 1 migration).

### Screenshots (Phase 1 — Complete)

After checkers run and before closing the page, ScanWorker captures:
- **Full-page screenshot** → `data/screenshots/{scanId}/full.png`
- **Element screenshots** → `data/screenshots/{scanId}/{issueId}.png` for HIGH severity issues with a CSS `selector` in metadata

Screenshots served via `GET /screenshots/:scanId/:filename` (with UUID validation and path traversal protection). Frontend displays them via `ScreenshotThumb` + `Lightbox` components in ErrorCard dropdowns and ReportViewer header.

The `Issue` interface has `screenshot_path?: string` (relative path or null). The `ReportResponse` has `fullPageScreenshot?: string | null`. Checkers provide a `selector` CSS string in metadata for HIGH issues so ScanWorker can locate and screenshot the element.

### Checkers (9 total)
| Checker | IssueType | Detecta |
|---|---|---|
| BrokenResourcesChecker | `BROKEN_RESOURCE` | Imagenes/CSS/scripts/fonts rotos (network + DOM) |
| FailedAPIChecker | `FAILED_API` | XHR/fetch con error, APIs lentas >10s, CORS |
| InteractivityChecker | `INTERACTIVITY` | Links sin href, placeholders `#`, botones sin `disabled` |
| ContentChecker | `EMPTY_CONTENT` | Contenedores vacios, mensajes de error visibles |
| LazyLoadChecker | `LAZY_LOAD` | Imagenes lazy no cargadas, spinners atascados |
| FormModalChecker | `FORM_MODAL` | Forms sin submit/action, modales sin cierre, banners cookie |
| ConsoleErrorChecker | `CONSOLE_ERROR` | JS errors, CORS errors (usa 4o param `consoleErrors`) |
| PerformanceChecker | `PERFORMANCE` | TTFB, DOMContentLoaded, full load, DOM nodes, resource count |
| AccessibilityChecker | `ACCESSIBILITY` | Violations WCAG 2.0A/AA/2.1A/AA via `@axe-core/playwright` |

### Frontend Key Files
- **`src/pages/Home.tsx`** — URL input + scan progress polling.
- **`src/pages/Report.tsx`** — Fetches and displays report.
- **`src/components/ReportViewer/ReportViewer.tsx`** — Score, filters, grouping by type, JSON/CSV export, full-page screenshot display. Contains `getTypeLabel()` and `getTypeIcon()`.
- **`src/components/ErrorGroup/ErrorGroup.tsx`** — Group header per IssueType. Contains `typeConfig` with label, icon and color per type. **Must be updated when adding new IssueType.**
- **`src/components/ErrorCard/ErrorCard.tsx`** — Individual issue card with formatted metadata, element screenshot display, copy-to-clipboard and AI explain buttons.
- **`src/components/ScreenshotThumb/ScreenshotThumb.tsx`** — Lazy-loaded thumbnail with loading/error states. Click opens Lightbox.
- **`src/components/Lightbox/Lightbox.tsx`** — Full-screen image modal with ESC/click-to-close, body scroll lock.
- **`src/components/Settings/Settings.tsx`** — LLM configuration (Groq API key, model selection).
- **`src/services/api.ts`** — Axios client hitting backend on port 3001.
- **`src/services/ai.ts`** — Groq LLM integration for explaining issues.
- **`src/types/index.ts`** — Frontend mirrors of backend enums/interfaces. Issue includes `screenshot_path?: string | null`. ReportResponse includes `fullPageScreenshot?: string | null`.

## Adding a New Checker

1. Add new value to `IssueType` enum in:
   - `backend/src/types/index.ts`
   - `frontend/src/types/index.ts`
2. Create `backend/src/checkers/MyChecker.ts` implementing `IChecker`
3. Export and register in `backend/src/checkers/index.ts`
4. Add label + icon to `getTypeIcon()`/`getTypeLabel()` in `ReportViewer.tsx`
5. Add entry to `typeConfig` in `ErrorGroup.tsx`

## Critical: page.evaluate and tsx/esbuild

All `page.evaluate()` calls **must** use template string format:
```typescript
await page.evaluate(`(() => { ... })()`)
```
Never use arrow function callbacks. The tsx runner (esbuild) injects a `__name` helper that causes `ReferenceError: __name is not defined` in the browser context. Use `var`, `function`, and `for` loops inside evaluate strings — no `const`/`let`/arrow functions.

## Database

SQLite via `better-sqlite3`. The database file is at `backend/data/sitesentry.db` (configurable via `DB_PATH` env var). Schema is auto-created in `db.ts` with `CREATE TABLE IF NOT EXISTS`. Migrations are run inline as `ALTER TABLE` statements with try/catch for idempotency.

Tables:
- `scans` — id, url, status, config, created_at, completed_at
- `issues` — id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, created_at

## Anti-Bot Handling

Browser launches with `--disable-http2` (force HTTP/1.1). PageAnalyzer uses a realistic Chrome fingerprint: userAgent, locale `es-ES`, timezone `Europe/Madrid`, `Sec-CH-UA`/`Accept-Language` headers. If blocked, ScanWorker saves a `FAILED_API/HIGH` issue with `metadata.errorType: 'ANTI_BOT_BLOCK'` and marks scan COMPLETED.

## Report Export

ReportViewer has JSON and CSV download buttons. JSON exports full report with Spanish labels. CSV includes BOM for Excel compatibility with dynamic metadata columns. Files named `reporte_qa_{hostname}_{date}.{ext}`.

## UI Language

All user-facing text is in **Spanish**. Issue descriptions, checker output, and frontend copy are all in Spanish.

## Roadmap — Remaining Phases

### Phase 2: Visual Regression (pending)
Compare screenshots between scans of the same URL using `pixelmatch`. Store baseline screenshots per URL. Highlight visual diffs in the report. Configurable diff threshold.

### Phase 3: Interactive Flows (pending)
Import Playwright `codegen` scripts to define multi-step user flows (login, search, add to cart). Replay flows in the scanner, run checkers at each step, capture screenshots per step. Reuses screenshot + diff infrastructure from Phases 1 and 2.
