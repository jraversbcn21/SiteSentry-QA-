### Task 6: ScanWorker — Flow Execution Mode ✅

**Status:** COMPLETED

**Files modified:**
- `backend/src/workers/ScanWorker.ts` — Flow execution logic, updated INSERT, screenshot copy
- `backend/src/analyzer/PageAnalyzer.ts` — Made `fullScroll()` public for per-step scroll invocation

**What was done:**
1. Updated `JobData` interface to accept `flow?: FlowInfo` in config
2. Added flow execution mode conditional (`if (flowConfig && flowConfig.steps && ...)`):
   - Loops over flow steps, executing actions (navigate/click/type/wait/select/hover/press)
   - Best-effort error handling: failed steps register FLOW_ERROR issues; navigate failures abort the flow
   - Checkpoints, navigations, and last steps trigger: fullScroll → 9 checkers → per-step screenshots
   - Per-step screenshots use `step-{N}-full.png` and `step-{N}-{issueId}.png` naming
   - `stepIndex` assigned to each detected issue
   - Progress updates send `{ phase: 'running_flow_step', step: { index, total, action } }`
3. Preserved existing normal-mode code path in the `else` branch (checkers loop + screenshots + page close)
4. Updated INSERT statement to include `step_index` column with `(issue as any).stepIndex ?? null`
5. After flow completes: copies last step's full-page as `full.png` for visual regression compatibility
6. Made `PageAnalyzer.fullScroll()` public so it can be called per-step

**Verification:**
```
cd backend; npx tsc --noEmit   # PASSED — no errors
```

**Key constraints met:**
- All new variable declarations use `var`
- String concatenation used throughout new code (no template literals)
- Error handling is best-effort (try/catch per step, FLOW_ERROR on failure, abort only on navigate failure)
- Existing normal-mode code path is fully preserved
