# Critical Fix Report — backend/src/api/server.ts

## Issue 1: Path traversal vulnerability (Critical)

**Route:** `GET /screenshots/:scanId/:filename`
**Risk:** Attacker can use `..` segments in `scanId` or `filename` to read arbitrary files from the filesystem, as `fs.existsSync` and `fs.createReadStream` resolve `..` paths.

**Fix:** Added validation that:
- `scanId` matches UUID format (`/^[a-f0-9-]{36}$/`)
- `filename` contains no `..`, `/`, or `\`

Returns 400 with `{ error: 'Invalid path' }` on violation.

---

## Issue 2: Stream error handler after pipe (Critical)

**Risk:** `fs.createReadStream` can emit errors synchronously. When `stream.on('error', ...)` is registered after `stream.pipe(res)`, a synchronous error becomes an unhandled rejection.

**Fix:** Moved `stream.on('error', ...)` registration before `stream.pipe(res)`.

---

## Verification

- `npx tsc --noEmit` — passes with no errors
- File: `backend/src/api/server.ts:47-74`

## Fix: Silent element screenshot failures & screenshot_path typing

**Date:** 2026-06-20 01:45
**Issues:** Important #5, Important #7

### Issue 1: Silent element screenshot failures
- **File:** src/workers/ScanWorker.ts:116-118
- **Change:** Replaced empty catch block with console.debug logging the selector
- **Impact:** Element screenshot failures are now observable instead of silently swallowed

### Issue 2: Proper screenshot_path typing in reports route
- **File:** src/api/routes/reports.ts:68-70,81
- **Changes:**
  - Added screenshot_path: string \| null; to the SQL query result type
  - Replaced (i as any).screenshot_path with i.screenshot_path (properly typed)
- **Impact:** Eliminates unsafe s any cast, enabling type safety

### Verification
- 
px tsc --noEmit: passed (no errors)
- 
px jest --no-coverage: 2 suites, 3 tests passed
