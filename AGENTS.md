# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

SiteSentry QA is a single-page functional web analyzer. Given one URL, it opens that page in a headless browser, intercepts network traffic, scrolls through the page, and runs 9 checkers to detect functional and quality problems. It does NOT crawl or follow links.

## Commands

### Backend (`backend/`)
| Command | Description |
|---------|-------------|
| `npm run dev` | Start API server with tsx watch (port 3001) |
| `npm run dev:worker` | Start BullMQ worker with tsx watch (requires Redis) |
| `npm run build` | TypeScript compile (`tsc`) |
| `npx tsc --noEmit` | Type-check without emitting |
| `npx jest --no-coverage` | Run test suite |

### Frontend (`frontend/`)
| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | Type-check + Vite production build |
| `npm run lint` | ESLint |

### Running the app (3 terminals)
1. `cd backend && npm run dev` (API on port 3001)
2. `cd backend && npm run dev:worker` (BullMQ worker, requires Redis)
3. `cd frontend && npm run dev` (Vite on port 5173)

## Architecture

```
POST /api/scan
  → SQLite creates Scan row
  → BullMQ job queued
  → Worker picks up job
  → Playwright opens page
  → PageAnalyzer intercepts network + scrolls
  → 9 Checkers run
  → Issues + screenshots saved
  → Frontend polls /api/scan/:id/status
  → Fetches /api/reports/:id
```

### Backend Files
| File | Purpose |
|------|---------|
| `src/analyzer/PageAnalyzer.ts` | Core engine: browser context, network interception, console capture, full-page scroll |
| `src/checkers/` | 9 checkers implementing `IChecker.check(url, page, networkEvents, consoleErrors?)` |
| `src/workers/ScanWorker.ts` | Orchestrates scan: browser → analyze → checkers → screenshots → persist |
| `src/api/routes/scan.ts` | POST scan, GET status |
| `src/api/routes/reports.ts` | GET report with issues + screenshots, GET reports list |
| `src/api/server.ts` | Express app: `/api/scan`, `/api/reports`, `/screenshots/:scanId/:filename` |
| `src/types/index.ts` | Enums (`IssueType`, `IssueSeverity`, `ScanStatus`), `Issue`, `IChecker` |
| `src/database/db.ts` | SQLite schema via `better-sqlite3` |
| `src/queue/queue.ts` | BullMQ queue definition |
| `src/workers/index.ts` | BullMQ worker registration |

### Checkers
| # | Checker | IssueType | Detects |
|---|---------|-----------|---------|
| 1 | BrokenResourcesChecker | `BROKEN_RESOURCE` | Broken images/CSS/scripts/fonts (network + DOM) |
| 2 | FailedAPIChecker | `FAILED_API` | Failed XHR/fetch, slow APIs (>10s), CORS |
| 3 | InteractivityChecker | `INTERACTIVITY` | Links without href, `#` placeholders, disabled buttons |
| 4 | ContentChecker | `EMPTY_CONTENT` | Empty containers, visible error messages |
| 5 | LazyLoadChecker | `LAZY_LOAD` | Lazy images not loaded, stuck spinners |
| 6 | FormModalChecker | `FORM_MODAL` | Forms without submit/action, modals without close, cookie banners |
| 7 | ConsoleErrorChecker | `CONSOLE_ERROR` | JS errors, CORS errors |
| 8 | PerformanceChecker | `PERFORMANCE` | TTFB, DOMContentLoaded, full load, DOM node count, resource count |
| 9 | AccessibilityChecker | `ACCESSIBILITY` | WCAG 2.0A/AA/2.1A/AA violations via `@axe-core/playwright` |

### Frontend Files
| File | Purpose |
|------|---------|
| `src/pages/Home.tsx` | URL input + scan progress polling |
| `src/pages/Report.tsx` | Fetches and displays report |
| `src/components/ReportViewer/ReportViewer.tsx` | Score, filters, grouping, JSON/CSV export, full-page screenshot |
| `src/components/ErrorGroup/ErrorGroup.tsx` | Group header per IssueType |
| `src/components/ErrorCard/ErrorCard.tsx` | Issue card with metadata, element screenshot, copy + AI explain |
| `src/components/ScreenshotThumb/ScreenshotThumb.tsx` | Lazy-loaded thumbnail → opens Lightbox |
| `src/components/Lightbox/Lightbox.tsx` | Full-screen image modal |
| `src/components/Settings/Settings.tsx` | LLM config (Groq API key, model) |
| `src/services/api.ts` | Axios client → backend port 3001 |
| `src/services/ai.ts` | Groq LLM integration |
| `src/types/index.ts` | Frontend type mirrors |

## Screenshots (Phase 1 — Complete)

After checkers run, ScanWorker captures screenshots:
- **Full-page**: `data/screenshots/{scanId}/full.png`
- **Per-element**: `data/screenshots/{scanId}/{issueId}.png` (HIGH severity issues with CSS `selector` in metadata)

Served via `GET /screenshots/:scanId/:filename` with UUID validation and path traversal protection. Frontend displays them via `ScreenshotThumb` + `Lightbox` in ErrorCard dropdowns and ReportViewer header.

Key types: `Issue.screenshot_path?: string`, `ReportResponse.fullPageScreenshot?: string | null`.

## Key Constraints

### page.evaluate and tsx/esbuild
All `page.evaluate()` calls **must** use template string format:
```typescript
await page.evaluate(`(() => { ... })()`)
```
Never use arrow function callbacks. The tsx runner (esbuild) injects a `__name` helper that causes `ReferenceError: __name is not defined` in the browser context. Use `var`, `function`, and `for` loops inside evaluate strings — no `const`/`let`/arrow functions.

### UUID Generation
Use `import { randomUUID } from 'crypto'`, NOT `crypto.randomUUID()`.

### Database
SQLite via `better-sqlite3`. File at `backend/data/sitesentry.db` (configurable via `DB_PATH` env var). Schema auto-created with `CREATE TABLE IF NOT EXISTS`. Migrations via inline `ALTER TABLE` with try/catch for idempotency.

Tables:
- `scans`: id, url, status, config, created_at, completed_at
- `issues`: id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, created_at

### Import Style
- Backend: CommonJS (`"module": "commonjs"`), `tsx` runner
- Frontend: ESM (`"type": "module"`), Vite, `@/` alias → `src/`

### UI Language
All user-facing text is in **Spanish**.

## Adding a New Checker

1. Add new value to `IssueType` enum in both `backend/src/types/index.ts` and `frontend/src/types/index.ts`
2. Create `backend/src/checkers/MyChecker.ts` implementing `IChecker`
3. Export and register in `backend/src/checkers/index.ts`
4. Add label + icon to `getTypeIcon()`/`getTypeLabel()` in `frontend/src/components/ReportViewer/ReportViewer.tsx`
5. Add entry to `typeConfig` in `frontend/src/components/ErrorGroup/ErrorGroup.tsx`

## Roadmap

### Phase 2: Visual Regression (pending)
Compare screenshots between scans of the same URL using `pixelmatch`. Store baseline screenshots per URL. Highlight visual diffs in the report. Configurable diff threshold. Reuses Phase 1 screenshot infrastructure.

### Phase 3: Interactive Flows (pending)
Import Playwright `codegen` scripts to define multi-step user flows (login, search, add to cart). Replay flows in the scanner, run checkers at each step, capture screenshots per step. Reuses screenshot + diff infrastructure from Phases 1 and 2.
