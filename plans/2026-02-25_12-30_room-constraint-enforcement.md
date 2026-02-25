# Plan: Constrain detected room polygons to structural boundaries

## Problem Statement

When rooms are detected from floor plan images, their edges do not align with the envelope inner faces or spanning wall faces. The current pipeline detects polygons via flood fill, rectifies them to axis-aligned, then **translates** the room (via `alignToEnvelope` and `alignToExistingRooms`) — but never **reshapes** the polygon to fit within structural constraints.

This means a room that is detected as 416.4cm wide when only 413.6cm of space is available will always overshoot one boundary, regardless of how it's translated.

## Evidence: KG Floor Plan State Analysis

**Envelope**: Rectangle (647.2, 992.1) → (1643, 1845.4)
- Wall thicknesses: edge 0=31.1, edge 1=29.4, edge 2=29.8, edge 3=31.4 cm
- Inner faces: left=678.6, top=1023.2, right=1613.6, bottom=1815.6
- Spanning wall: H at y=1425.7, thickness=25.1cm → upper face=1413.15, lower face=1438.25

**5 detected rooms with constraint violations:**

| Room | Edge | Actual | Target boundary | Error |
|------|------|--------|-----------------|-------|
| Room 1 (dd3d) | left=678.6 | Envelope left inner=678.6 | 0.0 cm ✓ |
| Room 1 (dd3d) | top=1023.2 | Envelope top inner=1023.2 | 0.0 cm ✓ |
| Room 1 (dd3d) | bottom=1415.4 | Spanning wall upper face≈1413.15 | +2.25 cm ✗ |
| Room 2 (4234) | top=1020.9 | Envelope top inner=1023.2 | -2.3 cm ✗ |
| Room 2 (4234) | right=1616.4 | Envelope right inner=1613.6 | +2.8 cm ✗ |
| Room 2 (4234) | bottom=1415.4 | Spanning wall upper face≈1413.15 | +2.25 cm ✗ |
| Room 3 (af11) | top=1439.4 | Spanning wall lower face≈1438.25 | +1.15 cm ✗ |
| Room 3 (af11) | bottom=1820.1 | Envelope bottom inner=1815.6 | +4.5 cm ✗ |
| Room 5 (9703) | right=1616.4 | Envelope right inner=1613.6 | +2.8 cm ✗ |
| Room 5 (9703) | top=1439.4 | Spanning wall lower face≈1438.25 | +1.15 cm ✗ |

Errors range from 1.15 to 4.5 cm. All rooms that touch the right/bottom envelope edges or the spanning wall have misaligned edges.

## Root Cause Analysis

### What room detection is based on (data layer)

`detectRoomAtPixel()` (room-detection.js:1516-1614) operates **purely on the raster image**:
1. Builds a binary wall mask from the image (gray-range detection or threshold fallback)
2. Applies morphological close to seal door gaps
3. Flood-fills from the user's click point — the fill stops at wall pixels
4. Traces the contour of the filled region
5. Simplifies with Douglas-Peucker and snaps edges

**No structural data is used.** The flood fill boundary depends on where wall pixels are in the image, which may correspond to the outer face, inner face, centerline, or anywhere within the wall thickness. Different walls in the same image may be drawn differently.

### Why alignment-by-translation fails

`alignToEnvelope()` (envelope.js:720-827) computes the **best single (deltaX, deltaY)** to translate the entire room. It picks the delta from the edge with the longest overlap. This has two fundamental limitations:

1. **Translation fixes at most one edge per axis.** If the room is 416.4cm wide but the available space is 413.6cm, translating right aligns the left edge but the right edge overshoots by 2.8cm (or vice versa). Both edges can't be correct simultaneously.

2. **Spanning walls are not considered.** `alignToEnvelope()` only aligns to the envelope boundary edges. There is no alignment step for spanning walls. The classification identifies "spanning" edges, but this information is only used for wall type assignment — not for repositioning.

### Why `enforceAdjacentPositions()` doesn't help

This function (walls.js:337-375) only handles **shared** walls between two rooms. It moves the adjacent room so both rooms sit on opposite faces of their shared wall. It does NOT handle:
- Room edges that abut the envelope boundary
- Room edges that abut a spanning wall
- Room edges where the polygon itself is the wrong size

## Approach

### New function: `constrainRoomToStructuralBoundaries()`

**File:** `src/envelope.js`

After `alignToEnvelope()` and `alignToExistingRooms()` translate the room to roughly the right position, this new function **reshapes** the polygon by snapping individual edges to the nearest structural boundary.

**Input:** floor-global polygon vertices, envelope (polygonCm, wallThicknesses, spanningWalls)
**Output:** adjusted floor-global polygon vertices

**Algorithm:**

For each axis-aligned edge of the room polygon:
1. Compute the edge's floor-global coordinate (x for V edges, y for H edges)
2. Check if this coordinate is within `wallThickness + tolerance` of a structural boundary:
   - **Envelope inner face**: envelope edge coordinate ± wall thickness (inward)
   - **Spanning wall face**: centerline ± thickness/2
3. If a match is found, snap the edge to the boundary:
   - For H edges: adjust the y-coordinate of both vertices
   - For V edges: adjust the x-coordinate of both vertices

Since all edges are axis-aligned (enforced by rectification), adjusting one edge's axis coordinate doesn't affect perpendicular edges — they simply get shorter or longer. This preserves polygon validity.

**Precedence:** If an edge is close to both an envelope boundary and a spanning wall, the envelope boundary wins (it's the hard limit).

### Integration point

In `confirmDetection()` (room-detection-controller.js), insert the new step between the existing alignment calls and room creation:

```
alignToEnvelope()          ← existing: translate room to rough position
alignToExistingRooms()     ← existing: fine-tune with neighbors
constrainRoomToStructuralBoundaries()  ← NEW: reshape edges to boundaries
createSurface()            ← existing: create room
```

The function receives and returns floor-global coordinates. After constraining, the local vertices and floorPosition are recomputed from the adjusted global polygon.

## Implementation Steps

### Step 1: Compute structural boundary targets

Add a helper `computeStructuralBoundaries(envelope)` in `envelope.js` that returns arrays of target lines:

```js
function computeStructuralBoundaries(envelope) {
  const envelopePoly = envelope?.detectedPolygonCm || envelope?.polygonCm;
  const envThicknesses = envelope?.wallThicknesses?.edges || [];
  const spanningWalls = envelope?.spanningWalls || [];

  const hTargets = []; // { y, type, wallThickness }
  const vTargets = []; // { x, type, wallThickness }

  // Envelope inner faces (same logic as alignToEnvelope)
  // ... compute inward normal, offset by thickness ...

  // Spanning wall faces (both sides)
  for (const sw of spanningWalls) {
    const isH = sw.orientation === 'H';
    const half = (sw.thicknessCm || 0) / 2;
    const center = isH
      ? (sw.startCm.y + sw.endCm.y) / 2
      : (sw.startCm.x + sw.endCm.x) / 2;
    if (isH) {
      hTargets.push({ y: center - half, type: 'spanning-upper', wallThickness: sw.thicknessCm });
      hTargets.push({ y: center + half, type: 'spanning-lower', wallThickness: sw.thicknessCm });
    } else {
      vTargets.push({ x: center - half, type: 'spanning-left', wallThickness: sw.thicknessCm });
      vTargets.push({ x: center + half, type: 'spanning-right', wallThickness: sw.thicknessCm });
    }
  }

  return { hTargets, vTargets };
}
```

**Run `npm run test` after this step.**

### Step 2: Implement `constrainRoomToStructuralBoundaries()`

```js
export function constrainRoomToStructuralBoundaries(globalVertices, envelope) {
  const { hTargets, vTargets } = computeStructuralBoundaries(envelope);
  const tolerance = FLOOR_PLAN_RULES.alignmentToleranceCm;
  const adjusted = globalVertices.map(v => ({ ...v }));
  const n = adjusted.length;

  for (let i = 0; i < n; i++) {
    const a = adjusted[i];
    const b = adjusted[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    if (Math.abs(dy) < 0.5 && Math.abs(dx) > 1) {
      // Horizontal edge — check y against hTargets
      const edgeY = (a.y + b.y) / 2;
      let bestTarget = null, bestDist = Infinity;
      for (const t of hTargets) {
        const dist = Math.abs(t.y - edgeY);
        const maxDist = (t.wallThickness || 0) + tolerance;
        if (dist <= maxDist && dist < bestDist) {
          bestTarget = t;
          bestDist = dist;
        }
      }
      if (bestTarget && bestDist > 0.5) {
        console.log(`[constrain] H edge ${i}: y=${edgeY.toFixed(1)} → ${bestTarget.y.toFixed(1)} (${bestTarget.type}, delta=${(bestTarget.y - edgeY).toFixed(1)})`);
        a.y = bestTarget.y;
        b.y = bestTarget.y;
      }
    } else if (Math.abs(dx) < 0.5 && Math.abs(dy) > 1) {
      // Vertical edge — check x against vTargets
      const edgeX = (a.x + b.x) / 2;
      let bestTarget = null, bestDist = Infinity;
      for (const t of vTargets) {
        const dist = Math.abs(t.x - edgeX);
        const maxDist = (t.wallThickness || 0) + tolerance;
        if (dist <= maxDist && dist < bestDist) {
          bestTarget = t;
          bestDist = dist;
        }
      }
      if (bestTarget && bestDist > 0.5) {
        console.log(`[constrain] V edge ${i}: x=${edgeX.toFixed(1)} → ${bestTarget.x.toFixed(1)} (${bestTarget.type}, delta=${(bestTarget.x - edgeX).toFixed(1)})`);
        a.x = bestTarget.x;
        b.x = bestTarget.x;
      }
    }
  }

  return adjusted;
}
```

**Run `npm run test` after this step.**

### Step 3: Integrate into `confirmDetection()`

In `room-detection-controller.js`, after `alignToExistingRooms()` and before `createSurface()`:

```js
// After existing alignment:
const { floorPosition: alignedPos } = alignToExistingRooms(...);

// NEW: Constrain edges to structural boundaries
const alignedGlobal = localVertices.map(v => ({
  x: alignedPos.x + v.x,
  y: alignedPos.y + v.y
}));
const constrainedGlobal = constrainRoomToStructuralBoundaries(alignedGlobal, envelope);

// Recompute local vertices and floorPosition from constrained global
let cMinX = Infinity, cMinY = Infinity;
for (const p of constrainedGlobal) {
  if (p.x < cMinX) cMinX = p.x;
  if (p.y < cMinY) cMinY = p.y;
}
const constrainedLocal = constrainedGlobal.map(p => ({
  x: round1(p.x - cMinX),
  y: round1(p.y - cMinY)
}));
const constrainedPos = { x: round1(cMinX), y: round1(cMinY) };

const room = createSurface({
  name: ...,
  polygonVertices: constrainedLocal,
  floorPosition: constrainedPos
});
```

**Run `npm run test` after this step.**

### Step 4: Add E2E test for KG floor plan

Add a test case in `room-detection.verify.test.js` that:
1. Loads the KG floor plan image
2. Detects the envelope
3. Detects a room at a known seed point
4. Asserts that the room's floor-global edges align with the envelope inner faces within ±1cm
5. Asserts that edges near the spanning wall align with the spanning wall faces within ±1cm

Specific assertions for Room 1 (upper-left) if seed point corresponds:
- Left edge: floorPos.x ≈ 678.6 (envelope left inner)
- Top edge: floorPos.y ≈ 1023.2 (envelope top inner)
- Bottom edge: floorPos.y + maxY ≈ 1413.2 (spanning wall upper face)

**Run `npm run test` after this step.**

### Step 5: Clean up and verify

1. Remove any debug-only `console.log` statements (keep structured logging with `[constrain]` prefix)
2. Run full test suite
3. Verify with KG floor plan in browser — all room edges should align with envelope/spanning boundaries

## Walkthrough: Room 2 (4234, upper-right)

**Before** constraining:
- Global vertices: (1401.8,1020.9) (1616.4,1020.9) (1616.4,1415.4) (1200,1415.4) (1200,1021.9) (1401.8,1021.9)

**Structural boundaries (hTargets + vTargets):**
- hTarget: y=1023.2 (envelope top inner, thickness=31.1)
- hTarget: y=1815.6 (envelope bottom inner, thickness=29.8)
- hTarget: y=1413.15 (spanning wall upper face, thickness=25.1)
- hTarget: y=1438.25 (spanning wall lower face, thickness=25.1)
- vTarget: x=678.6 (envelope left inner, thickness=31.4)
- vTarget: x=1613.6 (envelope right inner, thickness=29.4)

**Edge-by-edge:**

Edge 0: (1401.8,1020.9)→(1616.4,1020.9) — H at y=1020.9
- Nearest hTarget: y=1023.2 (envelope top, thickness=31.1)
- Distance: |1023.2 - 1020.9| = 2.3 < 31.1 + 6 = 37.1 ✓
- **Snap to y=1023.2** (delta=+2.3)

Edge 1: (1616.4,1020.9)→(1616.4,1415.4) — V at x=1616.4
- Nearest vTarget: x=1613.6 (envelope right, thickness=29.4)
- Distance: |1613.6 - 1616.4| = 2.8 < 29.4 + 6 = 35.4 ✓
- **Snap to x=1613.6** (delta=-2.8)

Edge 2: (1616.4,1415.4)→(1200,1415.4) — H at y=1415.4
- Nearest hTarget: y=1413.15 (spanning upper, thickness=25.1)
- Distance: |1413.15 - 1415.4| = 2.25 < 25.1 + 6 = 31.1 ✓
- **Snap to y=1413.15** (delta=-2.25)

Edge 3: (1200,1415.4)→(1200,1021.9) — V at x=1200
- Nearest vTarget: x=678.6 (envelope left, thickness=31.4)
- Distance: |678.6 - 1200| = 521.4 > 31.4 + 6 = 37.4 ✗
- Nearest vTarget: x=1613.6 (envelope right, thickness=29.4)
- Distance: |1613.6 - 1200| = 413.6 > 29.4 + 6 = 35.4 ✗
- **No snap** — this is an interior edge (between rooms), not near any structural boundary

Edge 4: (1200,1021.9)→(1401.8,1021.9) — H at y=1021.9
- Nearest hTarget: y=1023.2 (envelope top, thickness=31.1)
- Distance: |1023.2 - 1021.9| = 1.3 < 37.1 ✓
- **Snap to y=1023.2** (delta=+1.3)

Edge 5: (1401.8,1021.9)→(1401.8,1020.9) — V at x=1401.8
- Distance to all vTargets > tolerance ✗
- **No snap** — interior edge

**After constraining:**
(1401.8, 1023.2) (1613.6, 1023.2) (1613.6, 1413.15) (1200, 1413.15) (1200, 1023.2) (1401.8, 1023.2)

Edges 4 and 0 both snap to y=1023.2, and vertex (1401.8, 1021.9) → (1401.8, 1023.2) and (1401.8, 1020.9) → (1401.8, 1023.2) — the 1cm "step" artifact disappears because both horizontal edges snap to the same target. This also collapses edge 5 to zero length — the `enforcePolygonRules` cleanup (called later on the final polygon) will remove the degenerate edge.

**Result:** Room 2 becomes a clean rectangle with right edge at the envelope inner face and bottom at the spanning wall upper face.

## Walkthrough: Room 3 (af11, lower-left L-shape)

**Before:**
(678.6,1439.4) (955.5,1439.4) (955.5,1589.9) (1059.4,1589.9) (1059.4,1820.1) (678.6,1820.1)

**Edge-by-edge:**

Edge 0: H at y=1439.4 → nearest hTarget: y=1438.25 (spanning lower, dist=1.15, maxDist=31.1) → **Snap to y=1438.25**
Edge 1: V at x=955.5 → nearest vTarget: x=678.6 (dist=276.9>37.4) or x=1613.6 (dist=658.1>35.4) → **No snap** (interior)
Edge 2: H at y=1589.9 → nearest hTarget: y=1438.25 (dist=151.7>31.1) or y=1413.15 (dist=176.75>31.1) → **No snap** (interior)
Edge 3: V at x=1059.4 → no close vTarget → **No snap** (interior)
Edge 4: H at y=1820.1 → nearest hTarget: y=1815.6 (envelope bottom, dist=4.5, maxDist=35.8) → **Snap to y=1815.6**
Edge 5: V at x=678.6 → nearest vTarget: x=678.6 (envelope left, dist=0.0) → skip (already aligned, dist < 0.5)

**After:**
(678.6, 1438.25) (955.5, 1438.25) (955.5, 1589.9) (1059.4, 1589.9) (1059.4, 1815.6) (678.6, 1815.6)

Top edge snaps to spanning wall lower face, bottom snaps to envelope inner face. Interior edges (the L-step) are unchanged. Correct.

## Walkthrough: Room edge that shouldn't snap

Edge 3 of Room 1: V at x=1150.2 — this is a small notch in the L-shape (26cm long).
- Nearest vTarget: x=678.6 (dist=471.6) or x=1613.6 (dist=463.4) — both far beyond tolerance.
- **No snap.** Correct — this is an interior feature of the room shape.

## Edge Cases

### Small notch artifact (Room 2, edge 5)
After snapping edges 0 and 4 to the same y=1023.2, edge 5 collapses to zero length. This is handled by the existing `enforcePolygonRules()` collinear cleanup (removes degenerate edges).

### Room already perfectly aligned (Room 1, left/top)
Edges at x=678.6 and y=1023.2 already match their targets with dist < 0.5. The function skips these (no-op for already-aligned edges).

### Interior edges between rooms
Edges far from any structural boundary (like x=1200 between Room 1 and Room 2) are not snapped. They remain as-is, preserving the detected room shape. The wall between rooms is handled by `enforceAdjacentPositions()` which adjusts room positions based on wall thickness.

### Spanning wall with rooms on both sides
Upper rooms snap their bottom edges to `spanningWall.y - thickness/2`. Lower rooms snap their top edges to `spanningWall.y + thickness/2`. The gap between them = thickness = the spanning wall.

## Files Modified

| File | Change |
|------|--------|
| `src/envelope.js` | Add `computeStructuralBoundaries()` helper, add `constrainRoomToStructuralBoundaries()` export |
| `src/room-detection-controller.js` | Call `constrainRoomToStructuralBoundaries()` after alignment, recompute local vertices |
| `src/room-detection.verify.test.js` | Add E2E test for room edge alignment to structural boundaries |

## Questions for User (parked)

1. **Should `constrainRoomToStructuralBoundaries()` also consider existing room edges as targets?** Currently, only envelope and spanning walls are targets. If Room 2's left edge at x=1200 should snap to Room 1's right edge + wall thickness, that's a different mechanism (already partially handled by `alignToExistingRooms` + `enforceAdjacentPositions`). Should the new function handle this too, or keep the current separation of concerns?

2. **Should the constraint step also run when rooms are manually repositioned (drag)?** Currently this plan only adds it to `confirmDetection()`. If the user drags a room, should it also snap to structural boundaries?

3. **Tolerance threshold:** The plan uses `wallThickness + alignmentToleranceCm` (wall + 6cm) as the matching tolerance. This is generous enough to catch all KG violations (max 4.5cm). Is this appropriate, or should it be tighter/looser?

## Plan Scorecard

### Hacky (0 = duct tape, 10 = clean)

0→1: Solves the actual root cause — polygon edges don't match structural boundaries, and translation alone can't fix both sides.
1→2: General mechanism — works for any polygon shape (rectangle, L, T, U) and any number of structural boundaries.
2→3: Operates on floor-global coordinates directly — no coordinate space confusion.
3→4: Doesn't modify the existing alignment functions — adds a new step that complements them.
4→5: Uses the same structural data (envelope, spanning walls) that's already detected and stored.
5→6: Falls back gracefully — if no boundary is close, the edge is left unchanged.
6→7: Handles both shrinking (Room 2 right edge moves inward) and growing (Room 2 top edge moves down) naturally.
7→8: Doesn't introduce special cases for specific floor plans or room shapes.
8→9: Integrates cleanly between existing alignment and room creation — minimal changes to the pipeline.

**Score: 9**

### Compliance (0 = violates everything, 10 = textbook)

0→1: Fix is at the right layer — envelope.js for structural boundary logic, controller for orchestration.
1→2: Uses existing data structures (envelope.polygonCm, wallThicknesses, spanningWalls) — no new data model.
2→3: One logical change (add constraint step), then test.
3→4: Uses existing constants (FLOOR_PLAN_RULES.alignmentToleranceCm) — no new thresholds.
4→5: Includes `console.log` instrumentation with `[constrain]` prefix per CLAUDE.md rules.
5→6: E2E test scenario defined in the plan per CLAUDE.md rules.
6→7: No scope creep — doesn't change detection, rectification, or wall sync.
7→8: Follows the coordinate space convention: floor-global for the constraint function, then converts to room-local + floorPosition.
8→9: Plan includes walkthroughs for multiple scenarios (corner room, L-shape, interior edge, degenerate edge).

**Score: 9**

### Complexity (0 = extremely complex, 10 = minimal)

0→1: Core function is ~40 lines of simple axis-aligned edge matching.
1→2: Helper function `computeStructuralBoundaries()` is ~30 lines of straightforward geometry.
2→3: Integration in controller is ~15 lines (convert to global, constrain, convert back).
3→4: No new data structures — just arrays of {y, type} / {x, type} target lines.
4→5: No iteration or fixpoint loops — single pass over edges.
5→6: No changes to existing functions — purely additive.
6→7: Degenerate edge cleanup delegated to existing `enforcePolygonRules()`.
7→8: Total diff estimate: ~100 lines of logic + ~50 lines of test.

**Score: 8**

### Problem Understanding (0 = guessing, 10 = fully mapped)

0→1: Read the actual state file with 5 rooms and computed all floor-global coordinates.
1→2: Computed every boundary error precisely (2.25, 2.3, 2.8, 1.15, 4.5 cm) from the data.
2→3: Read `alignToEnvelope()` (envelope.js:720-827) — confirmed it only translates, never reshapes.
3→4: Read `alignToExistingRooms()` (floor-plan-rules.js:961-1041) — confirmed same limitation.
4→5: Read `confirmDetection()` (room-detection-controller.js:370-582) — traced full pipeline from detection to room creation.
5→6: Read `enforceAdjacentPositions()` (walls.js:337-375) — confirmed it only handles shared walls, not envelope/spanning boundaries.
6→7: Read `matchEdgeToSpanningWall()` (envelope.js:132-193) — confirmed spanning walls are identified but not used for repositioning.
7→8: Verified no existing `constrainTo*` or `snapTo*` function exists for room polygon reshaping.
8→9: Walked through the exact edge-by-edge behavior for Room 2 (corner case: 2 envelope edges + 1 spanning wall + notch artifact collapse).
9→10: Walked through Room 3 (L-shape with mixed boundary/interior edges) and verified interior edges are correctly left alone.

**Score: 10**

### Confidence (0 = hope, 10 = certain)

0→1: The math is provably correct: axis-aligned edges only need one coordinate adjusted, perpendicular edges auto-adjust their length.
1→2: The walkthroughs produce exactly the expected coordinates: Room 2 right→1613.6, bottom→1413.15, top→1023.2.
2→3: The tolerance (`wallThickness + 6cm`) is proven sufficient: all KG errors (max 4.5cm) are within the 29.4+6=35.4 range.
3→4: Interior edges (x=1200, x=955.5) are provably far from any structural boundary — they won't be incorrectly snapped.
4→5: Degenerate edges from notch collapse are handled by existing `enforcePolygonRules()` — no new code needed.
5→6: The function is purely additive — if it finds no close boundary, it returns the polygon unchanged. Zero regression risk for cases where alignment was already correct.
6→7: The same logic works for any wall thickness (11.5, 24, 30 cm) — it's parameterized by the actual thickness stored in the envelope data.
7→8: Existing tests (1289) exercise envelope detection, polygon rectification, and wall sync — they'll catch regressions in those systems.
8→9: The E2E test will directly verify the constraint (room edge position within ±1cm of boundary).

**Score: 9**
