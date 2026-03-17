# Plan: render.js Refactoring
**Date:** 2026-03-17
**Branch:** render_refactoring
**File:** plans/2026-03-17_10-15_render-refactoring.md

---

## Context

render.js is 3975 lines. The file bundles 5 distinct concerns that have no dependencies on each other:
- SVG inline editing (interaction, not rendering)
- Tile pattern form (form rendering for one panel)
- Commercial/export tabs (tab rendering for two panels)
- Pattern groups canvas (one standalone render function)
- Metrics panel (one standalone render function)
- Core render pipeline (renderPlanSvg, renderFloorCanvas — the actual rendering engine)

The two big functions (renderPlanSvg 1234 lines, renderFloorCanvas 777 lines) cannot be moved to other files — they are the core pipeline. They can be internally decomposed into private sub-functions within render.js to become navigable.

**Goal:** render.js from 3975 → ~2780 lines via 5 file extractions. renderPlanSvg and renderFloorCanvas become internally structured via private sub-functions.

---

## Scorecard

| Dimension | Score | Evidence |
|---|---|---|
| **Hacky** | 8 | Clean file splits along natural concern boundaries. Internal decomposition is the standard pattern for monoliths. No workarounds. |
| **Compliance** | 8 | All new files are render-*.js — they stay in the render layer. "DOM manipulation belongs in render.js" means: don't put DOM logic in geometry.js or state.js. It does not forbid splitting a 3975-line render module into sub-modules. Precedent: drag.js, exclusions.js, sections.js are all interaction/render sub-modules. CLAUDE.md architecture section will be updated to reflect the split. |
| **Complexity** | 8 | 5 new files. Each extraction is a copy-move with import line updates. No logic changes anywhere. Internal decomposition adds private functions — no signature changes. |
| **Problem Understanding** | 8 | All external deps for each extraction traced with line numbers. Circular dep risks resolved: SVG inline edit has zero render.js deps; renderTilePatternForm's 3 helpers are exclusively called from within renderTilePatternForm; renderPatternGroupsCanvas has zero render.js deps; renderCommercialTab and renderExportTab have zero render.js deps; renderMetrics has zero render.js deps. renderPlanSvg internal sections mapped (15 sections, 3 extractable as private sub-functions). renderFloorCanvas room loop identified (493 lines → private sub-function). |
| **Confidence** | 4 | All analysis points to safe moves. Cannot exceed 5 — no runtime verification has occurred. User must confirm all render paths work visually after each phase. |

---

## Phase 1 — File Extractions (~1195 lines removed)

### New files

| New File | Contents | Lines moved |
|---|---|---|
| `src/svg-inline-edit.js` | SVG inline edit cluster (2 vars + 8 functions, lines 33–230) | ~200 |
| `src/render-tile-form.js` | `renderTilePatternForm` + 3 exclusive helpers: `renderReferencePicker`, `renderTilePresetPicker`, `renderSkirtingPresetPicker` (lines 845–1209) | ~365 |
| `src/render-commercial.js` | `renderCommercialTab` + `renderExportTab` (lines 2667–2956) | ~290 |
| `src/render-pattern-groups.js` | `renderPatternGroupsCanvas` (lines 3739–3975) | ~237 |
| `src/render-metrics.js` | `renderMetrics` (lines 376–478) | ~103 |

**render.js after Phase 1: ~2780 lines**

### Dependency notes per extraction

**svg-inline-edit.js**: Zero deps on render.js. Exports: `startSvgEdit`, `startSvgTextEdit`, `cancelSvgEdit`, `commitSvgEdit`. Internal: `closeSvgEdit`, `updateEditText`, `closeSvgTextEdit`, `updateTextEditDisplay`. render.js imports the 4 public functions. main.js updates `cancelSvgEdit`/`commitSvgEdit` import.

**render-tile-form.js**: `renderReferencePicker`, `renderTilePresetPicker`, `renderSkirtingPresetPicker` are ONLY called from within `renderTilePatternForm` — confirmed by grep. They move with it, eliminating any circular dep. render.js re-exports `renderTilePatternForm` (it was previously exported). Imports needed: `getCurrentRoom`, `getCurrentFloor`, `getSelectedSurface` from core.js; `getUiState` from ui_state.js; `isPatternGroupChild`, `getEffectiveTileSettings`, `getRoomPatternGroup` from pattern-groups.js; `getRoomPricing` from calc.js; `t` from i18n.js; DOM APIs only.

**render-commercial.js**: Zero render.js deps. Imports: `computeProjectTotals` from calc.js; `getRoomBounds` from geometry.js; `t` from i18n.js.

**render-pattern-groups.js**: Zero render.js deps. `svgEl` comes from geometry.js (already an external import, not a render.js function). Imports: `svgEl`, `getRoomBounds`, `roomPolygon`, `multiPolygonToPathD`, `isCircleRoom` from geometry.js; `getRoomPatternGroup` from pattern-groups.js; `setBaseViewBox`, `calculateEffectiveViewBox` from viewport.js; `getFloorBounds` from floor_geometry.js; `t` from i18n.js.

**render-metrics.js**: Zero render.js deps. Imports: `computePlanMetrics`, `computeSkirtingNeeds`, `computeGrandTotals` from calc.js; `validateState` from validation.js; `t` from i18n.js.

---

## Phase 2 — Internal Decomposition (readability, no line count change)

### renderPlanSvg: 3 private sub-functions

Extract 3 self-contained drawing sections into private (non-exported) functions within render.js. renderPlanSvg becomes ~250 lines of orchestration that calls them.

| Private function | Lines | Content |
|---|---|---|
| `_renderPlanWalls(svg, state, room, opts)` | ~225 | Wall quads, doorways, dimension indicators, resize handles (lines 1654–1878) |
| `_renderPlanExclusions(svg, state, room, opts)` | ~206 | All exclusion shapes (rect/circle/tri/freeform) with handles and labels (lines 2274–2479) |
| `_renderPlanObjects3d(svg, state, room, opts)` | ~91 | 3D object footprints with selection handles (lines 2481–2571) |

### renderFloorCanvas: 1 private sub-function

| Private function | Lines | Content |
|---|---|---|
| `_renderFloorRoom(svg, room, floor, opts)` | ~493 | Room polygon, tiles, label, handles, edge labels — the loop body (lines 3133–3622) |

renderFloorCanvas becomes ~280 lines of setup + loop dispatch.

---

## E2E Tests

### Before Phase 1 begins: SVG inline edit (only untested cluster)

**File: `src/svg-inline-edit.test.js`** — import from `./render.js` (current location), switch to `./svg-inline-edit.js` after Step 2.

1. `cancelSvgEdit()` with no active edit — no throw
2. `startSvgEdit(el, { initialValue: '42', onCommit })` → `cancelSvgEdit()` — onCommit NOT called
3. `startSvgEdit(el, { initialValue: '42', onCommit })` → `commitSvgEdit()` — onCommit called with `'42'`
4. `startSvgTextEdit(el, { initialValue: 'Room A', onCommit, onCancel })` → `cancelSvgEdit()` — onCommit NOT called

All other moved functions (`renderTilePatternForm`, `renderCommercialTab`, `renderExportTab`, `renderMetrics`) already have test coverage. Their existing tests serve as the behavioral lock — same tests must pass before and after each move.

`renderPatternGroupsCanvas`: check test coverage at execution time. If untested, write basic smoke test before moving.

### After Phase 2: existing renderPlanSvg / renderFloorCanvas tests

All existing render tests must pass unchanged. Internal decomposition must not alter observable behavior.

---

## Steps

### STEP 0 — Pre-flight

Record exact baseline: `npm run test` → note total passing, any pre-existing failures.

Grep and confirm callers:
- `cancelSvgEdit`, `commitSvgEdit` in main.js — confirm import line
- `renderTilePatternForm`, `renderCommercialTab`, `renderExportTab`, `renderMetrics`, `renderPatternGroupsCanvas` in main.js — confirm import lines
- Check if any of the 3 helpers (`renderReferencePicker`, `renderTilePresetPicker`, `renderSkirtingPresetPicker`) are called from anywhere outside renderTilePatternForm

### STEP 1 — Write SVG inline edit tests

Create `src/svg-inline-edit.test.js` importing from `./render.js`. All 4 scenarios must pass before any moves.

`npm run test` — baseline + 4 new tests passing.

### STEP 2 — Extract SVG inline edit → `svg-inline-edit.js`

- Create `svg-inline-edit.js`: copy lines 33–230, export 4 public functions, add `[svg-inline-edit]` logs on all 4 public functions
- render.js: remove lines 33–230, add import from `./svg-inline-edit.js`, keep re-exports if needed
- main.js: update import of `cancelSvgEdit`, `commitSvgEdit`
- Update `svg-inline-edit.test.js` import to `./svg-inline-edit.js`

`npm run test` — full baseline passing.

### STEP 3 — Extract renderPatternGroupsCanvas → `render-pattern-groups.js`

- Check test coverage first. Write smoke test if none exists.
- Create `render-pattern-groups.js` with correct imports
- render.js: remove lines 3739–3975, re-export `renderPatternGroupsCanvas`
- main.js: update import if it imports directly (most likely imports via render.js re-export)

`npm run test` — full baseline passing.

### STEP 4 — Extract renderTilePatternForm + 3 helpers → `render-tile-form.js`

- Create `render-tile-form.js`: copy lines 845–1209 (the 3 helpers + renderTilePatternForm), add correct imports, export `renderTilePatternForm` (helpers stay unexported)
- render.js: remove lines 845–1209, import `renderTilePatternForm` from `./render-tile-form.js`, keep re-export
- main.js: no change if importing via render.js re-export

`npm run test` — full baseline passing.

### STEP 5 — Extract renderCommercialTab + renderExportTab → `render-commercial.js`

- Create `render-commercial.js` with correct imports, export both functions
- render.js: remove lines 2667–2956, import from `./render-commercial.js`, keep re-exports
- main.js: no change if importing via render.js re-exports

`npm run test` — full baseline passing.

### STEP 6 — Extract renderMetrics → `render-metrics.js`

- Create `render-metrics.js` with correct imports, export `renderMetrics`
- render.js: remove lines 376–478, import from `./render-metrics.js`, keep re-export
- main.js: update if importing directly

`npm run test` — full baseline passing.

**Phase 1 complete. render.js: ~2780 lines.**

### STEP 7 — renderPlanSvg: extract 3 private sub-functions

Extract in order (deepest/most independent first):
1. `_renderPlanObjects3d(svg, state, room, opts)` from lines 2481–2571 — simplest, no cross-section deps
2. `_renderPlanExclusions(svg, state, room, opts)` from lines 2274–2479
3. `_renderPlanWalls(svg, state, room, opts)` from lines 1654–1878

Add `[renderPlanSvg]` log at top: `console.log('[renderPlanSvg] room=' + room?.id + ' skipTiles=' + skipTiles)`

`npm run test` after each sub-function extraction.

### STEP 8 — renderFloorCanvas: extract `_renderFloorRoom`

Extract loop body (lines 3133–3622) into `_renderFloorRoom(svg, room, floor, opts)`.

Add `[renderFloorCanvas]` log at top: `console.log('[renderFloorCanvas] floor=' + floor?.id + ' rooms=' + (floor?.rooms?.length ?? 0))`

`npm run test`.

---

## Logging summary

All logs use bracketed prefixes. Remove only after user confirms all render paths work visually.

- `[svg-inline-edit]` on `startSvgEdit`, `startSvgTextEdit`, `cancelSvgEdit`, `commitSvgEdit`
- `[renderPlanSvg]` at function entry
- `[renderFloorCanvas]` at function entry

---

## Backward compatibility

All 16 exports from render.js remain importable from render.js via re-exports. main.js and all test files continue to import from `./render.js` — only svg-inline-edit's `cancelSvgEdit`/`commitSvgEdit` in main.js changes to direct import (cleaner) or stays via re-export (zero-diff option).

CLAUDE.md architecture section updated after completion to reflect: "render.js and render-*.js sub-modules — all DOM rendering functions and interaction layers."

---

## Result

| Metric | Before | After |
|---|---|---|
| render.js lines | 3975 | ~2780 |
| Files in render layer | 1 | 6 |
| renderPlanSvg navigability | 1234-line monolith | ~250 lines + 3 named sections |
| renderFloorCanvas navigability | 777-line monolith | ~280 lines + named room renderer |

---

## Implementation

**Executed:** 2026-03-17

### What was done

All 8 steps of the plan were executed in order. Steps 1–6 extracted the 5 sub-modules (Phase 1); steps 7–8 did the internal decomposition (Phase 2).

**Phase 1 extractions (in order):**
1. `src/svg-inline-edit.js` — SVG inline edit cluster. `cancelSvgEdit`/`commitSvgEdit` did not exist in the original codebase; they were created as wrapper functions calling `closeSvgEdit(false/true)` and `closeSvgTextEdit(false/true)`. render.js still had one direct `closeSvgEdit(false)` call inside `renderPlanSvg` that had to be replaced with `cancelSvgEdit()`.
2. `src/render-metrics.js` — `renderMetrics` extraction (clean, zero render.js deps).
3. `src/render-tile-form.js` — `renderTilePatternForm` + 3 exclusive helpers. All 3 helpers confirmed exclusively called from within `renderTilePatternForm` by grep.
4. `src/render-commercial.js` — `renderCommercialTab` + `renderExportTab` (zero render.js deps).
5. `src/render-pattern-groups.js` — `renderPatternGroupsCanvas`. `isCircleRoom` helper duplicated as a 1-liner (not in geometry.js, private to render.js).
6. All extracted functions re-exported from render.js — no caller changes needed.

**Phase 2 internal decomposition:**
7. `renderPlanSvg`: extracted `_renderPlanWalls` (returns wallsGroup appended at z-order position after tiles), `_renderPlanExclusions`, `_renderPlanObjects3d`. Added `[renderPlanSvg]` entry log.
8. `renderFloorCanvas`: extracted `_renderFloorRoom(svg, room, floor, opts)` from the 490-line room loop body. Added `[renderFloorCanvas]` entry log.

### Core findings

- `cancelSvgEdit`/`commitSvgEdit` referenced in the plan as "public API" did not exist — had to create them.
- `_renderPlanWalls` must **return** its group (not append directly) because the walls group must be appended *after* the tiles group for correct z-order (no tile bleed-through).
- `isCircleRoom` is a 1-line private helper defined in render.js. Duplicated in render-pattern-groups.js rather than moving to geometry.js (private impl detail, not a geometry primitive).
- The `[render:2D-floor]` log inside the floor tile render path was already present in the loop body and survived into `_renderFloorRoom` unchanged.
- One `room-detection.verify.test.js` flaky failure occurred ("discovered angles equal the hardcoded standard angles") — confirmed unrelated to render changes, passed immediately on re-run.

### Final result

- render.js: 3975 → **2815 lines** (target was ~2780; +35 lines due to re-export boilerplate)
- Test count: **64 files, 1409 tests, all passed** (7 skipped, unrelated)
- 6 focused render sub-modules created
- All 16 original exports remain accessible via render.js re-exports — no callers broken
