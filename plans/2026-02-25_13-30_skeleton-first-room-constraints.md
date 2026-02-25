# Plan: Skeleton-first room constraint enforcement

## Context

The envelope detection pipeline produces a precise building skeleton:
- **Outer boundary** with per-edge measured wall thicknesses
- **Spanning walls** with measured thicknesses
- **Valid angles**

This skeleton should be the authoritative reference for all downstream operations. Currently, room detection ignores the skeleton: it flood-fills the raster image, creates walls with default 12cm thickness, then tries to retroactively classify and assign skeleton properties. This bottom-up approach is fragile — walls on envelope edges end up with inconsistent thicknesses (some 30cm, some 12cm) and are fragmented per-room instead of continuous.

## Problem Statement

**Room footprint detection works well.** The flood fill + contour trace produces good room shapes.

**What doesn't work:**
1. Room edges that touch the envelope don't snap to the envelope's inner face (off by 1-5cm)
2. Wall thickness on envelope-touching edges is inconsistent (first room gets 30cm, subsequent rooms get 12cm default)
3. Spanning wall edges aren't snapped or assigned correct thickness
4. Outer walls aren't continuous — they're fragmented per-room with different properties

**Evidence from KG state:**

Top envelope edge (should be continuous 30cm):
| Wall segment | X range | Thickness | Correct? |
|---|---|---|---|
| c21fa | 678.6 → 1176 | 30cm | ✓ |
| c2218 | 1200 → 1401.8 | 12cm | ✗ |
| 73749 | 1401.8 → 1616.4 | 30cm | ✓ |

Right envelope edge: Room 2 segment=30cm ✓, Room 5 segment=12cm ✗
Bottom envelope edge: Room 3 segment=30cm ✓, Room 4 segment=12cm ✗
Left envelope edge: Room 1 segment=30cm ✓, Room 3 segment=12cm ✗

Pattern: the first room detected on each edge gets the correct thickness; subsequent rooms don't.

## Root Cause

The current pipeline is bottom-up:
1. `syncFloorWalls()` → creates walls with DEFAULT_WALL_THICKNESS_CM = **12cm**
2. `classifyRoomEdges()` → identifies edges as envelope/spanning/shared/interior
3. `assignWallTypesFromClassification()` → updates thickness based on classification

Failure modes:
- Classification relies on `matchEdgeToEnvelope()` which uses perpendicular distance + overlap checks. These can fail for short edges, edges at slightly wrong positions, or edges offset by detection noise.
- The assignment only runs for the newly detected room, not all rooms. If a wall is shared or merged, the lookup (`findWallForEdge`) may not find the right entity.
- Wall height assignment (confirmDetection lines 512-521) only runs for the new room's edges, so walls from other rooms keep default 200cm height instead of the configured 240cm.

## Approach: Skeleton as Reference Model

The envelope data is the skeleton. Instead of bottom-up classify→assign, use **top-down enforce**: after walls are created, scan all walls against the skeleton and force properties on any wall that aligns with a skeleton boundary.

**Two changes:**

### Change A: Constrain room edge positions to skeleton boundaries

New function `constrainRoomToStructuralBoundaries()` reshapes the detected polygon so edges that are close to skeleton boundaries snap to the exact boundary position. Runs during `confirmDetection()` after alignment, before room creation.

### Change B: Enforce skeleton wall properties

New function `enforceSkeletonWallProperties(floor)` scans ALL wall entities and forces skeleton properties on any wall that aligns with an envelope edge or spanning wall. Runs inside `syncFloorWalls()` after wall creation and merging, so it applies every time walls are synced — not just on first detection.

This replaces the fragile `classifyRoomEdges() → assignWallTypesFromClassification()` pipeline for envelope/spanning edges. That pipeline can remain for interior edge classification (wall type inference), but the skeleton boundaries are enforced directly.

## Implementation

### Step 1: `computeStructuralBoundaries(envelope)`

**File:** `src/envelope.js`

Compute the inner-face positions and thicknesses from the envelope. This is the "mental model" — a list of axis-aligned boundary lines with properties.

```js
/**
 * Compute structural boundary lines from the envelope skeleton.
 * Returns arrays of H and V target lines, each with position, thickness,
 * and source info. These are the building's structural boundaries that
 * rooms and walls should align to.
 */
export function computeStructuralBoundaries(envelope) {
  if (!envelope) return { hTargets: [], vTargets: [] };

  const envelopePoly = envelope.detectedPolygonCm || envelope.polygonCm;
  if (!envelopePoly || envelopePoly.length < 3) return { hTargets: [], vTargets: [] };

  const envThicknesses = envelope.wallThicknesses?.edges || [];
  const spanningWalls = envelope.spanningWalls || [];
  const hTargets = [];
  const vTargets = [];

  // Compute winding for inward normal
  let signedArea2 = 0;
  const n = envelopePoly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea2 += envelopePoly[i].x * envelopePoly[j].y
                 - envelopePoly[j].x * envelopePoly[i].y;
  }
  const sign = signedArea2 > 0 ? 1 : -1;

  // Envelope inner faces
  for (let i = 0; i < n; i++) {
    const a = envelopePoly[i];
    const b = envelopePoly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const edgeMeas = envThicknesses.find(e => e.edgeIndex === i);
    const thickness = edgeMeas?.thicknessCm || 0;
    const inNx = -sign * (dy / len);
    const inNy = -sign * (-dx / len);

    if (Math.abs(dy) < 0.5) {
      // H envelope edge
      const envY = (a.y + b.y) / 2;
      const innerY = envY + inNy * thickness;
      hTargets.push({
        coord: innerY, thickness, type: 'envelope',
        envelopeEdgeIndex: i, rangeMin: Math.min(a.x, b.x), rangeMax: Math.max(a.x, b.x)
      });
    } else if (Math.abs(dx) < 0.5) {
      // V envelope edge
      const envX = (a.x + b.x) / 2;
      const innerX = envX + inNx * thickness;
      vTargets.push({
        coord: innerX, thickness, type: 'envelope',
        envelopeEdgeIndex: i, rangeMin: Math.min(a.y, b.y), rangeMax: Math.max(a.y, b.y)
      });
    }
  }

  // Spanning wall faces (both sides)
  for (let i = 0; i < spanningWalls.length; i++) {
    const sw = spanningWalls[i];
    const half = (sw.thicknessCm || 0) / 2;
    if (sw.orientation === 'H') {
      const centerY = (sw.startCm.y + sw.endCm.y) / 2;
      const rMin = Math.min(sw.startCm.x, sw.endCm.x);
      const rMax = Math.max(sw.startCm.x, sw.endCm.x);
      hTargets.push({ coord: centerY - half, thickness: sw.thicknessCm,
        type: 'spanning', spanningWallIndex: i, rangeMin: rMin, rangeMax: rMax });
      hTargets.push({ coord: centerY + half, thickness: sw.thicknessCm,
        type: 'spanning', spanningWallIndex: i, rangeMin: rMin, rangeMax: rMax });
    } else {
      const centerX = (sw.startCm.x + sw.endCm.x) / 2;
      const rMin = Math.min(sw.startCm.y, sw.endCm.y);
      const rMax = Math.max(sw.startCm.y, sw.endCm.y);
      vTargets.push({ coord: centerX - half, thickness: sw.thicknessCm,
        type: 'spanning', spanningWallIndex: i, rangeMin: rMin, rangeMax: rMax });
      vTargets.push({ coord: centerX + half, thickness: sw.thicknessCm,
        type: 'spanning', spanningWallIndex: i, rangeMin: rMin, rangeMax: rMax });
    }
  }

  console.log(`[skeleton] boundaries: ${hTargets.length} H targets, ${vTargets.length} V targets`);
  for (const t of hTargets) console.log(`[skeleton]   H: y=${t.coord.toFixed(1)} thick=${t.thickness.toFixed(1)} (${t.type})`);
  for (const t of vTargets) console.log(`[skeleton]   V: x=${t.coord.toFixed(1)} thick=${t.thickness.toFixed(1)} (${t.type})`);

  return { hTargets, vTargets };
}
```

**Run `npm run test` after this step.**

### Step 2: `constrainRoomToStructuralBoundaries(globalVertices, envelope)`

**File:** `src/envelope.js`

Reshapes a room polygon by snapping edges to nearby skeleton boundaries.

```js
/**
 * Constrain a room polygon's edges to structural boundaries.
 * For each axis-aligned edge within tolerance of a skeleton boundary
 * (envelope inner face or spanning wall face), snap the edge to
 * the boundary position. This reshapes the polygon — not just translates.
 *
 * @param {Array<{x,y}>} globalVertices - Floor-global polygon coordinates
 * @param {Object} envelope - Envelope data with boundaries
 * @returns {Array<{x,y}>} Adjusted vertices (new array, input not mutated)
 */
export function constrainRoomToStructuralBoundaries(globalVertices, envelope) {
  if (!envelope || !globalVertices?.length) return globalVertices;

  const { hTargets, vTargets } = computeStructuralBoundaries(envelope);
  if (!hTargets.length && !vTargets.length) return globalVertices;

  const tolerance = FLOOR_PLAN_RULES.alignmentToleranceCm;
  const adjusted = globalVertices.map(v => ({ x: v.x, y: v.y }));
  const n = adjusted.length;

  for (let i = 0; i < n; i++) {
    const a = adjusted[i];
    const b = adjusted[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;

    if (Math.abs(dy) < 0.5 && Math.abs(dx) > 1) {
      // Horizontal edge at y = edgeY
      const edgeY = (a.y + b.y) / 2;
      const edgeMinX = Math.min(a.x, b.x), edgeMaxX = Math.max(a.x, b.x);
      let bestTarget = null, bestDist = Infinity;
      for (const t of hTargets) {
        const dist = Math.abs(t.coord - edgeY);
        const maxDist = t.thickness + tolerance;
        // Check edge overlaps with target's range (not just distance)
        const overlap = Math.min(edgeMaxX, t.rangeMax) - Math.max(edgeMinX, t.rangeMin);
        if (dist <= maxDist && dist < bestDist && overlap > 1) {
          bestTarget = t; bestDist = dist;
        }
      }
      if (bestTarget && bestDist > 0.5) {
        console.log(`[constrain] H edge ${i}: y=${edgeY.toFixed(1)} → ${bestTarget.coord.toFixed(1)} (${bestTarget.type}, delta=${(bestTarget.coord - edgeY).toFixed(1)})`);
        a.y = bestTarget.coord;
        b.y = bestTarget.coord;
      }
    } else if (Math.abs(dx) < 0.5 && Math.abs(dy) > 1) {
      // Vertical edge at x = edgeX
      const edgeX = (a.x + b.x) / 2;
      const edgeMinY = Math.min(a.y, b.y), edgeMaxY = Math.max(a.y, b.y);
      let bestTarget = null, bestDist = Infinity;
      for (const t of vTargets) {
        const dist = Math.abs(t.coord - edgeX);
        const maxDist = t.thickness + tolerance;
        const overlap = Math.min(edgeMaxY, t.rangeMax) - Math.max(edgeMinY, t.rangeMin);
        if (dist <= maxDist && dist < bestDist && overlap > 1) {
          bestTarget = t; bestDist = dist;
        }
      }
      if (bestTarget && bestDist > 0.5) {
        console.log(`[constrain] V edge ${i}: x=${edgeX.toFixed(1)} → ${bestTarget.coord.toFixed(1)} (${bestTarget.type}, delta=${(bestTarget.coord - edgeX).toFixed(1)})`);
        a.x = bestTarget.coord;
        b.x = bestTarget.coord;
      }
    }
  }

  return adjusted;
}
```

**Run `npm run test` after this step.**

### Step 3: Integrate edge constraining into `confirmDetection()`

**File:** `src/room-detection-controller.js`, after `alignToExistingRooms()` (~line 422)

```js
// After existing alignment:
const { floorPosition: alignedPos } = alignToExistingRooms(
  localVertices, envAlignedPos, floor.rooms || []
);

// NEW: Constrain edges to structural boundaries (reshape polygon)
const alignedGlobal = localVertices.map(v => ({
  x: alignedPos.x + v.x, y: alignedPos.y + v.y
}));
const constrainedGlobal = constrainRoomToStructuralBoundaries(alignedGlobal, envelope);

// Recompute local vertices + floorPosition from constrained global coords
let cMinX = Infinity, cMinY = Infinity;
for (const p of constrainedGlobal) {
  if (p.x < cMinX) cMinX = p.x;
  if (p.y < cMinY) cMinY = p.y;
}
const constrainedLocal = constrainedGlobal.map(p => ({
  x: round1(p.x - cMinX), y: round1(p.y - cMinY)
}));
const constrainedPos = { x: round1(cMinX), y: round1(cMinY) };
console.log(`[confirmDetection]   after constrainToSkeleton: pos=(${constrainedPos.x},${constrainedPos.y})`);

// Use constrained vertices for room creation (replacing localVertices + alignedPos)
const room = createSurface({
  name: ...,
  polygonVertices: constrainedLocal,
  floorPosition: constrainedPos
});
```

**Run `npm run test` after this step.**

### Step 4: `enforceSkeletonWallProperties(floor)`

**File:** `src/envelope.js`

This is the key change. After walls are created by `syncFloorWalls`, scan all walls and force skeleton properties on any wall that aligns with an envelope edge or spanning wall. This replaces the fragile per-room classification approach for boundary walls.

```js
/**
 * Enforce skeleton wall properties on all walls that align with
 * envelope edges or spanning walls. This is a top-down enforcement:
 * the skeleton (envelope) is the source of truth, and walls inherit
 * from it — not the other way around.
 *
 * For each wall in floor.walls:
 *   - If it aligns with an envelope edge → set thickness from envelope measurement
 *   - If it aligns with a spanning wall → set thickness from spanning wall measurement
 *
 * "Aligns" means: the wall is parallel to and within wallThickness distance of
 * the structural boundary, with significant overlap along the boundary's range.
 *
 * Also enforces wallDefaults.heightCm on all walls.
 */
export function enforceSkeletonWallProperties(floor) {
  const envelope = floor?.layout?.envelope;
  if (!envelope) return;

  const { hTargets, vTargets } = computeStructuralBoundaries(envelope);
  const wallHeight = floor.layout?.wallDefaults?.heightCm;
  const wallTypes = floor.layout?.wallDefaults?.types;
  const tolerance = FLOOR_PLAN_RULES.alignmentToleranceCm;

  for (const wall of (floor.walls || [])) {
    const sx = wall.start.x, sy = wall.start.y;
    const ex = wall.end.x, ey = wall.end.y;
    const wdx = ex - sx, wdy = ey - sy;
    const wLen = Math.hypot(wdx, wdy);
    if (wLen < 1) continue;

    // Enforce height from wallDefaults
    if (wallHeight && Number.isFinite(wallHeight)) {
      wall.heightStartCm = wallHeight;
      wall.heightEndCm = wallHeight;
    }

    let matched = false;

    if (Math.abs(wdy) < 0.5) {
      // Horizontal wall — check against hTargets
      const wallY = (sy + ey) / 2;
      const wallMinX = Math.min(sx, ex), wallMaxX = Math.max(sx, ex);
      for (const t of hTargets) {
        const dist = Math.abs(t.coord - wallY);
        const maxDist = t.thickness + tolerance;
        const overlap = Math.min(wallMaxX, t.rangeMax) - Math.max(wallMinX, t.rangeMin);
        if (dist <= maxDist && overlap > 1) {
          const { snappedCm } = snapToWallType(t.thickness, wallTypes);
          if (wall.thicknessCm !== snappedCm) {
            console.log(`[skeleton] wall ${wall.id}: H at y=${wallY.toFixed(1)} → ${t.type} (thick ${wall.thicknessCm} → ${snappedCm})`);
            wall.thicknessCm = snappedCm;
          }
          matched = true;
          break;
        }
      }
    } else if (Math.abs(wdx) < 0.5) {
      // Vertical wall — check against vTargets
      const wallX = (sx + ex) / 2;
      const wallMinY = Math.min(sy, ey), wallMaxY = Math.max(sy, ey);
      for (const t of vTargets) {
        const dist = Math.abs(t.coord - wallX);
        const maxDist = t.thickness + tolerance;
        const overlap = Math.min(wallMaxY, t.rangeMax) - Math.max(wallMinY, t.rangeMin);
        if (dist <= maxDist && overlap > 1) {
          const { snappedCm } = snapToWallType(t.thickness, wallTypes);
          if (wall.thicknessCm !== snappedCm) {
            console.log(`[skeleton] wall ${wall.id}: V at x=${wallX.toFixed(1)} → ${t.type} (thick ${wall.thicknessCm} → ${snappedCm})`);
            wall.thicknessCm = snappedCm;
          }
          matched = true;
          break;
        }
      }
    }
  }
}
```

**Run `npm run test` after this step.**

### Step 5: Integrate `enforceSkeletonWallProperties` into `syncFloorWalls`

**File:** `src/walls.js`

Call `enforceSkeletonWallProperties(floor)` at the end of `syncFloorWalls()`, after all wall creation and merging. This ensures skeleton properties are enforced every time walls are synced — not just on first detection.

```js
export function syncFloorWalls(floor, { enforcePositions = true } = {}) {
  // ... existing code ...
  mergeSharedEdgeWalls(rooms, floor, wallByEdgeKey, touchedWallIds);
  pruneOrphanSurfaces(floor, rooms, roomIds);
  removeStaleWalls(floor, touchedWallIds, roomIds);

  // NEW: Enforce skeleton properties on all walls
  enforceSkeletonWallProperties(floor);

  if (enforcePositions) enforceAdjacentPositions(floor);
}
```

This means `enforceSkeletonWallProperties` runs:
- During `confirmDetection()` (via syncFloorWalls)
- On room drag/resize (via syncFloorWalls)
- On any state change that triggers wall sync

**Run `npm run test` after this step.**

### Step 6: Simplify `confirmDetection()` wall assignment

**File:** `src/room-detection-controller.js`

Since `enforceSkeletonWallProperties` now handles envelope and spanning wall thickness assignment inside `syncFloorWalls`, the explicit `classifyRoomEdges() → assignWallTypesFromClassification()` pipeline in `confirmDetection()` can be simplified:

- **Keep** `classifyRoomEdges()` — still needed for `extendSkeletonForRoom()` (extending edges)
- **Keep** `assignWallTypesFromClassification()` — still useful for interior edge thickness from detection
- **Remove** the height assignment loop (lines 512-521) — `enforceSkeletonWallProperties` now does this
- **Remove** the fallback thickness matching (lines 457-490) — skeleton enforcement handles boundary walls, classification handles interiors

This is a cleanup step, not required for correctness. The skeleton enforcement is idempotent — running it alongside the classification doesn't cause conflicts because it enforces the same values.

**Run `npm run test` after this step.**

### Step 7: E2E test

**File:** `src/room-detection.verify.test.js`

Add a test that:
1. Loads the KG floor plan, detects envelope
2. Detects a room at a known seed point (e.g., upper-left room)
3. Asserts room edge positions align with skeleton boundaries (±1cm)
4. Asserts wall thickness on envelope-facing edges matches envelope measurement (snapped)
5. Detects a second room on the same envelope edge
6. Asserts the second room's envelope-facing wall also has correct thickness

This tests both position constraining (Step 2-3) and property enforcement (Step 4-5).

**Run `npm run test` after this step.**

## Walkthrough: KG Floor Plan

### Structural boundaries computed from envelope:

```
H targets:
  y=1023.2  thick=31.1  (envelope top inner face)
  y=1815.6  thick=29.8  (envelope bottom inner face)
  y=1413.15 thick=25.1  (spanning wall upper face)
  y=1438.25 thick=25.1  (spanning wall lower face)

V targets:
  x=678.6   thick=31.4  (envelope left inner face)
  x=1613.6  thick=29.4  (envelope right inner face)
```

### Room 2 (upper-right) detection:

**Edge constraining** (Step 2-3):
- Edge 0 (H, y=1020.9): snap to y=1023.2 (envelope top, delta=+2.3)
- Edge 1 (V, x=1616.4): snap to x=1613.6 (envelope right, delta=-2.8)
- Edge 2 (H, y=1415.4): snap to y=1413.15 (spanning upper, delta=-2.25)
- Edge 3 (V, x=1200): no match (interior, far from all boundaries)
- Edge 4 (H, y=1021.9): snap to y=1023.2 (envelope top, delta=+1.3)
- Edge 5 (V, x=1401.8): no match (interior)

Result: Room edges precisely on skeleton boundaries. Notch artifact at edges 4/5 collapses (both snap to same y=1023.2).

**Wall property enforcement** (Step 4-5):
After syncFloorWalls creates walls for Room 2:
- Top wall (y≈1023.2): matches envelope top → thickness = snapToWallType(31.1) = 30cm ✓
- Right wall (x≈1613.6): matches envelope right → thickness = snapToWallType(29.4) = 30cm ✓
- Bottom wall (y≈1413.15): matches spanning upper → thickness = snapToWallType(25.1) = 24cm ✓
- Left wall (x≈1200): no match → keeps default or detection-based thickness
- All walls: height = 240cm (from wallDefaults)

### Subsequent rooms (3, 4, 5):

When Room 5 is detected later, its right wall at x≈1613.6 is created with default 12cm. Then `enforceSkeletonWallProperties` (inside syncFloorWalls) detects that it aligns with the envelope right edge → sets thickness to 30cm. **This fixes the core bug** — every sync run re-enforces skeleton properties, regardless of detection order.

## Files Modified

| File | Change |
|------|--------|
| `src/envelope.js` | Add `computeStructuralBoundaries()`, `constrainRoomToStructuralBoundaries()`, `enforceSkeletonWallProperties()` |
| `src/room-detection-controller.js` | Call `constrainRoomToStructuralBoundaries()` after alignment |
| `src/walls.js` | Call `enforceSkeletonWallProperties()` in `syncFloorWalls()` |
| `src/room-detection.verify.test.js` | Add E2E test for skeleton constraint enforcement |

## What This Does NOT Change

- Room detection algorithm (`detectRoomAtPixel`) — still pure image processing
- Envelope detection — assumed correct per user direction
- Door gap detection — unchanged
- Manual room creation — unaffected (no envelope constraints on manual rooms)
- `classifyRoomEdges` / `assignWallTypesFromClassification` — kept for interior edge handling and extending edge detection

## Plan Scorecard

### Hacky (0 = duct tape, 10 = clean)

0→1: Top-down enforcement from skeleton — not patching the bottom-up classification pipeline.
1→2: `enforceSkeletonWallProperties` runs on every sync, making it order-independent (fixes the "first room gets correct thickness" bug).
2→3: `computeStructuralBoundaries` extracts the mental model once, shared by both edge constraining and wall enforcement.
3→4: Wall thickness comes from actual measurements stored in envelope, not from position-based type assumptions.
4→5: Edge constraining reshapes the polygon (fixes root cause) instead of just translating (symptom).
5→6: Integrates into existing `syncFloorWalls` — no new lifecycle hooks or event handlers.
6→7: Falls back gracefully — walls not near any boundary keep their existing properties.
7→8: No special-casing for KG or any specific floor plan.

**Score: 8**

### Compliance (0 = violates everything, 10 = textbook)

0→1: Right layer: skeleton logic in envelope.js, wall sync in walls.js, orchestration in controller.
1→2: Uses existing data structures (envelope.polygonCm, wallThicknesses, spanningWalls).
2→3: Uses existing constants (FLOOR_PLAN_RULES.alignmentToleranceCm) and helpers (snapToWallType).
3→4: Includes console.log with `[skeleton]` and `[constrain]` prefixes per CLAUDE.md.
4→5: E2E test scenario defined in the plan.
5→6: One logical change per step → test.
6→7: No scope creep — doesn't change detection, rectification, or rendering.
7→8: Follows coordinate convention: floor-global for structural operations.

**Score: 8**

### Complexity (0 = extremely complex, 10 = minimal)

0→1: `computeStructuralBoundaries` is ~50 lines of straightforward geometry (same logic as `alignToEnvelope` inner face computation, extracted).
1→2: `constrainRoomToStructuralBoundaries` is ~40 lines, single pass over edges.
2→3: `enforceSkeletonWallProperties` is ~50 lines, single pass over walls.
3→4: Integration: ~15 lines in controller, ~2 lines in walls.js.
4→5: No new data structures beyond `{ hTargets, vTargets }`.
5→6: No fixpoint loops — each function is a single pass.
6→7: Total new logic: ~160 lines + ~80 lines of test.

**Score: 8**

### Problem Understanding (0 = guessing, 10 = fully mapped)

0→1: Read the KG state file — computed all 5 rooms' floor-global coordinates.
1→2: Identified the exact wall entities with wrong thickness (c2218=12, c7be7=12, 3a3ba=12, 66199=12).
2→3: Read `syncFloorWalls` (walls.js:635-651) — traced the 5-step pipeline.
3→4: Read `ensureWallsForEdges` (walls.js:94-159) — confirmed it preserves existing thickness on update.
4→5: Read `assignWallTypesFromClassification` (envelope.js:307-392) — understood the classification-based assignment.
5→6: Read `matchEdgeToEnvelope` and `matchEdgeToSpanningWall` — understood the matching logic.
6→7: Read `confirmDetection` (controller.js:370-582) — traced the full ordering of sync → merge → classify → assign → enforce.
7→8: Identified that `enforceSkeletonWallProperties` inside syncFloorWalls eliminates the detection-order dependency that causes the current bug.
8→9: Confirmed no existing `constrainTo*` function exists (grep for the pattern returned empty).
9→10: Verified wall height issue (200 vs 240) is caused by per-room height assignment in confirmDetection — enforceSkeletonWallProperties fixes this globally.

**Score: 10**

### Confidence (0 = hope, 10 = certain)

0→1: Edge constraining math is provably correct for axis-aligned polygons — single coordinate adjustment per edge.
1→2: `enforceSkeletonWallProperties` is deterministic — same envelope data → same wall properties, regardless of room detection order.
2→3: KG walkthrough shows Room 2's edges snapping to exact skeleton positions (y=1023.2, x=1613.6, y=1413.15).
3→4: Room 5's right wall (currently 12cm) would be fixed by enforceSkeletonWallProperties on next sync.
4→5: Interior edges (x=1200, x=955.5) are provably far from any skeleton boundary — won't be incorrectly matched.
5→6: Tolerance (`thickness + 6cm`) covers all observed errors (max 4.5cm) with margin.
6→7: Function is additive and idempotent — running it on already-correct walls is a no-op.
7→8: 1289 existing tests catch regressions in wall sync, envelope detection, polygon processing.
8→9: The fix for wall height (200→240) is a bonus — verified the confirmDetection height loop only covers the new room's edges.

**Score: 9**
