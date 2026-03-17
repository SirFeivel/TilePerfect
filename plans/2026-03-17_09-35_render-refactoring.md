# Plan: render.js Refactoring — SVG Inline Edit Extraction
**Date:** 2026-03-17
**Branch:** render_refactoring
**File:** plans/2026-03-17_09-35_render-refactoring.md
**Revision:** 2 (previous version dropped — architecture violation found)

---

## Context

`render.js` is 3975 lines. The original plan proposed three phases:
- Phase 1: Extract `renderTilePatternForm`, `renderCommercialTab`, `renderExportTab` → new render-*.js files
- Phase 2: Extract SVG inline edit cluster → `svg-inline-edit.js`
- Phase 3: Internal decomposition of `renderPlanSvg` (deferred)

**Phase 1 was dropped after validation.** CLAUDE.md explicitly states "render.js — All DOM rendering functions" and "Correct layer, correct file. DOM manipulation belongs in render.js." There is no precedent in the codebase for splitting DOM rendering across separate render-*.js files. Additionally, `renderTilePatternForm` calls helper functions (`renderReferencePicker`, `renderTilePresetPicker`, `renderSkirtingPresetPicker`) that live in render.js — moving `renderTilePatternForm` to a new file would require importing from render.js, creating a circular dependency.

**This plan covers Phase 2 only: extract the SVG inline edit cluster.**

Phase 3 (internal decomposition of `renderPlanSvg`) remains deferred — it needs its own plan and is orthogonal to this extraction.

---

## Scorecard

| Dimension | Score | Evidence |
|---|---|---|
| **Hacky** | 9 | Clean extraction of a fully self-contained behavior cluster. Module-level state moves with the code that owns it. No workarounds, no re-exports needed beyond the 2 public entry points. |
| **Compliance** | 8 | `svg-inline-edit.js` is an *interaction/event* module, not a rendering module — it does not violate "DOM manipulation belongs in render.js." The SVG edit functions do not render new DOM; they manage real-time editing overlays driven by keyboard/pointer events. Precedent: `drag.js`, `exclusions.js`, `sections.js` are all interaction modules that touch DOM without being render modules. |
| **Complexity** | 9 | One new file. render.js removes ~200 lines. main.js updates 2 import lines. render.js internal callers (`startSvgEdit`, `startSvgTextEdit`) stay in same module — no import change needed for internal calls. Zero logic changes. |
| **Problem Understanding** | 8 | All usages of `activeSvgEdit` and `activeSvgTextEdit` traced (lines 33–230 in render.js). Neither var is read by `renderPlanSvg` or `renderFloorCanvas` directly — only by the 8 functions in the cluster. All external callers confirmed: `cancelSvgEdit`/`commitSvgEdit` called from main.js; `startSvgEdit`/`startSvgTextEdit` called from render.js internally (renderPlanSvg). Circular dep check: `svg-inline-edit.js` needs no imports from render.js — no circular dep. |
| **Confidence** | 4 | Extraction is mechanically straightforward and all analysis points to a safe move. However, no runtime verification has occurred. Confidence cannot exceed 5 per rulebook until the user confirms the SVG inline editing feature still works at runtime after the move. |

---

## What the SVG Inline Edit Cluster Is

Lines 33–230 in render.js contain a self-contained feature: real-time numeric and text editing overlays in SVG elements. When the user clicks a dimension label or room name in the 2D plan, these functions replace the text with an editable buffer, capture keyboard input, and commit or cancel on Enter/Escape/click-away.

**8 functions, 2 module-level vars:**
- `let activeSvgEdit = null` (line 33)
- `let activeSvgTextEdit = null` (line 137)
- `closeSvgEdit()` — tears down numeric edit, calls onCommit
- `updateEditText()` — refreshes displayed text during numeric edit
- `startSvgEdit(el, opts)` — **public entry point** — sets up numeric inline edit
- `closeSvgTextEdit()` — tears down text edit, calls onCommit
- `updateTextEditDisplay()` — refreshes displayed text during text edit
- `startSvgTextEdit(el, opts)` — **public entry point** — sets up text inline edit
- `cancelSvgEdit()` — **public** — cancels current edit without committing
- `commitSvgEdit()` — **public** — commits current edit programmatically

**External callers confirmed:**
- `startSvgEdit`: called from `renderPlanSvg` inside render.js (lines ~2336, ~3366, ~3459, ~3598)
- `startSvgTextEdit`: called from `renderPlanSvg` inside render.js (line ~3249)
- `cancelSvgEdit`: called from main.js event handlers
- `commitSvgEdit`: called from main.js event handlers

**Neither module-level var is read outside the cluster.** `renderPlanSvg` and `renderFloorCanvas` call `startSvgEdit`/`startSvgTextEdit` but never read `activeSvgEdit`/`activeSvgTextEdit` directly. No getter functions needed.

---

## E2E Test Scenarios

These tests must be written and passing **before** the move begins. They establish behavioral lock — if they pass before and after the move, behavior is preserved.

### File: `src/svg-inline-edit.test.js`

**Scenario 1: cancelSvgEdit is safe when no edit is active**
- Call `cancelSvgEdit()` with no prior `startSvgEdit` call
- Assert: no throw, no error

**Scenario 2: startSvgEdit + cancelSvgEdit clears state**
- Create a minimal SVG text element in jsdom
- Call `startSvgEdit(el, { initialValue: "42", onCommit: () => {} })`
- Call `cancelSvgEdit()`
- Assert: onCommit was NOT called; no active edit remains (verify by calling cancelSvgEdit again — still no throw)

**Scenario 3: startSvgEdit + commitSvgEdit calls onCommit with current buffer**
- Create a minimal SVG text element
- Call `startSvgEdit(el, { initialValue: "42", onCommit: (val) => { captured = val; } })`
- Call `commitSvgEdit()`
- Assert: `captured` equals "42" (initial value committed)

**Scenario 4: startSvgTextEdit + cancelSvgEdit does not call onCommit**
- Create a minimal SVG text element
- Call `startSvgTextEdit(el, { initialValue: "Room A", onCommit: () => { called = true; }, onCancel: () => {} })`
- Call `cancelSvgEdit()` (shared cancel)
- Assert: `called` remains false

**Note:** These tests exercise state management — the core invariant this module owns. They do not test keyboard event wiring (which requires a real browser) but test the commit/cancel contract that main.js depends on.

---

## Critical Files

| File | Role |
|------|------|
| `src/render.js` | SOURCE — 8 functions and 2 vars removed, replaced with import |
| `src/svg-inline-edit.js` | NEW — receives the cluster |
| `src/main.js` | CALLER — update import of `cancelSvgEdit`, `commitSvgEdit` |
| `src/svg-inline-edit.test.js` | NEW — E2E tests for the cluster |

---

## Pre-flight (before Step 1)

1. Run `npm run test` — record exact baseline (passing count, any pre-existing failures).
2. Grep for all usages of `cancelSvgEdit` and `commitSvgEdit` in main.js — confirm no other callers exist.
3. Confirm current import line for these in main.js.

---

## Step-by-Step Implementation

### STEP 1 — Write E2E tests (before any move)

Create `src/svg-inline-edit.test.js` with the 4 scenarios above. Import from `./render.js` (the current location). Run `npm run test` — all 4 new tests must pass before any code moves.

**Why:** If the tests fail against the current code, the test design is wrong — fix tests first. This guarantees that when tests pass after the move, behavior is confirmed preserved.

**Test:** `npm run test` — baseline + 4 new tests passing.

---

### STEP 2 — Create `svg-inline-edit.js` and move the cluster

**2a.** Read render.js lines 33–230 precisely. Note the exact boundaries.

**2b.** Create `src/svg-inline-edit.js`:
- Copy lines 33–230 verbatim (the 2 module-level vars + 8 functions).
- Add `export` to: `startSvgEdit`, `startSvgTextEdit`, `cancelSvgEdit`, `commitSvgEdit`.
- `closeSvgEdit`, `updateEditText`, `closeSvgTextEdit`, `updateTextEditDisplay` are internal — do NOT export them.
- Add logging:
  ```js
  console.log(`[svg-inline-edit] startSvgEdit el=${el?.id || el?.tagName || 'anon'}`);
  console.log(`[svg-inline-edit] startSvgTextEdit el=${el?.id || el?.tagName || 'anon'}`);
  console.log(`[svg-inline-edit] cancelSvgEdit active=${activeSvgEdit != null || activeSvgTextEdit != null}`);
  console.log(`[svg-inline-edit] commitSvgEdit active=${activeSvgEdit != null || activeSvgTextEdit != null}`);
  ```
- No imports needed from render.js. Identify any imports the cluster uses (e.g., DOM APIs only — these are built-in, no imports needed).

**2c.** In `render.js`:
- Remove lines 33–230 (the 2 vars + 8 functions).
- Add at the top: `import { startSvgEdit, startSvgTextEdit, cancelSvgEdit, commitSvgEdit } from './svg-inline-edit.js';`
- The 4 internal callers in `renderPlanSvg` continue working without change — they call the same function names, now from the import.
- If `cancelSvgEdit` or `commitSvgEdit` were re-exported from render.js (check the export list), keep `export { cancelSvgEdit, commitSvgEdit }` to preserve backward compat.

**2d.** In `main.js`:
- Find the import line that pulls `cancelSvgEdit`, `commitSvgEdit` from `./render.js`.
- Change to import from `./svg-inline-edit.js` directly (or keep via render.js re-export — check which is cleaner).

**Test:** `npm run test` — full baseline + 4 new tests all passing.

---

## Logging

Log lines are listed in Step 2b. Remove them only after the user confirms that SVG inline editing (clicking dimension labels, room names) still works correctly in the running application.

---

## Backward Compatibility

- `cancelSvgEdit` and `commitSvgEdit` were exported from render.js. After the move, either re-export them from render.js or update main.js to import from `svg-inline-edit.js` directly. Check at execution time and choose the cleaner path.
- All existing tests unchanged.
- render.js line count after this: ~3775 lines (reduction of ~200).

---

## What This Plan Does NOT Cover

- `renderTilePatternForm`, `renderCommercialTab`, `renderExportTab` — NOT moved (architecture violation + circular dep risk with renderTilePatternForm).
- Internal decomposition of `renderPlanSvg` — separate plan, separate step.
- main.js refactoring — separate plan.
- Removing previously-added `console.log` instrumentation — separate cleanup pass after user confirms runtime behavior.

---

## Plan File Lifecycle

1. User approves → execution begins
2. Execution succeeds → append `## Implementation` section
3. Execution fails or abandoned → append `## Outcome: Abandoned`
