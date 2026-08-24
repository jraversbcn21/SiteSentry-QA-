# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

SiteSentry QA is a single-page functional web analyzer. Given one URL, it opens that page in a headless browser, intercepts network traffic, scrolls through the page, and runs 9 checkers to detect functional and quality problems. It does NOT crawl or follow links.

Supports interactive multi-step flows (login, search, add to cart) via JSON step definitions or Playwright codegen script import. Includes visual regression detection comparing screenshots between scans of the same URL using pixelmatch. Includes OpenRouter LLM integration for AI-powered issue explanations.

## Audit Status (2026-07-04 architecture audit)

The architecture audit at **`docs/architecture-audit-2026-07-04.md`** had 34 findings and 38 ordered tasks (T01-T38). **Audit status: closed 2026-08-15 — all 38 tasks resolved.** The execution delta (3 tasks) was folded into siblings or waived, not skipped:
- **T12** (shared zod schemas) — executed inside T11's commit; `src/api/schemas.ts` exists and is used by both `scan.ts` and `flows.ts`.
- **T19** (`scanStatusConfig.ts`) — folded into `issueTypeConfig.ts` as a single config file (ScanStatus labels live there via `getStatusLabel`).
- **T26** (CSP + optional LLM proxy) — CSP meta tag added; the backend proxy for LLM calls was waived (backend proxy implemented post-audit on feat/groq-proxy; provider migrated to OpenRouter 2026-08-24).

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1 — Architecture Foundation | T01-T10, T35 | Done |
| Phase 2 — Security Hardening | T09-T10 | Done |
| Phase 3 — Backend Pipeline Cleanup | T11-T14 | Done |
| Phase 4 — Checker Consistency | T15-T18 | Done |
| Phase 5 — Frontend Architecture | T19-T23 | Done |
| Phase 6 — Shared Types | T24-T25 | Done |
| Phase 7 — Testing | T02-T03 | Done |
| Phase 8 — Production Hardening | T26-T34, T36-T38 | Done |

**T33 (H9) — PageFacts DOM pre-pass (executed):** `checkers/pageFacts.ts` provides `collectPageFacts(page)` — a single `page.evaluate()` round-trip that snapshots all 16 DOM fragments the checkers previously queried independently (broken images, background images, empty containers, error states, main content, CORS candidates, forms, modals, cookie blockers, dead buttons, placeholder links, pseudo-disabled buttons, lazy images, spinners, placeholder images, performance metrics). `CheckerRunner` collects it once per run and passes it to every checker via the optional 5th `facts` parameter of `IChecker.check`; checkers fall back to collecting it themselves when called standalone (e.g. in tests). **Benchmarked 2026-08-24** (en.wikipedia.org/wiki/United_States, 21.7k DOM nodes, median of 5): shared pre-pass 169ms vs 1230ms per-checker self-collection — ~1.06s (86%) saved per scan in the checker phase.

## Commands

### Backend (`backend/`)
| Command | Description |
|---------|-------------|
| `npm run dev` | Start API server with tsx watch (port 3001) — single-process mode: API + worker run in the same Node process |
| `npm run build` | TypeScript compile (`tsc`) |
| `npx tsc --noEmit` | Type-check without emitting |
| `npm test` | Run Jest test suite (72 tests, 9 suites) |

### Frontend (`frontend/`)
| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | Type-check + Vite production build |
| `npm run lint` | ESLint |

### Running the app (2 terminals)
1. `cd backend && npm run dev` (API + Worker on port 3001)
2. `cd frontend && npm run dev` (Vite on port 5173)

## Architecture

```
POST /api/scan  [auth + rate-limit + SSRF pre-check]
  → SQLite creates Scan row
  → In-process queue adds job (EventEmitter, same process)
  → Worker picks up job (async, same event loop)
  → SSRF validation (DNS-resolve + private IP denylist)
  → Playwright opens page
  → [Flow mode: FlowEngine executes steps (click, type, navigate...)]
  → CheckerRunner runs 9 Checkers (per step in flow mode)
  → ScreenshotService captures screenshots (per step in flow mode)
  → Issues persisted to SQLite (transaction)
  → VisualRegressionService runs pixelmatch diff
  → Frontend polls /api/scan/:id/status (progress visible via activeJob tracking)
  → Fetches /api/reports/:id
```

### Backend Files

| File | Purpose |
|------|---------|
| `src/analyzer/PageAnalyzer.ts` | Core engine: browser context, network interception, console capture, full-page scroll. `close()` closes the BrowserContext. |
| `src/checkers/` | 9 checkers implementing `IChecker.check(url, page, networkEvents, consoleErrors?, facts?)` |
| `src/checkers/severity.ts` | Shared severity-policy module: `mapBy`, `patternSeverity`, `thresholdLadder`, `fixedSeverity` |
| `src/checkers/domHelpers.ts` | Shared DOM-scan snippet builders for `page.evaluate()`: `visibilityCheckSnippet`, `imgSrcSelector`, `dedupByKey` |
| `src/checkers/pageFacts.ts` | `collectPageFacts(page)`: single-pass DOM snapshot (T33/H9) shared by all checkers via `CheckerRunner`. Fragment logic mirrors the original per-checker snippets exactly. |
| `src/services/CheckerRunner.ts` | Runs all 9 checkers and collects issues (used by both normal and flow modes). Collects shared `PageFacts` once per run and passes it to each checker. |
| `src/services/FlowEngine.ts` | Executes interactive flow steps: navigate, click, type, wait, select, hover, press, checkpoint |
| `src/services/ScreenshotService.ts` | Full-page + per-element screenshot capture, directory creation, last-step copy |
| `src/services/VisualRegressionService.ts` | Baseline lookup, pixelmatch diff, visual_diffs persistence |
| `src/workers/ScanWorker.ts` | Thin orchestrator: browser → analyze → [flow] → checkers → screenshots → persist → visual regression |
| `src/workers/index.ts` | Registers queue processor, persists job progress to the `scans.progress` column (H10), recovers orphaned PENDING/RUNNING scans on startup |
| `src/api/routes/scan.ts` | POST scan (zod-validated, SSRF pre-check), GET status with progress (in-memory `activeJob` first, DB `progress` column as fallback while RUNNING). Uses shared `schemas.ts`. |
| `src/api/routes/reports.ts` | GET report with issues + screenshots + visual diffs + per-step results, GET reports list. NaN-safe pagination. |
| `src/api/routes/flows.ts` | CRUD for reusable interactive flows (5 endpoints). Uses shared zod validation from `schemas.ts`. |
| `src/api/routes/ai.ts` | OpenRouter proxy: POST /explain (zod-validated, model whitelist), GET /status. Dedicated 30 req/min rate limit. |
| `src/services/AiService.ts` | OpenRouter API calls: prompt building, model whitelist, 20s AbortController timeout, typed `AiError`. Reads `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` env vars. |
| `src/api/schemas.ts` | Shared zod schemas: `FlowStepSchema`, `ScanRequestSchema`. Used by both `scan.ts` and `flows.ts`. |
| `src/api/middleware/auth.ts` | API-key authentication middleware. Requires `x-api-key` header if `API_KEY` env var is set. Transparent in dev (no key required). |
| `src/api/server.ts` | Express app: CORS, helmet, auth middleware, rate limiting, routes, screenshot serving, `/health` endpoint, graceful shutdown (SIGTERM/SIGINT with queue drain + 30s timeout). Exports `app` for tests; listens only when run as entry point. |
| `src/security/ssrf.ts` | SSRF protection: DNS-resolve hostname, validate against private/reserved IP ranges (RFC1918, loopback, link-local). |
| `src/logger.ts` | Structured logger with ISO timestamps and levels (debug/info/warn/error). Configurable via `LOG_LEVEL` env var. |
| `src/types/index.ts` | Shared `Summary` type, `Issue` with optional `id`/`stepIndex`, enums (`IssueType`, `IssueSeverity`, `ScanStatus`), interfaces |
| `src/database/db.ts` | SQLite via `better-sqlite3` with versioned migration tracking (`schema_migrations` table, 8 migrations) |
| `src/queue/queue.ts` | In-process queue (EventEmitter-based). Tracks `activeJob` for progress visibility. `shutdown()` drains active job. |

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

Additional `IssueType.FLOW_ERROR` is generated by FlowEngine when a flow step fails. Unrecognized step actions also produce FLOW_ERROR.

### Issue Types
| Type | Severity | Source | Description |
|------|----------|--------|-------------|
| `BROKEN_RESOURCE` | HIGH/MEDIUM | BrokenResourcesChecker | Broken images, CSS, scripts, fonts |
| `FAILED_API` | HIGH/MEDIUM | FailedAPIChecker | Failed API calls, CORS, slow APIs |
| `INTERACTIVITY` | MEDIUM/LOW | InteractivityChecker | Broken links, disabled buttons |
| `EMPTY_CONTENT` | HIGH | ContentChecker | Empty containers, error messages |
| `LAZY_LOAD` | HIGH/MEDIUM | LazyLoadChecker | Lazy images, stuck spinners |
| `FORM_MODAL` | MEDIUM | FormModalChecker | Form/modal issues |
| `CONSOLE_ERROR` | HIGH/MEDIUM | ConsoleErrorChecker | JS errors, console errors |
| `PERFORMANCE` | HIGH/MEDIUM/LOW | PerformanceChecker | Page performance metrics |
| `ACCESSIBILITY` | HIGH/MEDIUM/LOW | AccessibilityChecker | WCAG violations |
| `FLOW_ERROR` | HIGH | FlowEngine | Flow step execution failure |

### Frontend Files
| File | Purpose |
|------|---------|
| `src/pages/Home.tsx` | URL input + flow selector + scan progress polling (stabilized deps). Uses shared `getStatusLabel`. |
| `src/pages/Report.tsx` | Fetches and displays report with race-condition guard (ignore flag). Uses `unwrapApiError`. |
| `src/config/issueTypeConfig.ts` | Single source of truth for IssueType labels/icons/colors, severity labels, and ScanStatus labels. Imported by all components. |
| `src/components/URLInput/URLInput.tsx` | URL input field with validation |
| `src/components/ScanProgress/ScanProgress.tsx` | Scan progress bar with phase labels (renders fallback text when progress is null) |
| `src/components/ReportViewer/ReportViewer.tsx` | Score, FlowTabs, filters, grouping, JSON/CSV export, full-page screenshot, visual regression, baseline toggle (no page reload) |
| `src/components/ErrorGroup/ErrorGroup.tsx` | Group header per IssueType. Uses shared `typeConfig`. |
| `src/components/ErrorCard/ErrorCard.tsx` | Issue card with metadata, element screenshot, element diff, copy + AI explain. Uses shared `typeConfig` and `severityConfig`. |
| `src/components/ScreenshotThumb/ScreenshotThumb.tsx` | Lazy-loaded thumbnail → opens Lightbox. Uses `getScreenshotUrl`. |
| `src/components/Lightbox/Lightbox.tsx` | Full-screen image modal |
| `src/components/VisualDiffViewer/VisualDiffViewer.tsx` | Side-by-side slider + diff.png + percentage badge. Uses `getScreenshotUrl`. |
| `src/components/FlowEditor/FlowEditor.tsx` | Flow editor with codegen import, `<StepField>` sub-component, manual step editing |
| `src/components/FlowTabs/FlowTabs.tsx` | Per-step tab navigation in reports |
| `src/components/Settings/Settings.tsx` | OpenRouter LLM config (server AI status + model: 6 models available) |
| `src/components/ErrorBoundary.tsx` | Error boundary wrapped at App.tsx root (catches render errors in all pages) |
| `src/services/api.ts` | Axios client, `unwrapApiError()` helper, `getScreenshotUrl()` helper |
| `src/services/ai.ts` | AI issue explanations via backend proxy (`/api/ai/explain`). Model preference from localStorage. |
| `src/services/codegenConverter.ts` | Parses Playwright codegen scripts to FlowStep JSON |
| `src/types/index.ts` | Frontend type mirrors |

## Security

| Feature | Mechanism | Config |
|---------|-----------|--------|
| Authentication | `x-api-key` header middleware on all `/api/*` routes | `API_KEY` env var (optional; dev mode if unset) |
| SSRF protection | DNS-resolve + private IP denylist (RFC1918, loopback, link-local) | Two layers: pre-check in `scan.ts` + validation in `ScanWorker.ts` |
| Rate limiting | `express-rate-limit` on `POST /api/scan` | 10 req/min, configurable |
| CSP | Content-Security-Policy meta tag in `index.html` | `default-src 'self'`, allows Google Fonts; AI calls go through backend |
| Path traversal | UUID v4 regex + `..`/`/`/`\` rejection | Screenshot serving routes |

## Phase 1 — Screenshots (Complete)

After checkers run, ScreenshotService captures:
- **Full-page**: `data/screenshots/{scanId}/full.png`
- **Per-element**: `data/screenshots/{scanId}/{issueId}.png` (HIGH severity issues with CSS `selector` in metadata)
- **Per-step**: `data/screenshots/{scanId}/step-{N}-full.png` and `step-{N}-{issueId}.png` (flow mode)

Served via `GET /screenshots/:scanId/:filename` with UUID validation and path traversal protection. Frontend displays them via `ScreenshotThumb` + `Lightbox` in ErrorCard dropdowns and ReportViewer header.

Key types: `Issue.screenshot_path?: string`, `ReportResponse.fullPageScreenshot?: string | null`.

## Phase 2 — Visual Regression (Complete)

After screenshots and issue persistence, VisualRegressionService runs pixelmatch comparison:
- **Baseline lookup**: manual (`is_baseline=1`) first, then automatic (last completed scan of same URL)
- **Full-page diff**: resizes to smallest common dimensions via `sharp`, runs `pixelmatch`, saves `diff-full.png`
- **Element diffs**: matches by CSS selector (exact string), falls back to same IssueType + same URL
- **Threshold**: `VISUAL_DIFF_THRESHOLD` env var (default 0.05), overridable per scan via `visualDiffThreshold` param
- **Best-effort**: diff failures never fail the scan
- **Baseline management**: `POST /api/scans/:id/set-baseline` marks/unmarks manual baseline
- **Frontend**: `VisualDiffViewer` with side-by-side slider, diff.png, percentage badge. Baseline toggle without page reload.

Dependencies: `pixelmatch`, `pngjs`, `sharp`.

## Phase 3 — Interactive Flows (Complete)

Users define multi-step flows (login, search, add to cart) in JSON format or by importing Playwright codegen scripts.

**Flow definition format:**
```json
[
  { "action": "navigate", "url": "https://example.com/login" },
  { "action": "type", "selector": "#username", "value": "admin" },
  { "action": "click", "selector": "button[type=submit]" }
]
```

**Supported actions:** `navigate`, `click`, `type`, `wait`, `select`, `hover`, `press`, `checkpoint`.

**Execution:** FlowEngine loops over steps. At checkpoints, navigations, and the last step, it runs all 9 checkers and captures per-step screenshots. Issues get `step_index`. The last step's screenshot is copied as `full.png` for visual regression compatibility. Unrecognized step actions generate FLOW_ERROR issues instead of silently no-oping.

**Flow storage:** `flows` table with CRUD via `/api/flows`. Scans accept `flow` (inline) or `flowId` (saved reference). Both validated with shared zod schemas from `schemas.ts`.

**Codegen converter:** `frontend/src/services/codegenConverter.ts` parses Playwright codegen scripts to JSON steps via regex.

**Frontend:** `FlowEditor` component for creating/editing flows (with `<StepField>` sub-component). `FlowTabs` component for per-step report navigation. `ReportViewer` filters issues by step.

## OpenRouter LLM Integration

AI explanations are proxied through the backend — the OpenRouter API key never touches the browser. Migrated from Groq on 2026-08-24; OpenRouter is OpenAI-compatible, so only the endpoint, env vars and model ids changed.

| Item | Detail |
|------|--------|
| `POST /api/ai/explain` | Body: `{ type, severity, description, url, model? }` → `{ explanation }`. Dedicated rate limit: 30 req/min. Timeout: 20s. |
| `GET /api/ai/status` | `{ configured: boolean, defaultModel: string }` |
| `backend/src/services/AiService.ts` | Model whitelist, prompt building, typed `AiError` (400/502/503/504). Sends OpenRouter `HTTP-Referer`/`X-Title` attribution headers. |
| `OPENROUTER_API_KEY` env var | Required for AI; server returns 503 when unset |
| `OPENROUTER_MODEL` env var | Optional server-side default model |

Available models (backend whitelist): `google/gemini-2.5-flash-lite` (default), `meta-llama/llama-3.3-70b-instruct`, `deepseek/deepseek-chat-v3-0324`, `qwen/qwen3-30b-a3b-instruct-2507`, `google/gemma-4-31b-it:free`, `nvidia/nemotron-3.5-lightning:free`. The `:free` ids need no credits but share a public OpenRouter pool and 429 easily (hit in real testing 2026-08-24) - not used as default for that reason, though still selectable. Keep this list in sync with `AI_MODELS` in `frontend/src/components/Settings/Settings.tsx`.

The Settings page (`/settings`) shows server AI status and stores only the model preference in localStorage (`sitesentry_ai_model` — renamed from `sitesentry_groq_model` so stale Groq ids are discarded rather than rejected with 400). `services/ai.ts` sends it per request; the backend validates it against the whitelist.

## Runtime Environment

**No external services required for development.** The app runs entirely self-contained:
- SQLite database (file-based, no server)
- In-process job queue (EventEmitter-based, no Redis)
- Single-process mode: API + worker run in the same Node.js process
- Graceful shutdown: SIGTERM/SIGINT drains active job + closes DB (30s timeout)
- Structured logging via `logger.ts` with configurable levels (`LOG_LEVEL` env var)

### Ports and env files
Both sides read a gitignored `.env` (no env vars needed on the command line):
- `backend/.env` — loaded by `dotenv/config` (first import in `server.ts`). `PORT` (default 3001), `FRONTEND_URL`, `PAGE_TIMEOUT`, `DB_PATH`, `LOG_LEVEL`, `API_KEY`, `OPENROUTER_API_KEY`. Real environment variables win over `.env`. Note: Node 20.6+ `--env-file` is not used — the project targets Node 18.
- `frontend/.env` — loaded by Vite `loadEnv` in `vite.config.ts`. `BACKEND_PORT` (default 3001, must match the backend's `PORT` — it is the dev-proxy target) and `FRONTEND_PORT` (default 5173).

Move both ports when 3001/5173 are taken: set `PORT` in `backend/.env` and the matching `BACKEND_PORT` in `frontend/.env`.

## Key Constraints

### page.evaluate and tsx/esbuild
All `page.evaluate()` calls **must** use template string format:
```typescript
await page.evaluate(`(() => { ... })()`)
```
Never use arrow function callbacks. The tsx runner (esbuild) injects a `__name` helper that causes `ReferenceError: __name is not defined` in the browser context. Use `var`, `function`, and `for` loops inside evaluate strings — no `const`/`let`/arrow functions.

This constraint applies ONLY to `page.evaluate()` strings, not to regular TypeScript/Node.js code.

**For shared evaluate-string builders**, use `checkers/domHelpers.ts` functions like `visibilityCheckSnippet()` which return JavaScript snippet strings compatible with this constraint. Import them and interpolate into template literals:
```typescript
await page.evaluate(`(() => {
  var isVisible = ${visibilityCheckSnippet()} && rect.height > 0;
})()`);
```

### UUID Generation
Use `import { randomUUID } from 'crypto'`, NOT `crypto.randomUUID()`.

### Database
SQLite via `better-sqlite3`. File at `backend/data/sitesentry.db` (configurable via `DB_PATH` env var). Versioned migration system with `schema_migrations` table tracking 8 ordered migrations. Each migration has a version number, name, and SQL. New migrations are appended to the array in `db.ts`.

Tables:
- `scans`: id, url, status, config, is_baseline, progress, created_at, completed_at
- `issues`: id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, step_index, created_at
- `visual_diffs`: id, scan_id, baseline_scan_id, diff_type, issue_id, baseline_issue_id, element_identifier, diff_percentage, diff_image_path, threshold_used, created_at
- `flows`: id, name, steps, created_at, updated_at
- `schema_migrations`: version (PK), name, applied_at

### Import Style
- Backend: CommonJS (`"module": "commonjs"`), `tsx` runner
- Frontend: ESM (`"type": "module"`), Vite, `@/` alias → `src/`

### UI Language
All user-facing text is in **Spanish**.

## Design System

SiteSentry QA follows a **Flat Design + Minimalism** aesthetic. Design tokens are implemented as CSS custom properties in `:root` (see `frontend/src/index.css`):

```css
--color-primary: #2563eb;
--color-primary-hover: #1d4ed8;
--color-secondary: #3b82f6;
--color-bg: #f8fafc;
--color-card: #ffffff;
--color-text: #0f172a;
--color-text-secondary: #475569;
--color-text-muted: #94a3b8;
--color-border: #e2e8f0;
--color-success: #16a34a;
--color-warning: #f59e0b;
--color-error: #ef4444;
--color-accent: #f97316;
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 16px;
--shadow-sm: 0 1px 3px rgba(0,0,0,0.05);
--shadow-md: 0 4px 24px rgba(0,0,0,0.07);
--transition: 0.2s ease;
```

All component CSS files use these variables. New CSS should use `var(--color-*)` instead of hardcoded hex values.

**Typography:**
- **Primary font:** `Inter` (Google Fonts, weights 400-800), fallback to system sans-serif
- **Monospace font:** `JetBrains Mono` / `Fira Code` (URLs, code, metadata values)
- **Base size:** `16px` body, `1.5` line-height
- **Headings:** `700` weight, `-0.3px` letter-spacing

**Accessibility:**
- `:focus-visible` ring: `2px solid var(--color-primary)` with `2px` offset
- `prefers-reduced-motion` respected globally
- `::selection` uses `rgba(37, 99, 235, 0.15)` background
- All interactive elements have `cursor: pointer`

## Adding a New Checker

1. Add new value to `IssueType` enum in both `backend/src/types/index.ts` and `frontend/src/types/index.ts`
2. Create `backend/src/checkers/MyChecker.ts` implementing `IChecker` (accept the optional 5th `facts?: PageFacts` parameter)
3. Prefer consuming shared fragments from `PageFacts` (via `facts ?? await collectPageFacts(page)`) over adding new `page.evaluate()` round-trips; only add a new fragment to `checkers/pageFacts.ts` if the DOM data isn't already collected
4. Export and register in `backend/src/checkers/index.ts`
5. Add entry to `typeConfig` in `frontend/src/config/issueTypeConfig.ts` (single source of truth for labels, icons, and colors)
6. Add severity logic using shared severity helpers from `checkers/severity.ts` where applicable

## Adding a New Migration

1. Append a new entry to the `migrations` array in `backend/src/database/db.ts`
2. Each entry has: `{ version: N, name: 'descriptive_name', sql: '...' }`
3. The migration system automatically applies pending migrations on next boot
4. Existing databases are auto-seeded with all current migrations as "applied"

## Frontend Config

Issue type labels, icons, severity labels, and scan status labels are centralized in `frontend/src/config/issueTypeConfig.ts`. All components import from this single source. When adding a new IssueType:

1. Add it to `typeConfig` with label, icon, and color
2. `getTypeIcon()`, `getTypeLabel()`, `getSeverityLabel()`, and `getStatusLabel()` are auto-derived
3. No need to update `ErrorGroup.tsx`, `ErrorCard.tsx`, `ReportViewer.tsx`, or `Home.tsx` individually

## Pending Tasks (next session)

Post-audit backlog: **cleared 2026-08-24** — checker test coverage, PageFacts benchmark (see T33 note above), scan-progress persistence (H10, migration 8), and the E2E smoke test (`e2e.test.ts`) are all done. No pending tasks.
