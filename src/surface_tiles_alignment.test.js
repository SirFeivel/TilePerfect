/**
 * E2E tests for computeSurfaceTiles — canonical tile pipeline.
 * Exercises full pipeline: region → computeAvailableArea → tilesForPreview.
 */
import { describe, it, expect } from "vitest";
import { computeSurfaceTiles } from "./walls.js";

// Minimal state factory
function makeState(roomId = "r1", floorId = "f1", overrides = {}) {
  return {
    floors: [
      {
        id: floorId,
        rooms: [
          {
            id: roomId,
            polygonVertices: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
            ],
            tile: { widthCm: 20, heightCm: 20, shape: "rect" },
            grout: { widthCm: 0.2, colorHex: "#cccccc" },
            pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
            exclusions: [],
            excludedTiles: [],
            ...overrides,
          },
        ],
        walls: [],
      },
    ],
    selectedFloorId: floorId,
    selectedRoomId: roomId,
    view: {},
  };
}

function getRoom(state) {
  return state.floors[0].rooms[0];
}

function getFloor(state) {
  return state.floors[0];
}

// --- Scenario 1: Basic floor room, no exclusions, no doorways ---
describe("computeSurfaceTiles — basic floor room", () => {
  it("returns 25 tiles for 100×100 room with 20×20 grid tiles", () => {
    const state = makeState();
    const room = getRoom(state);
    const floor = getFloor(state);
    const effectiveSettings = { tile: room.tile, grout: room.grout, pattern: room.pattern };

    const result = computeSurfaceTiles(state, room, floor, {
      exclusions: [],
      includeDoorwayPatches: false,
      effectiveSettings,
      isRemovalMode: false,
    });

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBe(25);
    expect(result.groutColor).toBe("#cccccc");
  });
});

// --- Scenario 2: Room with exclusion reduces tile count ---
describe("computeSurfaceTiles — room with exclusion", () => {
  it("tile count < 25 when 50×50 exclusion is present", () => {
    const state = makeState();
    const room = getRoom(state);
    const floor = getFloor(state);
    const effectiveSettings = { tile: room.tile, grout: room.grout, pattern: room.pattern };

    const exclusion = { type: "rect", x: 0, y: 0, w: 50, h: 50 };

    const result = computeSurfaceTiles(state, room, floor, {
      exclusions: [exclusion],
      includeDoorwayPatches: false,
      effectiveSettings,
      isRemovalMode: false,
    });

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);
    expect(result.tiles.length).toBeLessThan(25);
  });
});

// --- Scenario 3: Wall surface region (non-room) ---
describe("computeSurfaceTiles — wall surface region", () => {
  it("returns tiles > 0 and correct groutColor for a 200×100 region", () => {
    const state = makeState();
    const floor = getFloor(state);

    const region = {
      id: "wall-region-1",
      widthCm: 200,
      heightCm: 100,
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ],
      tile: { widthCm: 20, heightCm: 20, shape: "rect" },
      grout: { widthCm: 0.2, colorHex: "#aabbcc" },
      pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
      exclusions: [],
    };
    const effectiveSettings = { tile: region.tile, grout: region.grout, pattern: region.pattern };

    const result = computeSurfaceTiles(state, region, floor, {
      exclusions: [],
      includeDoorwayPatches: false,
      effectiveSettings,
      isRemovalMode: false,
    });

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);
    expect(result.groutColor).toBe("#aabbcc");
  });
});

// --- Scenario 4: Bug regression — region geometry is used, not getCurrentRoom(state) ---
describe("computeSurfaceTiles — region ≠ getCurrentRoom(state)", () => {
  it("tile count reflects region B geometry, not selected room A geometry", () => {
    // State selects room A (100×100), but we call computeSurfaceTiles with region B (40×40)
    const state = makeState("roomA");
    const floor = getFloor(state);

    const regionB = {
      id: "regionB",
      widthCm: 40,
      heightCm: 40,
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ],
      tile: { widthCm: 20, heightCm: 20, shape: "rect" },
      grout: { widthCm: 0.2, colorHex: "#ffffff" },
      pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
      exclusions: [],
    };
    const effectiveSettings = { tile: regionB.tile, grout: regionB.grout, pattern: regionB.pattern };

    // Room A (100×100 with 20×20 tiles) would give 25 tiles
    // Region B (40×40 with 20×20 tiles) should give 4 tiles
    const result = computeSurfaceTiles(state, regionB, floor, {
      exclusions: [],
      includeDoorwayPatches: false,
      effectiveSettings,
      isRemovalMode: false,
    });

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBe(4);
  });
});

// --- Scenario 5: Removal mode propagation ---
describe("computeSurfaceTiles — removal mode propagation", () => {
  it("excluded tile is absent in normal mode, present and marked in removal mode", () => {
    const state = makeState();
    const room = getRoom(state);
    const floor = getFloor(state);
    const effectiveSettings = { tile: room.tile, grout: room.grout, pattern: room.pattern };

    // First pass: get a valid tile ID
    const initial = computeSurfaceTiles(state, room, floor, {
      exclusions: [],
      includeDoorwayPatches: false,
      effectiveSettings,
      isRemovalMode: false,
    });

    expect(initial.tiles.length).toBeGreaterThan(0);
    const targetId = initial.tiles[0].id;

    // Mark tile as excluded in state
    room.excludedTiles = [targetId];
    state.floors[0].rooms[0].excludedTiles = [targetId];

    // Normal mode: excluded tile absent
    const normalResult = computeSurfaceTiles(state, room, floor, {
      exclusions: [],
      includeDoorwayPatches: false,
      effectiveSettings,
      isRemovalMode: false,
    });
    expect(normalResult.tiles.find(t => t.id === targetId)).toBeUndefined();

    // Removal mode: excluded tile present and marked
    const removalResult = computeSurfaceTiles(state, room, floor, {
      exclusions: [],
      includeDoorwayPatches: false,
      effectiveSettings,
      isRemovalMode: true,
    });
    const excludedTile = removalResult.tiles.find(t => t.id === targetId);
    expect(excludedTile).toBeDefined();
    expect(excludedTile.excluded).toBe(true);
  });
});
