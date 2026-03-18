/**
 * E2E tests for the exclusion-based surface split.
 *
 * Verifies that:
 *  1. splitPolygonByLine returns the correct two sub-polygons.
 *  2. excl.addFreeform adds a freeform exclusion to the target (floor room or wall surface).
 *  3. The full pipeline: draw → onComplete → split → addFreeform → state updated.
 */
import { describe, it, expect, vi } from "vitest";
import { splitPolygonByLine } from "./geometry.js";
import { createExclusionsController } from "./exclusions.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const RECT_100 = [
  { x: 0,   y: 0   },
  { x: 100, y: 0   },
  { x: 100, y: 100 },
  { x: 0,   y: 100 },
];

function polygonArea(verts) {
  let area = 0;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    area += (verts[j].x + verts[i].x) * (verts[j].y - verts[i].y);
  }
  return Math.abs(area) / 2;
}

function makeRoom(overrides = {}) {
  return {
    id: "r1",
    polygonVertices: RECT_100,
    exclusions: [],
    widthCm: 100,
    heightCm: 100,
    ...overrides,
  };
}

function makeState(roomOverrides = {}) {
  return {
    floors: [{ id: "f1", rooms: [makeRoom(roomOverrides)], walls: [] }],
    selectedFloorId: "f1",
    selectedRoomId: "r1",
  };
}

// ── splitPolygonByLine ────────────────────────────────────────────────────────

describe("splitPolygonByLine", () => {
  it("horizontal split of 100×100 square → two 100×50 rectangles", () => {
    const [a, b] = splitPolygonByLine(RECT_100, { x: 0, y: 50 }, { x: 100, y: 50 });
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(polygonArea(a)).toBeCloseTo(5000, 0);
    expect(polygonArea(b)).toBeCloseTo(5000, 0);
    expect(polygonArea(a) + polygonArea(b)).toBeCloseTo(10000, 0);
  });

  it("vertical split → two 50×100 rectangles", () => {
    const [a, b] = splitPolygonByLine(RECT_100, { x: 50, y: 0 }, { x: 50, y: 100 });
    expect(polygonArea(a)).toBeCloseTo(5000, 0);
    expect(polygonArea(b)).toBeCloseTo(5000, 0);
  });

  it("asymmetric split → two polygons whose areas sum to 10000", () => {
    // cut at y=25: one 100×25 piece and one 100×75 piece
    const [a, b] = splitPolygonByLine(RECT_100, { x: 0, y: 25 }, { x: 100, y: 25 });
    const areaA = polygonArea(a);
    const areaB = polygonArea(b);
    expect(areaA + areaB).toBeCloseTo(10000, 0);
    const smaller = Math.min(areaA, areaB);
    const larger  = Math.max(areaA, areaB);
    expect(smaller).toBeCloseTo(2500, 0);
    expect(larger).toBeCloseTo(7500, 0);
  });

  it("smaller polygon identified correctly (min area)", () => {
    const polys = splitPolygonByLine(RECT_100, { x: 0, y: 20 }, { x: 100, y: 20 });
    const areas = polys.map(polygonArea);
    const smallerIdx = areas[0] < areas[1] ? 0 : 1;
    expect(areas[smallerIdx]).toBeCloseTo(2000, 0); // 100 * 20
  });
});

// ── excl.addFreeform ──────────────────────────────────────────────────────────

describe("createExclusionsController.addFreeform", () => {
  it("adds a freeform exclusion with the given vertices to the current room", () => {
    let state = makeState();
    let committed = null;
    let selectedId = null;

    const excl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const halfPoly = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    excl.addFreeform(halfPoly);

    expect(committed).not.toBeNull();
    const room = committed.floors[0].rooms[0];
    expect(room.exclusions).toHaveLength(1);
    expect(room.exclusions[0].type).toBe("freeform");
    expect(room.exclusions[0].vertices).toHaveLength(4);
    expect(room.exclusions[0].vertices[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("sets the selected exclusion id after addFreeform", () => {
    let state = makeState();
    let selectedId = null;

    const excl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    excl.addFreeform([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 0, y: 100 }]);
    expect(selectedId).not.toBeNull();
    expect(typeof selectedId).toBe("string");
  });

  it("rejects vertices arrays shorter than 3", () => {
    let state = makeState();
    let committed = null;

    const excl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; },
      getSelectedId: () => null,
      setSelectedId: () => {},
    });

    excl.addFreeform([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(committed).toBeNull();
  });

  it("wall surface target: addFreeform routes to wall surface, not floor room", () => {
    const surface = { exclusions: [], roomId: "r1" };
    let state = {
      floors: [{ id: "f1", rooms: [makeRoom()], walls: [{ id: "w1", surfaces: [surface] }] }],
      selectedFloorId: "f1", selectedRoomId: "r1", selectedWallId: "w1",
    };
    let committed = null;

    const excl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; },
      getSelectedId: () => null,
      setSelectedId: () => {},
      getTarget: (s) => s.floors[0].walls[0].surfaces[0],
    });

    excl.addFreeform([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }]);
    expect(committed).not.toBeNull();
    // Exclusion on wall surface, NOT on floor room
    expect(committed.floors[0].walls[0].surfaces[0].exclusions).toHaveLength(1);
    expect(committed.floors[0].rooms[0].exclusions).toHaveLength(0);
  });
});

// ── full pipeline: split → smaller polygon → addFreeform ─────────────────────

describe("split → addFreeform pipeline", () => {
  it("horizontal split: smaller polygon (top half) becomes freeform exclusion in room", () => {
    let state = makeState();
    let committed = null;
    let selectedId = null;

    const excl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    // Simulate onComplete({ p1, p2 }) handler logic
    const p1 = { x: 0, y: 25 };
    const p2 = { x: 100, y: 25 };
    const polygonVertices = RECT_100;
    const polys = splitPolygonByLine(polygonVertices, p1, p2);
    expect(polys).toHaveLength(2);
    const areas = polys.map(polygonArea);
    const smallerIdx = areas[0] <= areas[1] ? 0 : 1;
    const smallerPoly = polys[smallerIdx];

    excl.addFreeform(smallerPoly);

    const room = committed.floors[0].rooms[0];
    expect(room.exclusions).toHaveLength(1);
    expect(room.exclusions[0].type).toBe("freeform");
    // Smaller polygon area should be 2500 (100×25)
    expect(polygonArea(room.exclusions[0].vertices)).toBeCloseTo(2500, 0);
  });

  it("degenerate split (p1 === p2) returns null", () => {
    const result = splitPolygonByLine(RECT_100, { x: 50, y: 0 }, { x: 50, y: 0 });
    expect(result).toBeNull();
  });

  it("symmetric split: either polygon can be used; both are valid freeform exclusions", () => {
    let state = makeState();
    let committed = null;

    const excl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; },
      getSelectedId: () => null,
      setSelectedId: () => {},
    });

    const [a] = splitPolygonByLine(RECT_100, { x: 0, y: 50 }, { x: 100, y: 50 });
    excl.addFreeform(a);
    expect(committed.floors[0].rooms[0].exclusions[0].type).toBe("freeform");
  });
});
