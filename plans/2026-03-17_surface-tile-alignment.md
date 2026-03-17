# Plan: Surface Tile Compute / Render Alignment
**Date:** 2026-03-17
**Branch:** surface_adjustments
**File:** plans/2026-03-17_surface-tile-alignment.md

---

## Context

Tile geometry (`computeAvailableArea` + doorway union + `tilesForPreview`) is currently computed independently in 6 places across render.js, main.js, and calc.js. This causes:

1. **Confirmed bug** at `render.js:2024`: `isRemovalMode` (boolean) is passed as the `roomOrInclude` argument to `tilesForPreview`. Because of the overloaded signature, this makes `finalRoom = getCurrentRoom(state)` instead of the `currentRoom` (which may be a wall surface region passed as `roomOverride`). The 3D path passes `room` correctly. 2D and 3D are structurally diverged.
2. **Doorway patch format divergence**: render.js uses `"multipolygon"` format; main.js uses `"vertices"` with manual ring-closing. Both produce the same result but the duplication is fragile.
3. **No single source of truth**: a future state change could silently affect one path without the other.

**Scope of this plan:** Establish one canonical `computeSurfaceTiles()` function. Both 2D (`renderPlanSvg`, `renderFloorCanvas`) and 3D (`prepareRoom3DData`, `prepareFloorWallData`) consume it. `calc.js` is explicitly deferred to a follow-up.

---

## Scorecard

| Dimension | Score | Evidence |
|---|---|---|
| **Hacky** | 8 | Clean extraction. Callers pass effectiveSettings/originOverride explicitly — no hidden magic. Placement in walls.js is pragmatic (computeDoorwayFloorPatches already lives there, no circular dep). |
| **Compliance** | 8 | geometry.js stays pure geometry. render.js stays render-only. main.js stays orchestration. No circular deps. One source of truth established. |
| **Complexity** | 8 | One new exported function in walls.js. Callers updated. No new files. Backward compat for export.js and tests preserved via unchanged signatures. |
| **Problem Understanding** | 9 | All 7 call sites read. prepareTileContext fully traced. getRoomBounds confirmed works with all region types (uses polygonVertices only). Circular dep geometry.js↔walls.js identified and resolved by placing in walls.js. Multipolygon format confirmed directly passable to polygonClipping.union. render.js existing import of walls.js confirmed (line 25). |
| **Confidence** | 8 | All blocking risks resolved. The one remaining unknown is runtime visual verification — explicitly unverified until user confirms. |

---

## Architecture Decision: Placement of `computeSurfaceTiles`

`computeSurfaceTiles` cannot live in `geometry.js` because:
- `walls.js` already imports from `geometry.js` → adding `geometry.js → walls.js` would create a circular dependency.

`computeSurfaceTiles` belongs in **`walls.js`** because:
- `computeDoorwayFloorPatches` (used internally) is already in `walls.js`
- `render.js` already imports from `walls.js` (line 25)
- `main.js` already imports from `walls.js` (line 18)
- No circular dependency
- No new file required

`computeSurfaceTiles` does NOT import from `pattern-groups.js`. Callers are required to pass `effectiveSettings` and `originOverride` explicitly. This keeps the function a clean pipeline wrapper.

---

## Critical Files

| File | Role |
|------|------|
| `src/walls.js` | ADD `computeSurfaceTiles` export here |
| `src/render.js` | MIGRATE lines 2003–2024 (`renderPlanSvg`) and lines 3181–3214 (`renderFloorCanvas`) |
| `src/main.js` | MIGRATE lines 464–488 (floor tiles), 568–576 (face tiles), 654–657 (wall tiles) |
| `src/geometry.js` | READ ONLY — `computeAvailableArea`, `tilesForPreview` stay untouched |
| `src/pattern-groups.js` | READ ONLY — callers continue using `computePatternGroupOrigin`, `getEffectiveTileSettings` before calling `computeSurfaceTiles` |

---

## Implementation

**Executed:** 2026-03-17

### What was done

1. **Step 1 — walls.js**: Added `import polygonClipping` and `import { computeAvailableArea, tilesForPreview }` to walls.js. Added `computeSurfaceTiles` export after `computeDoorwayFloorPatches`.

2. **Step 2 — render.js renderPlanSvg**: Added `computeSurfaceTiles` to walls.js import. Replaced `computeAvailableArea` + doorway union loop + `tilesForPreview` block with single `computeSurfaceTiles` call. Fixed the confirmed bug: `currentRoom` (region) is now always passed explicitly rather than falling through the overloaded boolean parameter.

3. **Step 3 — render.js renderFloorCanvas**: Replaced the same pattern in the floor canvas tile loop with `computeSurfaceTiles`. Switched `groutColor` to come from `tileResult.groutColor` rather than being derived inline.

4. **Step 4 — main.js prepareRoom3DData floor tiles**: Added `computeSurfaceTiles` to walls.js import. Replaced `computeAvailableArea` + ring-closing loop + `tilesForPreview` with `computeSurfaceTiles`. Kept `doorwayFloorPatches` ("vertices" format) separate — it is still needed for 3D mesh geometry in `desc.doorwayFloorPatches`.

5. **Step 5 — main.js prepareRoom3DData face tiles**: Replaced `computeAvailableArea` + `tilesForPreview` for object face tiles with `computeSurfaceTiles`.

6. **Step 6 — main.js prepareFloorWallData wall surface tiles**: Replaced `computeAvailableArea` + `tilesForPreview` for wall surface tiles with `computeSurfaceTiles`.

7. **Step 7 — E2E tests**: Created `src/surface_tiles_alignment.test.js` with 5 scenarios.

### Core findings

- The `doorwayFloorPatches` variable in `prepareRoom3DData` serves two purposes: (1) tile area extension and (2) 3D mesh geometry input. Only the tile computation was migrated; the "vertices" format patches are preserved unchanged for the 3D path.
- `computeSurfaceTiles` internally calls `computeDoorwayFloorPatches` with `"multipolygon"` format, eliminating the format divergence between render.js and main.js.
- No unused imports were left behind — `computeAvailableArea` and `tilesForPreview` remain in geometry.js and are used directly by test files; `polygonClipping` in main.js is still used for other purposes.

### Final test count

**62 test files, 1403 tests passing, 7 skipped** (baseline was 61 files, 1398 tests — 5 new E2E tests added, all passing).
