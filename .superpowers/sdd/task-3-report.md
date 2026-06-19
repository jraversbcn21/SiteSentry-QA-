# Task 3 Report: ScanWorker Screenshot Capture

## Summary

Modified `backend/src/workers/ScanWorker.ts` to capture full-page and element screenshots during scans, and created the corresponding test file.

## Changes Applied

### Step A — Added imports
Added `import path from 'path'` and `import fs from 'fs'` at the top of `ScanWorker.ts`.

### Step B — UUID pre-assignment
Before `analyzer.close()`, all issues get assigned UUIDs via `randomUUID()` so they can be used for screenshot filenames.

### Step C — Screenshot capture
- Creates `data/screenshots/<scanId>/` directory
- Captures full-page screenshot as `full.png`
- For each HIGH-severity issue with a `selector` in metadata, captures an element screenshot named `{issue.id}.png`
- Sets `issue.screenshot_path` to `{scanId}/{filename}`
- Screenshot failures are non-fatal (wrapped in try/catch with empty catch)

### Step D — Updated INSERT SQL (main flow)
Added `screenshot_path` column to the `insertIssue` prepared statement.

### Step E — Updated insert call (main flow)
Uses pre-assigned `(issue as any).id` instead of calling `randomUUID()` again, and passes `issue.screenshot_path || null`.

### Step F — Updated anti-bot block INSERT
Added `screenshot_path` column and passes `null` as the parameter.

### Step G — Created test file
`backend/src/__tests__/screenshots-capture.test.ts` — Tests directory creation with `fs.mkdirSync({ recursive: true })`.

## Verification

- `npx tsc --noEmit` — passed (no errors)
- `npx jest src/__tests__/screenshots-capture.test.ts --no-coverage` — 2/2 passed
- `npx jest src/__tests__/screenshots-db.test.ts --no-coverage` — 1/1 passed
