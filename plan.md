# Plan: Room Autodetect Feature — Continuation

**Branch:** `wall-type-classification`
**Date:** 2026-02-19
**Status:** Step 5 (wall type classification) complete, all tests pass

---

## Current State

All 1187 tests pass.

### Completed Steps (this branch)
1. **Step 2** — Detect floor envelope (outer building boundary) after calibration
2. **Step 3** — Detect full-span structural walls inside the envelope
3. **Step 4** — Discover valid wall angles from the envelope
4. **Step 5** — Classify wall types + auto-correct to defaults ← NEW

### Step 5 Changes
- `src/floor-plan-rules.js`: Added `DEFAULT_WALL_TYPES`, `DEFAULT_FLOOR_HEIGHT_CM`, `snapToWallType()`, `classifyWallTypes()`
- `src/room-detection-controller.js`: `detectAndStoreEnvelope` stores `wallTypes` + `wallDefaults`; `confirmDetection` uses `snapToWallType` instead of `Math.round`, applies floor height
- `src/state.js`: Added `wallDefaults` normalization guard
- `src/floor-plan-rules.test.js`: 17 new unit tests (snap, classify, constants)
- `src/room-detection.verify.test.js`: 3 new E2E tests (classification on 300dpi data)

### Runtime behavior changes
| Before | After |
|--------|-------|
| `wall.thicknessCm = Math.round(31.1)` → 31 | `snapToWallType(31.1)` → 30 (outer) |
| `wall.thicknessCm = Math.round(25.5)` → 26 | `snapToWallType(25.5)` → 24 (structural) |
| Wall heights = 200cm | Wall heights = 240cm (from `wallDefaults.heightCm`) |
| No wall types stored | `envelope.wallTypes` + `wallDefaults` stored |

### Data model additions
```js
floor.layout.envelope.wallTypes = [{ id, thicknessCm }, ...]; // discovered from image
floor.layout.wallDefaults = { types: [...], heightCm: 240 };  // predefined, user-configurable later
```

---

## Architecture Notes

### Coordinate spaces
- **SVG cm coords**: used everywhere in the app (floor-global)
- **Image pixel coords**: native pixel coords of the background PNG
- Conversion in `room-detection-controller.js`:
  - `cmToImagePx(cmX, cmY, bg)` → `{ x, y }` pixel
  - `imagePxToCm(px, py, bg)` → `{ x, y }` cm

### Key parameters (auto-computed from `pixelsPerCm`)
| Parameter | Formula | Purpose |
|-----------|---------|---------|
| `radius` | `clamp(3, round(80×ppc), 300)` | Morphological close radius |
| `openRadius` | `clamp(0, round(4×ppc), 5)` | Open radius (noise removal) |
| `epsilon` | `max(1, round(4×ppc))` | Douglas-Peucker tolerance |
| `minGapPx` | `max(2, round(45×ppc))` | Minimum door gap (≈45 cm) |
| `maxGapPx` | `round(250×ppc)` | Maximum door gap (≈250 cm) |
| `searchDepthPx` | `max(3, round(15×ppc))` | Perpendicular probe depth |

### Files involved
| File | Role |
|------|------|
| `src/room-detection.js` | Pure functions only — image processing |
| `src/room-detection-controller.js` | DOM/state controller, coordinate conversion |
| `src/room-detection.test.js` | Unit tests (no DOM, synthetic images) |
| `src/room-detection.verify.test.js` | Integration test (real image, local files) |
| `index.html` | Button `#bgDetectRoom` + panel `#roomDetectionPanel` |
| `src/i18n.js` | `roomDetection.*` translation keys |
| `src/main.js` | Controller instantiation + event wiring |
