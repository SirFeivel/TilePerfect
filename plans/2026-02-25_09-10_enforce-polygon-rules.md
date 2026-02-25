# Plan: Create `enforcePolygonRules()` — unified enforcement helper

## Context

The envelope post-processing pipeline calls 4 functions ad-hoc:
`rectifyPolygon → removePolygonMicroBumps → rectifyPolygon → removeStackedWalls`.
Each step can violate invariants established by previous steps. Specifically, `removeStackedWalls`
has two mechanisms that create diagonal edges:

1. **Neighbor snapping** (room-detection.js:1726-1736) — moves one endpoint of connecting edges
   when collapsing stacked pairs, leaving the other endpoint unmoved → diagonal.
2. **Cross-product collinear cleanup** (room-detection.js:1764-1765) — removes intermediate
   vertices on "nearly collinear" lines, but the resulting edge can be diagonal (the OG case:
   left-wall vertices at x=531 and x=557.7 get joined into a single edge with dx=26.7, dy=288.7).

There is **no enforcement after `removeStackedWalls`**, so diagonals survive into the stored polygon.

**Scope:** Detection pipelines only (envelope + room).

## Approach

### Step 1: Move `removePolygonMicroBumps` and `removeStackedWalls` to `floor-plan-rules.js`

These are polygon-level operations, not image detection. They only depend on `FLOOR_PLAN_RULES`
which already lives in `floor-plan-rules.js`.

**Move from:** `src/room-detection.js` (lines 1534-1634, 1657-1773)
**Move to:** `src/floor-plan-rules.js` (after `rectifyPolygon`)

**Update imports in:**
- `src/room-detection-controller.js:10` — remove from room-detection import, add to floor-plan-rules import
- `src/room-detection.test.js:20-21` — import from `floor-plan-rules.js` instead
- `src/room-detection.verify.test.js:7` — import from `floor-plan-rules.js` instead

**Re-export from `room-detection.js`** for backwards compatibility? No — rulebook says no
backwards-compat hacks. Update all importers directly.

**Run `npm run test` after this step.**

### Step 2: Create `enforcePolygonRules()` in `src/floor-plan-rules.js`

**Signature:**
```js
export function enforcePolygonRules(vertices, {
  rules = FLOOR_PLAN_RULES,
  bumpThresholdCm = null,    // null = skip bump removal
  stackedWallGapCm = null,   // null = skip stacked wall removal
  maxIterations = 3,
} = {})
```

**Logic (fixpoint loop):**
```
for iteration 1..maxIterations:
  result = rectifyPolygon(vertices, rules)
  if bumpThresholdCm != null:
    result = removePolygonMicroBumps(result, bumpThresholdCm)
    result = rectifyPolygon(result, rules)    // clean up after bumps
  if stackedWallGapCm != null:
    result = removeStackedWalls(result, stackedWallGapCm)
  // Check: all edges axis-aligned?
  stable = every edge has (dx < 1cm OR dy < 1cm)
  if stable: return result
  vertices = result  // feed back for next iteration
log warning if not converged
return rectifyPolygon(result, rules)  // final safety net
```

**Logging:** `[enforcePolygonRules] iteration {n}: {m} vertices, stable={bool}`

**Run `npm run test` after this step.**

### Step 3: Replace ad-hoc pipeline in `detectAndStoreEnvelope`

**File:** `src/room-detection-controller.js`, lines 794–813

Replace the 4 individual calls:
```js
const rectified = rectifyPolygon(finalPolygonCm, rectifyRules);
const bumped = removePolygonMicroBumps(rectified, bumpThreshold);
const reRectified = rectifyPolygon(bumped, rectifyRules);
const cleaned = removeStackedWalls(reRectified, stackedGap);
```

With:
```js
const cleaned = enforcePolygonRules(finalPolygonCm, {
  rules: rectifyRules,
  bumpThresholdCm: bumpThreshold,
  stackedWallGapCm: stackedGap,
});
```

**Run `npm run test` after this step.**

### Step 4: Use `enforcePolygonRules` in room confirmation (`confirmDetection`)

**File:** `src/room-detection-controller.js`, line 389

Replace:
```js
const rectifiedGlobal = rectifyPolygon(_detectedPolygonCm, rules);
```
With:
```js
const rectifiedGlobal = enforcePolygonRules(_detectedPolygonCm, { rules });
```

**Run `npm run test` after this step.**

### Step 5: Unit tests for `enforcePolygonRules`

**File:** `src/floor-plan-rules.test.js`

1. Simple rectangle → passes through unchanged
2. Polygon with post-stacked-wall diagonal → comes out axis-aligned
3. Null bump/stacked options → only rectification runs
4. Converges within maxIterations

**Run `npm run test` after this step.**

### Step 6: E2E test with OG-like data

**File:** `src/room-detection.verify.test.js`

Use the 36-edge polygon from the OG console log as input to `enforcePolygonRules`
with bump and stacked wall thresholds matching the OG values (medianCm ≈ 29.6).
Assert: output has no diagonal edges (every edge dx < 1 or dy < 1).

**Run `npm run test` after this step.**

---

## Files modified

| File | Change |
|------|--------|
| `src/floor-plan-rules.js` | Move in `removePolygonMicroBumps` + `removeStackedWalls`, add `enforcePolygonRules` |
| `src/room-detection.js` | Remove `removePolygonMicroBumps` + `removeStackedWalls` |
| `src/room-detection-controller.js` | Update imports, replace 2 ad-hoc pipelines with `enforcePolygonRules` |
| `src/room-detection.test.js` | Update imports |
| `src/room-detection.verify.test.js` | Update imports, add E2E test |
| `src/floor-plan-rules.test.js` | Add unit tests for `enforcePolygonRules` |

## Plan Scorecard

### Hacky (0 = duct tape, 10 = clean)

0→1: Solves root cause (no enforcement after destructive steps) rather than patching.
1→2: Single function replaces 4 ad-hoc calls — one source of truth.
2→3: Fixpoint loop handles any future steps that might also violate invariants.
3→4: Lives in correct module (`floor-plan-rules.js`).
4→5: Uses existing functions, no logic duplication.
5→6: Clean API with optional params for reuse across both pipelines.
6→7: Fallback (final rectify if not converged) prevents silent violations.
7→8: Moving bump/stacked functions to their natural home (polygon rules, not image detection).

**Score: 8**

### Compliance (0 = violates everything, 10 = textbook)

0→1: Uses existing APIs (`rectifyPolygon`, `removePolygonMicroBumps`, `removeStackedWalls`).
1→2: One source of truth for enforcement — no inline reimplementation.
2→3: Correct layer: polygon rules in `floor-plan-rules.js`.
3→4: No scope creep — enforcement wrapper only, no changes to individual function internals.
4→5: One change at a time, test after each step.
5→6: Meaningful logging with `[enforcePolygonRules]` tag.
6→7: E2E test with real data (OG polygon).
7→8: Plan stored as new file.

**Score: 8**

### Complexity (0 = extremely complex, 10 = minimal)

0→1: No new data structures or concepts — wrapping existing calls.
1→2: Fixpoint loop bounded at 3 iterations, typically converges in 1.
2→3: Function signature is straightforward with optional params.
3→4: Replacing 4 ad-hoc calls with 1 call reduces call-site complexity.
4→5: Axis-alignment check is trivial (dx < 1 or dy < 1 per edge).
5→6: Import changes are mechanical.
6→7: No backwards-compat shims — clean break.

**Score: 7**

### Problem Understanding (0 = guessing, 10 = fully mapped)

0→1: Read full `rectifyPolygon` (floor-plan-rules.js:254-473) — 5-step process, Step 5 snaps diagonals.
1→2: Read full `removePolygonMicroBumps` (room-detection.js:1534-1634) — snaps D to A coord, 1.0cm collinear merge.
2→3: Read full `removeStackedWalls` (room-detection.js:1657-1773) — neighbor snapping + cross-product collinear cleanup.
3→4: Read envelope pipeline (controller:794-813) — 4 calls, no enforcement after last.
4→5: Read room pipeline (controller:389) — only `rectifyPolygon`, no bump/stacked.
5→6: Read `extendSkeletonForRoom` (envelope.js:444-526) — identified as another violation source (scoped out).
6→7: Confirmed OG failure: `removeStackedWalls` cross-product collinear cleanup joins x=531 and x=557.7 vertices.
7→8: Verified `rectifyPolygon` cannot create new bumps/stacked walls — fixpoint converges.

**Score: 8**

### Confidence (0 = hope, 10 = certain)

0→1: The OG diagonal (dx=26.7, dy=288.7) — `rectifyPolygon` Step 5 snaps this to V.
1→2: `rectifyPolygon` is well-tested (10+ unit tests).
2→3: Fixpoint guarantees convergence or explicit fallback.
3→4: 1282 existing tests catch regressions.
4→5: Call-site replacements are mechanical.
5→6: Both functions' only dependency is `FLOOR_PLAN_RULES` — clean move.
6→7: All importers identified (3 source files + 2 test files).

**Score: 7**

## Verification

1. `npm run test` passes after each step (1282+ tests)
2. New unit tests verify diagonal cleanup via `enforcePolygonRules`
3. E2E test with OG 36-edge polygon confirms no diagonal edges in output
4. Existing EG envelope tests still pass (no regression)

## Implementation

**All 6 steps executed successfully in order.**

### What was done:
1. Moved `removePolygonMicroBumps` and `removeStackedWalls` from `room-detection.js` to `floor-plan-rules.js`. Fixed orphaned JSDoc comment that broke `detectRoomAtPixel` export.
2. Created `enforcePolygonRules()` with fixpoint loop, axis-alignment check, and final rectify fallback.
3. Replaced 4-call ad-hoc pipeline in `detectAndStoreEnvelope` with single `enforcePolygonRules` call.
4. Replaced `rectifyPolygon` in `confirmDetection` with `enforcePolygonRules`.
5. Added 5 unit tests for `enforcePolygonRules`.
6. Added 2 E2E tests using OG 36-edge polygon data.

### Core findings:
- The OG polygon converges in iteration 2: iteration 1 runs the full pipeline (rectify+bumps+stacked), stacked wall removal introduces a diagonal, iteration 2 re-rectifies and the result is stable.
- The orphaned JSDoc from the function move silently swallowed `detectRoomAtPixel` inside a comment block, causing 14 test failures — caught immediately by running tests after the move.

### Test results:
1289 tests pass (60 files, 0 failures). 7 new tests added.
