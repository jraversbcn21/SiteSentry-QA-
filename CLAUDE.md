# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SiteSentry QA is a single-page functional web analyzer. Given one URL, it opens that page in a headless browser, intercepts network traffic, scrolls through the page, and runs 6 checkers to detect functional problems. It does NOT crawl or follow links.

## Commands

### Backend (from `backend/`)
- `npm run dev` — Start API server with tsx watch (hot reload)
- `npm run dev:worker` — Start BullMQ worker with tsx watch
- `npm run build` — TypeScript compile (`tsc`)
- `npx tsc --noEmit` — Type-check without emitting
- `npm run prisma:generate` — Regenerate Prisma client after schema changes
- `npm run prisma:migrate` — Run database migrations
- `npm run prisma:studio` — Open Prisma Studio GUI

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
`POST /api/scan` → Prisma creates Scan row → BullMQ job queued → Worker picks up job → Playwright opens page → PageAnalyzer intercepts network + scrolls → 6 Checkers run → Issues saved to DB → Frontend polls `/api/scan/:id/status` until COMPLETED → Fetches `/api/reports/:id`

### Backend Key Files
- **`src/analyzer/PageAnalyzer.ts`** — Core engine. Creates a BrowserContext with a realistic fingerprint (userAgent, locale, Sec-CH-UA headers) to avoid anti-bot detection, opens a single page, intercepts all network requests/responses/failures, captures console errors, performs full-page scroll. Returns `PageAnalysis` with the live `Page` object and `NetworkEvent[]`.
- **`src/checkers/`** — 6 checkers, each implements `IChecker.check(url, page, networkEvents)`. They are: BrokenResourcesChecker, FailedAPIChecker, InteractivityChecker, ContentChecker, LazyLoadChecker, FormModalChecker.
- **`src/workers/ScanWorker.ts`** — Orchestrates the full pipeline: launch browser (with `--disable-http2` flag) → analyze page → run checkers → save issues → mark complete. If an anti-bot block is detected (`ERR_HTTP2_PROTOCOL_ERROR`, `ERR_CONNECTION_CLOSED`), the scan completes with an informative `FAILED_API` / `HIGH` issue instead of failing.
- **`src/api/routes/scan.ts`** — POST scan, GET status. `src/api/routes/report.ts` — GET report.
- **`src/types/index.ts`** — Shared enums (IssueType, IssueSeverity, ScanStatus) and IChecker interface.
- **`src/database/prisma/schema.prisma`** — Two models: Scan and Issue. No Page model.

### Frontend Key Files
- **`src/pages/Home.tsx`** — URL input + scan progress polling.
- **`src/pages/Report.tsx`** — Fetches and displays report.
- **`src/components/ReportViewer/`** — Score, filters, grouping by type. Includes JSON and CSV export buttons for downloading the full report.
- **`src/components/ErrorCard/`** — Individual issue card with formatted metadata.
- **`src/services/api.ts`** — Axios client hitting backend on port 3001.
- **`src/types/index.ts`** — Frontend mirrors of backend enums/interfaces.

## Critical: page.evaluate and tsx/esbuild

All `page.evaluate()` calls in checkers and PageAnalyzer **must** use template string format:
```typescript
await page.evaluate(`(() => { ... })()`)
```
**Never** use arrow function callbacks like `page.evaluate(() => { ... })`. The tsx runner (esbuild) injects a `__name` helper into compiled functions, which causes `ReferenceError: __name is not defined` in the browser context. Use plain `var`, `function`, and `for` loops inside evaluate strings — avoid `const`/`let`/arrow functions that might trigger esbuild transforms.

## Database

PostgreSQL via Supabase. Prisma schema at `backend/src/database/prisma/schema.prisma`. Two tables: `Scan` and `Issue`. Enums: `ScanStatus`, `IssueType`, `IssueSeverity`. When writing Issue metadata to Prisma, cast with `as Prisma.InputJsonValue` and use `Prisma.JsonNull` for null values.

## Anti-Bot Handling

The browser launches with `--disable-http2` to force HTTP/1.1 and avoid `ERR_HTTP2_PROTOCOL_ERROR` on sites with anti-bot protection (e.g., Prada, luxury brands). PageAnalyzer creates a `BrowserContext` with a realistic Chrome fingerprint: userAgent, locale `es-ES`, timezone `Europe/Madrid`, and `Sec-CH-UA` / `Accept-Language` headers. If the site still blocks access, ScanWorker catches the error and saves a descriptive `FAILED_API` issue with `metadata.errorType: 'ANTI_BOT_BLOCK'` instead of marking the scan as FAILED.

## Report Export

ReportViewer includes two download buttons (JSON and CSV). The JSON export includes the full report with summary and all issues translated to Spanish labels. The CSV export includes BOM for Excel compatibility and dynamically adds metadata columns based on the issues found. Files are named `reporte_qa_{hostname}_{date}.{ext}`.

## UI Language

All user-facing text (descriptions, labels, messages) is in **Spanish**. Issue descriptions, checker output, and frontend copy are all in Spanish.
