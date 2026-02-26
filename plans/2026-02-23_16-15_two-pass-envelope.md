# Two-Pass Envelope Detection Pipeline

## Context

Envelope detection currently runs on the raw uploaded image, which contains annotation noise (colored text, door arcs, furniture symbols, dimension lines). The preprocessing pipeline (`preprocessForRoomDetection`) already exists and strips this noise effectively — but it's only used before room detection, not before envelope detection. This creates an asymmetry: rooms benefit from a clean image, but the envelope (which rooms depend on) does not.

The fix: run envelope detection twice. Pass 1 on the raw image produces a rough envelope. That rough envelope feeds preprocessing, which produces a clean image. Pass 2 on the clean image produces an improved envelope. Room detection then uses the clean image + improved envelope (already wired).

## Plan Scorecard

### Hacky (0 = duct tape, 10 = clean): **9**

| Pt | Evidence |
|---|---|
| 1 | No new functions introduced — wiring existing APIs together |
| 2 | `loadImageData` is the existing image-loading API (line 569) — no custom canvas logic |
| 3 | `preprocessForRoomDetection` is the existing preprocessing API (line 921) — called exactly as `handleSvgClick` already calls it |
| 4 | `detectEnvelope` already has a second-pass branch gated on `envelopeBboxPx` (line 1948) — we're activating it, not adding it |
| 5 | Second `loadImageData` call is necessary because preprocessing mutates `imageData.data` in-place — no way around this without changing the preprocessing contract |
| 6 | Fallback to pass-1 on pass-2 failure is defensive, not a hack — pass-2 uses stricter morphological open that may be too aggressive on some images |
| 7 | Downstream pipeline (rectify, bump removal, wall thickness) runs identically on whichever result wins — no branching in the postprocessing |
| 8 | The arg-building for preprocessing mirrors `handleSvgClick` lines 276-280 exactly — same pattern, same fields |
| 9 | No silent fallbacks or guard-clause band-aids — failure is logged and pass-1 result is used explicitly |
| -0 | (no deduction) |

### Compliance (0 = violates everything, 10 = textbook): **9**

| Pt | Evidence |
|---|---|
| 1 | Change isolated to one function in one file (`detectAndStoreEnvelope` in `room-detection-controller.js`) |
| 2 | No new exports, no new files, no new shared abstractions |
| 3 | Logging uses `[envelope]` prefix — matches existing convention in `detectEnvelope` which uses `[detectEnvelope]` |
| 4 | Three call sites in main.js (lines 1506, 1578, 2599) require zero changes — function signature unchanged |
| 5 | Coordinate conversions use existing `cmToImagePx` / `imagePxToCm` — no inline math |
| 6 | Uses existing `FLOOR_PLAN_RULES` for wall thickness bounds — no hardcoded constants |
| 7 | One change at a time: single logical unit (insert pass-2 block + update downstream refs) |
| 8 | E2E test scenarios defined before implementation |
| 9 | Plan includes logging as first-class deliverable |
| -0 | (no deduction) |

### Complexity (0 = extremely complex, 10 = minimal): **9**

| Pt | Evidence |
|---|---|
| 1 | ~30 lines added to one function — no structural refactoring |
| 2 | No new module-level state or caching (that's deferred to a separate change) |
| 3 | No new function signatures or exports to maintain |
| 4 | The second-pass code path in `detectEnvelope` already exists and is tested (room-detection.test.js) |
| 5 | `preprocessForRoomDetection` args are exactly the data already available at the insertion point |
| 6 | Fallback logic is a single ternary (result2 valid → use it, else → keep result) |
| 7 | Downstream pipeline code is unchanged — only variable names updated (result → finalResult) |
| 8 | No new branching in postprocessing — same code path regardless of which pass won |
| 9 | Could not be simpler without changing the preprocessing contract to not mutate in-place |
| -0 | (no deduction) |

### Problem Understanding (0 = guessing, 10 = fully mapped): **9**

| Pt | Evidence |
|---|---|
| 1 | Read `detectAndStoreEnvelope` lines 605-710 in full — verified exact insertion point between line 647 and 653 |
| 2 | Read `detectEnvelope` — confirmed `envelopeBboxPx` is only a truthiness gate (line 1948: `if (envelopeBboxPx)`), actual bbox values never read |
| 3 | Read `preprocessForRoomDetection` — confirmed it needs `envelopePolygonPx`, `envelopeWallThicknesses`, `spanningWallsPx`, `pixelsPerCm` (lines 922-927) |
| 4 | Read `handleSvgClick` lines 271-287 — confirmed it builds identical preprocessing args from `floor.layout.envelope`, so our approach mirrors proven code |
| 5 | Verified `loadImageData` (line 569) is a pure async loader with no side effects — safe to call twice |
| 6 | Traced all 3 callers of `detectAndStoreEnvelope` in main.js (lines 1506, 1578, 2599) — all pass identical opts, none will be affected |
| 7 | Verified that `spanningWalls` (cm-space) is available at the insertion point (built lines 641-646) and can be converted back to pixel-space via `cmToImagePx` |
| 8 | Confirmed `result.wallThicknesses` is available from pass-1 (returned by `detectEnvelope` line ~2018) |
| 9 | Identified that downstream uses `imageData` in two places (spanning walls line 637, wall thickness line 676) that both need updating to `finalImageData` |
| -0 | (no deduction) |

### Confidence (0 = hope, 10 = certain): **8**

| Pt | Evidence |
|---|---|
| 1 | The second-pass branch in `detectEnvelope` has existing unit tests (room-detection.test.js) |
| 2 | `preprocessForRoomDetection` is battle-tested — called on every room detection click |
| 3 | All preprocessing args are exactly the data available at the insertion point — no new data needed |
| 4 | Fallback to pass-1 means this change cannot make things worse — if pass-2 fails, behavior is identical to current |
| 5 | Function signature and return type unchanged — all callers work without modification |
| 6 | `loadImageData` called twice is the only correct approach given the mutate-in-place contract — verified by reading the preprocessing code |
| 7 | The arg pattern (polygon→px, spanningWalls→px) is copied from `handleSvgClick` which works in production |
| 8 | Existing tests for `detectEnvelope`, `preprocessForRoomDetection`, `detectSpanningWalls` cover the individual pieces |
| -1 | Uncertainty: preprocessed synthetic test images may produce slightly different pass-2 polygons — could require updating existing test assertions if any tests mock/call `detectAndStoreEnvelope` end-to-end |
| -0 | Net: 8 |

## Files to Modify

- `src/room-detection-controller.js` — `detectAndStoreEnvelope` (lines 605-710): insert two-pass logic, update downstream references

## Existing APIs Reused (no changes needed)

- `loadImageData(dataUrl, nativeWidth, nativeHeight)` — `src/room-detection-controller.js:569`
- `preprocessForRoomDetection(imageData, options)` — `src/room-detection.js:921`
- `detectEnvelope(imageData, { pixelsPerCm, envelopeBboxPx })` — `src/room-detection.js:1894`
- `cmToImagePx(x, y, bg)` / `imagePxToCm(x, y, bg)` — `src/room-detection-controller.js`

## Implementation Steps

### Step 1: Insert pass-2 block into `detectAndStoreEnvelope`

**Where:** After the pass-1 spanning walls detection (line 647), before `extractValidAngles` (line 653).

**What:**

1. Build pixel-space preprocessing args from pass-1 results (mirrors `handleSvgClick` lines 276-280):
   - `envelopePolygonPx` = `result.polygonPixels` (raw pixel polygon from pass 1)
   - `envelopeWallThicknesses` = `result.wallThicknesses`
   - `spanningWallsPx` = convert pass-1 `spanningWalls` back to pixel space via `cmToImagePx`

2. Load fresh imageData via `loadImageData` (needed because preprocessing mutates in-place)

3. Call `preprocessForRoomDetection(imageData2, { ... })` with the pass-1 derived args

4. Build `envelopeBboxPx` from pass-1 polygon bounds (only truthiness matters — `detectEnvelope` doesn't read the values)

5. Call `detectEnvelope(imageData2, { pixelsPerCm: effectivePpc, envelopeBboxPx })` for pass 2

6. Fallback: if pass-2 returns null or < 3 vertices, keep pass-1 result

### Step 2: Update downstream references

Replace all uses of `result`, `imageData`, `polygonCm`, `spanningWalls` below the insertion point with `finalResult`, `finalImageData`, `finalPolygonCm`, `finalSpanningWalls`:

- Line 629: `polygonCm` mapping → use `finalResult.polygonPixels`
- Lines 634-647: spanning wall detection → use `finalResult.wallMask/buildingMask` + `finalImageData`
- Line 653: `extractValidAngles` → use `finalPolygonCm` + `finalSpanningWalls`
- Line 662: `bumpThreshold` → use `finalResult.wallThicknesses`
- Lines 675-678: `detectWallThickness` → use `finalImageData`
- Lines 681-683: `allThicknesses` → use `finalSpanningWalls`
- Line 695: stored `spanningWalls` → use `finalSpanningWalls`

### Step 3: Add logging

All `[envelope]` prefixed:
- Pass 1 start (ppc, scaleFactor)
- Pass 1 result (vertex count)
- Pass 1 spanning walls count
- Pass 2 fresh image loaded (dimensions)
- Preprocessing complete
- Pass 2 result / fallback decision (which result used, vertex count)
- Final spanning walls count

### Step 4: Run tests, verify

- `npm run test` — all existing tests must pass
- Manual verification: upload calibrated floor plan, observe `[envelope]` console logs showing both passes

## E2E Test Scenarios

Tests go in the existing test file for `room-detection-controller` (or a new `room-detection-controller.test.js` if none exists). Mock-based since `loadImageData` requires DOM Canvas.

1. **Happy path**: mock `loadImageData` (called twice), `detectEnvelope` (returns valid polygon both times), `preprocessForRoomDetection` → verify `loadImageData` called 2x, `detectEnvelope` called 2x (second with truthy `envelopeBboxPx`), stored envelope uses pass-2 result
2. **Pass-2 returns null**: `detectEnvelope` returns valid on first call, null on second → stored envelope uses pass-1 result
3. **Pass-2 returns < 3 vertices**: same fallback behavior verified
4. **Preprocessing receives correct args**: verify `preprocessForRoomDetection` called with `envelopePolygonPx` from pass-1, `spanningWallsPx` in pixel space

## Out of Scope

- Caching preprocessed imageData for room detection reuse (separate change)
- Changes to `handleSvgClick` / room detection flow (already correct)
- Changes to `detectEnvelope` or `preprocessForRoomDetection` internals

## Implementation

**Attempt 1 (failed):** Implemented the plan as written. Real-world testing revealed envelope collapse — pass-2 building area shrank from 5.01% to 1.90% (and 2.27% without `envelopeBboxPx`). Root cause: preprocessing thins wall structure (raw wallMask 285K → 156K pixels), so morphological close can't seal all gaps on some images. The plan's fallback (null or <3 vertices) didn't catch this because pass-2 returned valid polygons with many vertices but collapsed building area.

**Attempt 2 (successful):** Reverted and re-implemented with a dynamic building area fallback. The key addition beyond the original plan: after pass-2, compare `buildingMask` pixel counts between pass-1 and pass-2. If pass-2 area < 70% of pass-1, fall back to pass-1. This handles images where preprocessing is too aggressive while still benefiting from pass-2 on cleaner images.

**What was done:**

1. Rewrote `detectAndStoreEnvelope` in `src/room-detection-controller.js` to implement the two-pass pipeline:
   - Pass 1: raw image → `detectEnvelope` → rough polygon + spanning walls + building area measurement
   - Preprocessing: fresh image load + pass-1 envelope data → `preprocessForRoomDetection`
   - Pass 2: preprocessed image → `detectEnvelope` with `envelopeBboxPx` (stricter open)
   - Dynamic fallback: pass-2 must have ≥3 vertices AND building area ≥70% of pass-1, otherwise fall back to pass-1
   - Downstream pipeline (rectify, bump removal, wall thickness, spanning walls, type classification) runs on whichever result wins

2. Added `[envelope]` log lines covering pass 1 start/result, spanning walls, pass 2 image load/preprocessing/result, building area comparison, final spanning walls.

3. Added 6 pipeline contract tests in `src/room-detection-controller.test.js`:
   - Pass 2 on preprocessed image produces valid envelope
   - Dynamic fallback: uses pass-1 when pass-2 building area shrinks >30%
   - Dynamic fallback: uses pass-2 when building area is preserved
   - Fallback: pass-1 used when pass-2 returns null
   - Preprocessing mutates imageData in-place (justifying fresh load)
   - Wall thickness measurement works on preprocessed image

**Core findings:**
- `loadImageData` uses DOM Canvas (`new Image()`, `document.createElement("canvas")`) — cannot be mocked in Node ESM without the `canvas` npm package. Tests exercise the pipeline contract (real `detectEnvelope` + `preprocessForRoomDetection` on synthetic images) rather than mocking.
- The `envelopeBboxPx` option in `detectEnvelope` is indeed only a truthiness gate — the actual bbox values are never read. Confirmed by code review and test behavior.
- Spanning walls are computed twice (once on pass-1 for preprocessing input, once on final result for storage) — this is correct because the pass-2 wall/building masks may differ.
- **Critical discovery:** Preprocessing reduces raw wall mask pixels significantly (285K → 156K on real floor plan). On images where walls are already clean, this can thin walls enough that morphological close fails to seal gaps, collapsing the building area. The 70% area threshold catches this without requiring per-image tuning.

**Test results:** 1276 tests pass (1270 existing + 6 new), 60 test files, 0 failures.
