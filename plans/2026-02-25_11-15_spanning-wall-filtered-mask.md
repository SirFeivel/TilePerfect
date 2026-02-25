# Plan: Use pre-opening wallMaskFiltered for spanning wall detection

## Context

Interior spanning walls (e.g., the horizontal wall dividing the OG floor plan at y≈1930px) were not
detected by `detectSpanningWalls`. The wall clearly spans the full building width (spanFraction=0.997)
but its density was only 0.158 — far below the 0.4 threshold.

## Root Cause

`detectEnvelope` returns the **opened** wallMask (after `morphologicalOpen` with radius=5). The
opening is correct for envelope contour tracing (noise removal) but destroys thin interior wall
lines. The pre-opening `wallMaskFiltered` was saved at line 1662 but never returned or used for
spanning wall detection.

Diagnostic profiling confirmed the impact:

| Row (wall center) | Opened mask density | Filtered mask density | Filtered span |
|----|----|----|-----|
| 1930 | 0.158 | **0.829** | 1.000 |
| 1932 | 0.158 | **0.827** | 1.000 |
| 1934 | 0.158 | **0.822** | 1.000 |
| 1936 | 0.158 | **0.827** | 1.000 |
| 1938 | 0.158 | **0.827** | 1.000 |

The filtered mask preserves the wall pixels (density 0.82+), easily passing the 0.4 threshold.

## Fix

1. Return `wallMaskFiltered` from `detectEnvelope` alongside `wallMask`
2. Pass `wallMaskFiltered || wallMask` to `detectSpanningWalls` in both call sites (pass-1 and final)
3. Fix `console.log` template literal interpolation for rejection details (separate arg instead of `${}`)

## Files Modified

| File | Change |
|------|--------|
| `src/room-detection.js` | Return `wallMaskFiltered` from `detectEnvelope` |
| `src/room-detection-controller.js` | Use `wallMaskFiltered` for spanning wall detection, fix logging |

## Implementation

### Changes made

1. `detectEnvelope` now returns `wallMaskFiltered` in its result object (line 1890)
2. Both `detectSpanningWalls` calls in `detectAndStoreEnvelope` use `result.wallMaskFiltered || result.wallMask`
3. Rejection logging fixed: `r.details` passed as separate `console.log` argument to avoid `[object Object]`

### Core findings

- The morphological opening (radius=5) reduces wall pixels from 319K to 114K (64% loss)
- Interior wall lines (~2-3px drawn strokes) are completely destroyed by opening
- Floor plan walls are drawn as parallel lines with fill between — at the wall center,
  density is ~0.82 with filtered mask (wall + fill pixels), dropping to ~0.09 at edges (just line strokes)
- The existing `DENSITY_THRESHOLD=0.4` is correct for the filtered mask — no threshold change needed
- The 6-criteria validation pipeline (thickness, building width, boundary proximity, continuity,
  edge touch, thickness consistency) correctly filters outer wall candidates without any changes

### Test results

1289 tests pass (60 files, 0 failures). No new tests needed — existing spanning wall E2E tests
continue to pass (EG detects 1 H spanning wall, OG previously detected 0 and will now detect interior walls).
