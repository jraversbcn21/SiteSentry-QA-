# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SiteSentry QA is a single-page functional web analyzer. Given one URL, it opens that page in a headless browser, intercepts network traffic, scrolls through the page, and runs 9 checkers to detect functional and quality problems. It does NOT crawl or follow links.

## Commands

### Backend (from `backend/`)
- `npm run dev` — Start API server with tsx watch (hot reload)
- `npm run dev:worker` — Start BullMQ worker with tsx watch
- `npm run build` — TypeScript compile (`tsc`)
- `npx tsc --noEmit` — Type-check without emitting
- `npm run prisma:generate` — Regenerate Prisma client after schema changes
- `npm run prisma:studio` — Open Prisma Studio GUI

### Prisma DB Push (schema changes)
Schema is NOT at the default path. Always use:
```
npx prisma db push --schema src/database/prisma/schema.prisma
```
Requires Session Mode URL (port 5432), NOT the Transaction Pooler (port 6543). Set env var first:
```powershell
$env:DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
npx prisma db push --schema src/database/prisma/schema.prisma
```
The `.env` DATABASE_URL (port 6543 + `?pgbouncer=true&connection_limit=1`) stays for runtime — only migrations need Session Mode.

### Frontend (from `frontend/`)
- `npm run dev` — Start Vite dev server (port 5173)
- `npm run build` — Type-check + Vite production build
- `npm run lint` — ESLint

### Running the app requires 3 terminals
1. `cd backend && npm run dev` (API on port 3001)
2. `cd backend && npm run dev:worker` (BullMQ worker)
3. `cd frontend && npm run dev` (Vite on port 5173)

## Architecture

### Flow
`POST /api/scan` → Prisma creates Scan row → BullMQ job queued → Worker picks up job → Playwright opens page → PageAnalyzer intercepts network + scrolls → 9 Checkers run → Issues saved to DB → Frontend polls `/api/scan/:id/status` until COMPLETED → Fetches `/api/reports/:id`

### Backend Key Files
- **`src/analyzer/PageAnalyzer.ts`** — Core engine. Creates a BrowserContext with a realistic fingerprint (userAgent, locale, Sec-CH-UA headers), intercepts all network requests/responses/failures, captures console errors, performs full-page scroll. Returns `PageAnalysis` with `page`, `NetworkEvent[]`, `ConsoleEvent[]`, `loadTime`, `scrollHeight`.
- **`src/checkers/`** — 9 checkers, each implements `IChecker.check(url, page, networkEvents, consoleErrors?)`. See checkers section below.
- **`src/workers/ScanWorker.ts`** — Orchestrates the full pipeline: launch browser → analyze → run checkers (passing `analysis.consoleErrors` as 4th arg) → save issues → mark complete. Anti-bot blocks saved as `FAILED_API/HIGH` issue instead of failing.
- **`src/api/routes/scan.ts`** — POST scan, GET status.
- **`src/api/routes/report.ts`** — GET report, GET all reports list.
- **`src/types/index.ts`** — Shared enums (`IssueType`, `IssueSeverity`, `ScanStatus`) and `IChecker` interface. Imports `ConsoleEvent` from PageAnalyzer.
- **`src/database/prisma/schema.prisma`** — Two models: `Scan` and `Issue`.

### Checkers (9 total)
| Checker | IssueType | Detecta |
|---|---|---|
| BrokenResourcesChecker | `BROKEN_RESOURCE` | Imágenes/CSS/scripts/fonts rotos (network + DOM) |
| FailedAPIChecker | `FAILED_API` | XHR/fetch con error, APIs lentas >10s, CORS |
| InteractivityChecker | `INTERACTIVITY` | Links sin href, placeholders `#`, botones sin `disabled` |
| ContentChecker | `EMPTY_CONTENT` | Contenedores vacíos, mensajes de error visibles |
| LazyLoadChecker | `LAZY_LOAD` | Imágenes lazy no cargadas, spinners atascados |
| FormModalChecker | `FORM_MODAL` | Forms sin submit/action, modales sin cierre, banners cookie |
| ConsoleErrorChecker | `CONSOLE_ERROR` | JS errors, CORS errors (usa 4º param `consoleErrors`) |
| PerformanceChecker | `PERFORMANCE` | TTFB, DOMContentLoaded, full load, DOM nodes, resource count |
| AccessibilityChecker | `ACCESSIBILITY` | Violations WCAG 2.0A/AA/2.1A/AA via `@axe-core/playwright` |

### Frontend Key Files
- **`src/pages/Home.tsx`** — URL input + scan progress polling.
- **`src/pages/Report.tsx`** — Fetches and displays report.
- **`src/components/ReportViewer/ReportViewer.tsx`** — Score, filters, grouping by type, JSON/CSV export. Contains `getTypeLabel()` and `getTypeIcon()`.
- **`src/components/ErrorGroup/ErrorGroup.tsx`** — Group header per IssueType. Contains `typeConfig` with label, icon and color per type. **Must be updated when adding new IssueType.**
- **`src/components/ErrorCard/ErrorCard.tsx`** — Individual issue card with formatted metadata.
- **`src/services/api.ts`** — Axios client hitting backend on port 3001.
- **`src/types/index.ts`** — Frontend mirrors of backend enums/interfaces.

## Adding a New Checker

1. Add new value to `IssueType` enum in:
   - `backend/src/database/prisma/schema.prisma`
   - `backend/src/types/index.ts`
   - `frontend/src/types/index.ts`
2. Run `prisma db push` with Session Mode URL (see above)
3. Create `backend/src/checkers/MyChecker.ts` implementing `IChecker`
4. Export and register in `backend/src/checkers/index.ts`
5. Add label + icon to `getTypeIcon()`/`getTypeLabel()` in `ReportViewer.tsx`
6. Add entry to `typeConfig` in `ErrorGroup.tsx`

## Critical: page.evaluate and tsx/esbuild

All `page.evaluate()` calls **must** use template string format:
```typescript
await page.evaluate(`(() => { ... })()`)
```
Never use arrow function callbacks. The tsx runner (esbuild) injects a `__name` helper that causes `ReferenceError: __name is not defined` in the browser context. Use `var`, `function`, and `for` loops inside evaluate strings — no `const`/`let`/arrow functions.

## Database

PostgreSQL via Supabase. Runtime uses Transaction Pooler (port 6543) with `?pgbouncer=true&connection_limit=1`. Schema changes require Session Mode (port 5432). When writing Issue metadata to Prisma, cast with `as Prisma.InputJsonValue` and use `Prisma.JsonNull` for null values.

## Anti-Bot Handling

Browser launches with `--disable-http2` (force HTTP/1.1). PageAnalyzer uses a realistic Chrome fingerprint: userAgent, locale `es-ES`, timezone `Europe/Madrid`, `Sec-CH-UA`/`Accept-Language` headers. If blocked, ScanWorker saves a `FAILED_API/HIGH` issue with `metadata.errorType: 'ANTI_BOT_BLOCK'` and marks scan COMPLETED.

## Report Export

ReportViewer has JSON and CSV download buttons. JSON exports full report with Spanish labels. CSV includes BOM for Excel compatibility with dynamic metadata columns. Files named `reporte_qa_{hostname}_{date}.{ext}`.

## UI Language

All user-facing text is in **Spanish**. Issue descriptions, checker output, and frontend copy are all in Spanish.
