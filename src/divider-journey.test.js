/**
 * @vitest-environment jsdom
 *
 * Full customer journey tests for the surface divider feature.
 * Tests the complete pipeline end-to-end:
 *   draw (PointerEvents) → split → addFreeform → state update
 *   → selection → deletion → sub-surface configuration
 *   → wall surface variant
 *
 * No mocks on code under test. All modules are real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDividerDrawController } from "./divider-draw.js";
import { createExclusionsController } from "./exclusions.js";
import { splitPolygonByLine } from "./geometry.js";
import { getCurrentRoom } from "./core.js";

// ── shared helpers ─────────────────────────────────────────────────────────────

const RECT_100 = [
  { x: 0,   y: 0   },
  { x: 100, y: 0   },
  { x: 100, y: 100 },
  { x: 0,   y: 100 },
];

function polygonArea(verts) {
  let a = 0;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++)
    a += (verts[j].x + verts[i].x) * (verts[j].y - verts[i].y);
  return Math.abs(a) / 2;
}

function makeRoom(overrides = {}) {
  return {
    id: "r1",
    polygonVertices: RECT_100,
    exclusions: [],
    widthCm: 100,
    heightCm: 100,
    tile: { widthCm: 20, heightCm: 20, shape: "rect" },
    grout: { widthCm: 0.2, colorHex: "#cccccc" },
    pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
    ...overrides,
  };
}

function makeFloorState(roomOverrides = {}) {
  return {
    floors: [{ id: "f1", rooms: [makeRoom(roomOverrides)], walls: [] }],
    selectedFloorId: "f1",
    selectedRoomId: "r1",
    tilePresets: [
      { id: "p1", name: "20cm Grid", widthCm: 20, heightCm: 20, shape: "rect" },
      { id: "p2", name: "10cm Small", widthCm: 10, heightCm: 10, shape: "rect" },
    ],
  };
}

function makeWallState(surfaceOverrides = {}) {
  const surface = {
    id: "s1",
    roomId: "r1",
    edgeIndex: 0,
    fromCm: 0,
    toCm: 100,
    tile: null,
    grout: null,
    pattern: null,
    exclusions: [],
    ...surfaceOverrides,
  };
  return {
    floors: [{
      id: "f1",
      rooms: [makeRoom()],
      walls: [{
        id: "w1",
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        heightStartCm: 240,
        surfaces: [surface],
      }],
    }],
    selectedFloorId: "f1",
    selectedRoomId: "r1",
    selectedWallId: "w1",
    tilePresets: [
      { id: "p1", name: "20cm Grid", widthCm: 20, heightCm: 20, shape: "rect" },
    ],
  };
}

function createMockSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.appendChild(svg);
  const ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; } };
  svg.getScreenCTM = () => ctm;
  svg.createSVGPoint = () => {
    const pt = { x: 0, y: 0 };
    pt.matrixTransform = (m) => ({
      x: pt.x * m.a + pt.y * (m.c || 0) + (m.e || 0),
      y: pt.x * (m.b || 0) + pt.y * m.d + (m.f || 0),
    });
    return pt;
  };
  return svg;
}

const move = (el, x, y) => el.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
const down = (el, x, y) => el.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true }));
const key  = (k)         => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

// Replicates the split→addFreeform onComplete handler from main.js
function buildOnComplete(getVerts, exclCtrl) {
  return ({ p1, p2 }) => {
    const verts = getVerts();
    if (!verts?.length) return;
    const polys = splitPolygonByLine(verts, p1, p2);
    if (!polys || polys.length < 2) return;
    const areas = polys.map(p => {
      let a = 0;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++)
        a += (p[j].x + p[i].x) * (p[j].y - p[i].y);
      return Math.abs(a) / 2;
    });
    const smallerIdx = areas[0] <= areas[1] ? 0 : 1;
    exclCtrl.addFreeform(polys[smallerIdx]);
  };
}

// Wire a complete divider session: activate draw, click edge1, click edge2
function drawDivider(svg, drawCtrl, x1, y1, x2, y2) {
  drawCtrl.start();
  move(svg, x1, y1); down(svg, x1, y1);
  move(svg, x2, y2); down(svg, x2, y2);
}

// ── Journey 1: floor room – create, select, delete ────────────────────────────

describe("Journey 1: floor room — create, select, delete divider", () => {
  let svg;
  beforeEach(() => { document.body.innerHTML = ""; svg = createMockSvg(); });
  afterEach(()  => { document.body.innerHTML = ""; });

  it("create divider: freeform exclusion appears in room state", () => {
    let state = makeFloorState();
    let selectedId = null;
    const commits = [];

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (label, next) => { commits.push(label); state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    drawDivider(svg, drawCtrl, 1, 50, 99, 50);

    const room = state.floors[0].rooms[0];
    expect(room.exclusions).toHaveLength(1);
    expect(room.exclusions[0].type).toBe("freeform");
    expect(room.exclusions[0].vertices.length).toBeGreaterThanOrEqual(3);
    // The exclusion is selected immediately after creation
    expect(selectedId).toBe(room.exclusions[0].id);
    // A commit was recorded
    expect(commits).toHaveLength(1);
  });

  it("create divider: smaller polygon is the exclusion (25% cut)", () => {
    let state = makeFloorState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    // Cut at y=20 → smaller piece is 100×20 = 2000 cm²
    drawDivider(svg, drawCtrl, 1, 20, 99, 20);

    const excl = state.floors[0].rooms[0].exclusions[0];
    expect(polygonArea(excl.vertices)).toBeCloseTo(2000, 0);
  });

  it("selected exclusion is retrievable via getSelectedExcl()", () => {
    let state = makeFloorState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    drawDivider(svg, drawCtrl, 1, 50, 99, 50);

    const sel = exclCtrl.getSelectedExcl();
    expect(sel).not.toBeNull();
    expect(sel.type).toBe("freeform");
  });

  it("delete divider: exclusion removed from room state", () => {
    let state = makeFloorState();
    let selectedId = null;
    const commits = [];

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (label, next) => { commits.push(label); state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    drawDivider(svg, drawCtrl, 1, 50, 99, 50);
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(1);

    exclCtrl.deleteSelectedExcl();

    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
    expect(selectedId).toBeNull();
    expect(commits).toHaveLength(2); // create + delete
  });

  it("delete non-selected: calling deleteSelectedExcl with no selection does nothing", () => {
    let state = makeFloorState();
    let selectedId = null;
    let committed = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    // No divider drawn — nothing selected
    exclCtrl.deleteSelectedExcl();
    expect(committed).toBeNull();
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
  });
});

// ── Journey 2: two dividers, delete one ──────────────────────────────────────

describe("Journey 2: two dividers created, one deleted", () => {
  let svg;
  beforeEach(() => { document.body.innerHTML = ""; svg = createMockSvg(); });
  afterEach(()  => { document.body.innerHTML = ""; });

  it("two draws produce two freeform exclusions; deleting one leaves one", () => {
    let state = makeFloorState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => state.floors[0].rooms[0].polygonVertices,
      onComplete: buildOnComplete(() => state.floors[0].rooms[0].polygonVertices, exclCtrl),
      onCancel: () => {},
    });

    // First cut: horizontal at y=30
    drawDivider(svg, drawCtrl, 1, 30, 99, 30);
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(1);
    const firstId = selectedId;

    // Second cut: the room now has a freeform exclusion and its base polygon is RECT_100.
    // We cut the base polygon again at y=70.
    drawDivider(svg, drawCtrl, 1, 70, 99, 70);
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(2);

    // Delete the second (currently selected)
    exclCtrl.deleteSelectedExcl();
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(1);
    expect(state.floors[0].rooms[0].exclusions[0].id).toBe(firstId);
  });

  it("areas of two exclusions are both < 50% of the room", () => {
    let state = makeFloorState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    drawDivider(svg, drawCtrl, 1, 25, 99, 25); // 25% cut
    drawDivider(svg, drawCtrl, 1, 75, 99, 75); // 25% cut from other side (but always picks smaller)

    const exclusions = state.floors[0].rooms[0].exclusions;
    expect(exclusions).toHaveLength(2);
    for (const ex of exclusions) {
      expect(polygonArea(ex.vertices)).toBeLessThan(5001); // always ≤ 50%
    }
  });
});

// ── Journey 3: sub-surface configuration (tile/grout/pattern) ─────────────────

describe("Journey 3: configure divider as sub-surface via DOM", () => {
  let svg;
  beforeEach(() => { document.body.innerHTML = ""; svg = createMockSvg(); });
  afterEach(()  => { document.body.innerHTML = ""; });

  it("commitSubSurface sets tile/grout/pattern on the freeform exclusion", () => {
    let state = makeFloorState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    drawDivider(svg, drawCtrl, 1, 50, 99, 50);
    expect(selectedId).not.toBeNull();

    // Simulate DOM elements that commitSubSurface reads (quick bar variant: qss* ids)
    const mk = (id, tag, attrs) => {
      const el = document.createElement(tag);
      el.id = id;
      Object.entries(attrs).forEach(([k, v]) => { el[k] = v; });
      document.body.appendChild(el);
      return el;
    };
    mk("qssEnabled",    "input",  { type: "checkbox", checked: true });
    const sel = mk("qssPreset", "select", {});
    const opt = document.createElement("option");
    opt.value = "p1"; opt.selected = true;
    sel.appendChild(opt);
    mk("qssGroutWidth", "input",  { type: "number",   value: "0.3" });
    mk("qssGroutColor", "input",  { type: "color",    value: "#aabbcc" });
    const patSel = mk("qssPattern", "select", {});
    const patOpt = document.createElement("option");
    patOpt.value = "runningBond"; patOpt.selected = true;
    patSel.appendChild(patOpt);

    exclCtrl.commitSubSurface("sub-surface enabled");

    const excl = state.floors[0].rooms[0].exclusions[0];
    expect(excl.tile).not.toBeNull();
    expect(excl.tile.widthCm).toBe(20);
    expect(excl.tile.reference).toBe("20cm Grid");
    expect(excl.grout.widthCm).toBeCloseTo(0.3, 2);
    expect(excl.grout.colorHex).toBe("#aabbcc");
    expect(excl.pattern.type).toBe("runningBond");
  });

  it("commitSubSurface with enabled=false clears tile/grout/pattern", () => {
    let state = makeFloorState({
      exclusions: [{
        id: "ex1", type: "freeform",
        vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
        tile: { widthCm: 20, heightCm: 20, shape: "rect" },
        grout: { widthCm: 0.2, colorHex: "#ffffff" },
        pattern: { type: "grid" },
      }],
    });
    let selectedId = "ex1";

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const mk = (id, tag, attrs) => {
      const el = document.createElement(tag);
      el.id = id;
      Object.entries(attrs).forEach(([k, v]) => { el[k] = v; });
      document.body.appendChild(el);
    };
    mk("qssEnabled", "input", { type: "checkbox", checked: false });

    exclCtrl.commitSubSurface("sub-surface disabled");

    const excl = state.floors[0].rooms[0].exclusions[0];
    expect(excl.tile).toBeNull();
    expect(excl.grout).toBeNull();
    expect(excl.pattern).toBeNull();
  });

  it("commitSubSurface returns early when no exclusion selected", () => {
    let state = makeFloorState();
    let committed = null;
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const mk = (id, tag, attrs) => {
      const el = document.createElement(tag);
      el.id = id;
      Object.entries(attrs).forEach(([k, v]) => { el[k] = v; });
      document.body.appendChild(el);
    };
    mk("qssEnabled", "input", { type: "checkbox", checked: true });

    exclCtrl.commitSubSurface("noop");
    expect(committed).toBeNull();
  });
});

// ── Journey 4: wall surface — create and delete divider ───────────────────────

describe("Journey 4: wall surface — create and delete divider", () => {
  let svg;
  beforeEach(() => { document.body.innerHTML = ""; svg = createMockSvg(); });
  afterEach(()  => { document.body.innerHTML = ""; });

  // Wall surface polygon: 100cm wide, 240cm tall (matches wall height in makeWallState)
  const WALL_SURFACE = [
    { x: 0,   y: 0   },
    { x: 100, y: 0   },
    { x: 100, y: 240 },
    { x: 0,   y: 240 },
  ];

  it("draw creates freeform exclusion on wall surface, not floor room", () => {
    let state = makeWallState();
    let selectedId = null;

    const wallSurface = (s) => s.floors[0].walls[0].surfaces[0];

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
      getTarget: wallSurface,
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => WALL_SURFACE,
      onComplete: buildOnComplete(() => WALL_SURFACE, exclCtrl),
      onCancel: () => {},
    });

    // Click on left edge (x≈0) and right edge (x≈100) at height y=120
    drawDivider(svg, drawCtrl, 1, 120, 99, 120);

    // Exclusion is on the surface
    expect(state.floors[0].walls[0].surfaces[0].exclusions).toHaveLength(1);
    expect(state.floors[0].walls[0].surfaces[0].exclusions[0].type).toBe("freeform");
    // Floor room is untouched
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
  });

  it("wall surface exclusion area matches smaller half (top half = 100×120 = 12000 cm²)", () => {
    let state = makeWallState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
      getTarget: (s) => s.floors[0].walls[0].surfaces[0],
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => WALL_SURFACE,
      onComplete: buildOnComplete(() => WALL_SURFACE, exclCtrl),
      onCancel: () => {},
    });

    // Cut at y=120 → two 100×120 halves, each = 12000 cm²
    drawDivider(svg, drawCtrl, 1, 120, 99, 120);

    const excl = state.floors[0].walls[0].surfaces[0].exclusions[0];
    expect(polygonArea(excl.vertices)).toBeCloseTo(12000, 0);
  });

  it("delete wall surface divider: exclusion removed from surface", () => {
    let state = makeWallState();
    let selectedId = null;
    const commits = [];

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (label, next) => { commits.push(label); state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
      getTarget: (s) => s.floors[0].walls[0].surfaces[0],
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => WALL_SURFACE,
      onComplete: buildOnComplete(() => WALL_SURFACE, exclCtrl),
      onCancel: () => {},
    });

    drawDivider(svg, drawCtrl, 1, 120, 99, 120);
    expect(state.floors[0].walls[0].surfaces[0].exclusions).toHaveLength(1);

    exclCtrl.deleteSelectedExcl();

    expect(state.floors[0].walls[0].surfaces[0].exclusions).toHaveLength(0);
    expect(commits).toHaveLength(2); // create + delete
  });

  it("snap behaviour on wall surface: moves near edges snap correctly", () => {
    let state = makeWallState();

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => WALL_SURFACE,
      onComplete: () => {},
      onCancel: () => {},
    });

    drawCtrl.start();
    // Move within 2cm of left edge (x=0): snap dot should appear
    move(svg, 1, 120);
    const dot = svg.querySelector("circle");
    expect(dot).not.toBeNull();
    expect(Number(dot.getAttribute("cx"))).toBeCloseTo(0, 1);
    expect(Number(dot.getAttribute("cy"))).toBeCloseTo(120, 1);
    drawCtrl.stop();
  });
});

// ── Journey 5: Escape and cancel ──────────────────────────────────────────────

describe("Journey 5: Escape key cancels mid-draw, no state change", () => {
  let svg;
  beforeEach(() => { document.body.innerHTML = ""; svg = createMockSvg(); });
  afterEach(()  => { document.body.innerHTML = ""; });

  it("Escape before any click: no exclusion, onCancel called", () => {
    let state = makeFloorState();
    let committed = null;
    let cancelled = false;
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => { cancelled = true; },
    });

    drawCtrl.start();
    move(svg, 1, 50);
    key("Escape");

    expect(cancelled).toBe(true);
    expect(committed).toBeNull();
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
  });

  it("Escape after click1: no exclusion, onCancel called, SVG cleaned", () => {
    let state = makeFloorState();
    let committed = null;
    let cancelled = false;
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => { cancelled = true; },
    });

    drawCtrl.start();
    move(svg, 1, 50); down(svg, 1, 50); // click1
    move(svg, 99, 50);                   // preview line visible
    key("Escape");

    expect(cancelled).toBe(true);
    expect(committed).toBeNull();
    expect(svg.querySelector("circle")).toBeNull();
    expect(svg.querySelector("line")).toBeNull();
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
  });
});

// ── Journey 6: quickDivider button enable/disable and click wiring ────────────
//
// main.js is not importable (singleton entry point, no exports).
// We test the exact logic it applies:
//   renderPlanningSection: btn.disabled = !getCurrentRoom(state)
//   click handler:         drawCtrl.isActive() ? stop+deactivate : start+activate

describe("Journey 6: quickDivider button — enable/disable and click wiring", () => {
  let svg;

  function setupButton() {
    const btn = document.createElement("button");
    btn.id = "quickDivider";
    btn.disabled = true; // starts disabled, as in index.html
    document.body.appendChild(btn);
    return btn;
  }

  beforeEach(() => { document.body.innerHTML = ""; svg = createMockSvg(); });
  afterEach(()  => { document.body.innerHTML = ""; });

  // Replicates: if (dividerBtn) dividerBtn.disabled = !getCurrentRoom(state);
  function applyButtonState(btn, state) {
    btn.disabled = !getCurrentRoom(state);
  }

  // Replicates the click handler from main.js
  function wireClickHandler(btn, drawCtrl) {
    btn.addEventListener("click", () => {
      if (drawCtrl.isActive()) {
        drawCtrl.stop();
        btn.classList.remove("active");
      } else {
        drawCtrl.start();
        btn.classList.add("active");
      }
    });
  }

  it("button is disabled when no room is selected", () => {
    const btn = setupButton();
    const state = { floors: [{ id: "f1", rooms: [], walls: [] }], selectedFloorId: "f1", selectedRoomId: null };
    applyButtonState(btn, state);
    expect(btn.disabled).toBe(true);
  });

  it("button is enabled when a floor room is selected", () => {
    const btn = setupButton();
    applyButtonState(btn, makeFloorState());
    expect(btn.disabled).toBe(false);
  });

  it("button is enabled when a wall surface is selected (room still selected)", () => {
    const btn = setupButton();
    applyButtonState(btn, makeWallState());
    expect(btn.disabled).toBe(false);
  });

  it("clicking enabled button calls drawCtrl.start() and adds 'active' class", () => {
    const btn = setupButton();
    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: () => {},
      onCancel: () => {},
    });
    applyButtonState(btn, makeFloorState());
    expect(btn.disabled).toBe(false);

    wireClickHandler(btn, drawCtrl);
    btn.click();

    expect(drawCtrl.isActive()).toBe(true);
    expect(btn.classList.contains("active")).toBe(true);
  });

  it("clicking active button calls drawCtrl.stop() and removes 'active' class", () => {
    const btn = setupButton();
    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: () => {},
      onCancel: () => {},
    });
    applyButtonState(btn, makeFloorState());
    wireClickHandler(btn, drawCtrl);

    btn.click(); // start
    expect(drawCtrl.isActive()).toBe(true);

    btn.click(); // stop (toggle off)
    expect(drawCtrl.isActive()).toBe(false);
    expect(btn.classList.contains("active")).toBe(false);
  });

  it("disabled button click does not start draw mode (jsdom honours disabled)", () => {
    const btn = setupButton(); // stays disabled — no applyButtonState call
    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: () => {},
      onCancel: () => {},
    });
    wireClickHandler(btn, drawCtrl);
    btn.click();
    expect(drawCtrl.isActive()).toBe(false);
  });

  it("full flow through button: click → draw → split → exclusion in state", () => {
    const btn = setupButton();
    let state = makeFloorState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    applyButtonState(btn, state);
    expect(btn.disabled).toBe(false);

    wireClickHandler(btn, drawCtrl);
    btn.click(); // user clicks the button
    expect(drawCtrl.isActive()).toBe(true);

    move(svg, 1, 50);  down(svg, 1, 50);
    move(svg, 99, 50); down(svg, 99, 50);

    expect(state.floors[0].rooms[0].exclusions).toHaveLength(1);
    expect(state.floors[0].rooms[0].exclusions[0].type).toBe("freeform");
  });
});

// ── Journey 7: delete button and Delete key ────────────────────────────────────
//
// main.js wires: #roomDeleteObject click → excl.deleteSelectedExcl()
//               keydown Delete/Backspace → excl.deleteSelectedExcl()
// We replicate that exact wiring in the test.

describe("Journey 7: delete button and Delete key remove the divider exclusion", () => {
  let svg;
  beforeEach(() => { document.body.innerHTML = ""; svg = createMockSvg(); });
  afterEach(()  => { document.body.innerHTML = ""; });

  function wireDeleteButton(btn, getSelectedId, exclCtrl) {
    btn.addEventListener("click", () => {
      if (getSelectedId()) exclCtrl.deleteSelectedExcl();
    });
  }

  function wireDeleteKey(getSelectedId, exclCtrl) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (getSelectedId()) exclCtrl.deleteSelectedExcl();
    });
  }

  it("delete button removes selected freeform exclusion from state", () => {
    let state = makeFloorState();
    let selectedId = null;
    const commits = [];

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (label, next) => { commits.push(label); state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    // Create a divider via draw
    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });
    drawDivider(svg, drawCtrl, 1, 50, 99, 50);
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(1);
    expect(selectedId).not.toBeNull();

    // Wire delete button and click it
    const deleteBtn = document.createElement("button");
    deleteBtn.id = "roomDeleteObject";
    document.body.appendChild(deleteBtn);
    wireDeleteButton(deleteBtn, () => selectedId, exclCtrl);

    deleteBtn.click();

    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
    expect(selectedId).toBeNull();
    expect(commits).toHaveLength(2); // create + delete
  });

  it("delete button with nothing selected does nothing", () => {
    let state = makeFloorState();
    let selectedId = null;
    let committed = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const deleteBtn = document.createElement("button");
    document.body.appendChild(deleteBtn);
    wireDeleteButton(deleteBtn, () => selectedId, exclCtrl);

    deleteBtn.click();
    expect(committed).toBeNull();
  });

  it("Delete key removes selected freeform exclusion from state", () => {
    let state = makeFloorState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });
    drawDivider(svg, drawCtrl, 1, 50, 99, 50);
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(1);

    wireDeleteKey(() => selectedId, exclCtrl);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));

    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
  });

  it("Backspace key also removes selected exclusion", () => {
    let state = makeFloorState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });
    drawDivider(svg, drawCtrl, 1, 50, 99, 50);
    wireDeleteKey(() => selectedId, exclCtrl);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));

    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
  });

  it("Delete key from INPUT element does not delete (text editing guard)", () => {
    let state = makeFloorState();
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    // Pre-set an exclusion directly so we have something to delete
    state.floors[0].rooms[0].exclusions.push({
      id: "ex1", type: "freeform",
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
    });
    selectedId = "ex1";

    wireDeleteKey(() => selectedId, exclCtrl);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));

    // Exclusion should NOT be deleted because event target is INPUT
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(1);
  });
});

// ── Journey 8: sub-surface toggle via real DOM events ─────────────────────────
//
// renderQuickSubSurface (exported from render.js) creates #qssEnabled and friends
// with real change/blur/input listeners that call commitSubSurface.
// We call it, fire real DOM events, verify commitSubSurface fires with correct state.

import { renderQuickSubSurface } from "./render.js";

describe("Journey 8: sub-surface DOM toggle triggers commitSubSurface", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="quickSubSurface"></button>
      <div id="subSurfaceDropdown"></div>
    `;
  });
  afterEach(() => { document.body.innerHTML = ""; });

  function makeStateWithExcl(exclOverrides = {}) {
    const excl = {
      id: "ex1",
      type: "freeform",
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
      tile: null,
      grout: null,
      pattern: null,
      ...exclOverrides,
    };
    return {
      ...makeFloorState({ exclusions: [excl] }),
      tilePresets: [
        { id: "p1", name: "20cm Grid", widthCm: 20, heightCm: 20, shape: "rect" },
      ],
    };
  }

  it("checking qssEnabled triggers commitSubSurface callback", () => {
    let state = makeStateWithExcl();
    let selectedId = "ex1";
    let commitCalled = false;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { commitCalled = true; state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    renderQuickSubSurface({
      state,
      selectedExclId: "ex1",
      getSelectedExcl: () => exclCtrl.getSelectedExcl(),
      commitSubSurface: (label) => exclCtrl.commitSubSurface(label),
    });

    const checkbox = document.getElementById("qssEnabled");
    expect(checkbox).not.toBeNull();

    // Check the box and fire change event (simulates user enabling sub-surface)
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(commitCalled).toBe(true);
  });

  it("unchecking qssEnabled clears tile/grout/pattern on the exclusion", () => {
    let state = makeStateWithExcl({
      tile: { widthCm: 20, heightCm: 20, shape: "rect" },
      grout: { widthCm: 0.2, colorHex: "#ffffff" },
      pattern: { type: "grid" },
    });
    let selectedId = "ex1";

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    renderQuickSubSurface({
      state,
      selectedExclId: "ex1",
      getSelectedExcl: () => exclCtrl.getSelectedExcl(),
      commitSubSurface: (label) => exclCtrl.commitSubSurface(label),
    });

    const checkbox = document.getElementById("qssEnabled");
    expect(checkbox).not.toBeNull();
    // Uncheck and fire change
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(state.floors[0].rooms[0].exclusions[0].tile).toBeNull();
    expect(state.floors[0].rooms[0].exclusions[0].grout).toBeNull();
    expect(state.floors[0].rooms[0].exclusions[0].pattern).toBeNull();
  });

  it("no exclusion selected: quickSubSurface button is disabled", () => {
    let state = makeFloorState(); // no exclusions

    renderQuickSubSurface({
      state,
      selectedExclId: null,
      getSelectedExcl: () => null,
      commitSubSurface: () => {},
    });

    expect(document.getElementById("quickSubSurface").disabled).toBe(true);
  });

  it("exclusion selected: quickSubSurface button is enabled", () => {
    let state = makeStateWithExcl();
    let selectedId = "ex1";

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: () => {},
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    renderQuickSubSurface({
      state,
      selectedExclId: "ex1",
      getSelectedExcl: () => exclCtrl.getSelectedExcl(),
      commitSubSurface: () => {},
    });

    expect(document.getElementById("quickSubSurface").disabled).toBe(false);
  });

  it("preset change event triggers commitSubSurface with new tile", () => {
    let state = makeStateWithExcl({
      tile: { widthCm: 20, heightCm: 20, shape: "rect", reference: "20cm Grid" },
      grout: { widthCm: 0.2, colorHex: "#ffffff" },
      pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
    });
    let selectedId = "ex1";
    let commits = 0;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { commits++; state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    renderQuickSubSurface({
      state,
      selectedExclId: "ex1",
      getSelectedExcl: () => exclCtrl.getSelectedExcl(),
      commitSubSurface: (label) => exclCtrl.commitSubSurface(label),
    });

    const presetSel = document.getElementById("qssPreset");
    expect(presetSel).not.toBeNull();
    presetSel.dispatchEvent(new Event("change", { bubbles: true }));

    expect(commits).toBe(1);
  });
});
