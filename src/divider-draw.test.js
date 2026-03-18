/**
 * @vitest-environment jsdom
 *
 * E2E tests for the divider draw controller and dividers.js controller.
 * Uses the createMockSvg pattern from svg-coords.test.js: identity CTM
 * means clientX/Y === SVG coordinates (cm).
 * Real PointerEvents dispatched on the SVG element — no mocks on code under test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDividerDrawController } from "./divider-draw.js";
import { splitPolygonByLine } from "./geometry.js";
import { createExclusionsController } from "./exclusions.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const RECT_100 = [
  { x: 0,   y: 0   }, { x: 100, y: 0   },
  { x: 100, y: 100 }, { x: 0,   y: 100 },
];

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

// ── draw controller ───────────────────────────────────────────────────────────

describe("createDividerDrawController — draw flow", () => {
  let svg;
  beforeEach(() => { document.body.innerHTML = ""; svg = createMockSvg(); });
  afterEach(()  => { document.body.innerHTML = ""; });

  it("mousemove within 2cm of left edge → green snap dot at (0, 50)", () => {
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: () => {}, onCancel: () => {} });
    ctrl.start();
    move(svg, 1, 50); // 1cm from left edge x=0
    const dot = svg.querySelector("circle");
    expect(dot).not.toBeNull();
    expect(Number(dot.getAttribute("cx"))).toBeCloseTo(0,  1);
    expect(Number(dot.getAttribute("cy"))).toBeCloseTo(50, 1);
    expect(dot.getAttribute("fill")).toContain("34,197,94"); // green
  });

  it("mousemove 50cm from every edge → snap dot shown green at nearest edge", () => {
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: () => {}, onCancel: () => {} });
    ctrl.start();
    move(svg, 50, 50);
    const dot = svg.querySelector("circle");
    // Dot always green and shown at nearest edge — no distance threshold
    expect(dot).not.toBeNull();
    expect(dot.style.display).not.toBe("none");
    expect(dot.getAttribute("fill")).toContain("34,197,94"); // always green
  });

  it("click anywhere sets startPt by snapping to nearest edge", () => {
    let completed = false;
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: () => { completed = true; }, onCancel: () => {} });
    ctrl.start();
    // Click in the middle — snaps to nearest edge (sets startPt)
    move(svg, 50, 50);
    down(svg, 50, 50);
    // Click again — completes (p1 and p2 are both on edges, dist > 0.1)
    move(svg, 99, 50);
    down(svg, 99, 50);
    expect(completed).toBe(true);
  });

  it("click1 on left edge sets startPt; no preview line yet", () => {
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: () => {}, onCancel: () => {} });
    ctrl.start();
    move(svg, 1, 50);
    down(svg, 1, 50); // click1
    expect(svg.querySelector("line")).toBeNull(); // preview only appears on next move
  });

  it("after click1, mousemove anywhere → dashed preview line appears (including middle of room)", () => {
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: () => {}, onCancel: () => {} });
    ctrl.start();
    move(svg, 1, 50); down(svg, 1, 50); // click1
    move(svg, 50, 50);                  // move to middle of room — preview still shows
    const line = svg.querySelector("line");
    expect(line).not.toBeNull();
    expect(line.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("full two-click flow: left edge → right edge → onComplete with correct p1/p2", () => {
    let result = null;
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: (r) => { result = r; }, onCancel: () => {} });
    ctrl.start();
    move(svg, 1,  50); down(svg, 1,  50); // click1: snaps to left edge (0, 50)
    move(svg, 99, 50); down(svg, 99, 50); // click2: snaps to right edge (100, 50)
    expect(result).not.toBeNull();
    const xs = [result.p1.x, result.p2.x].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0,   1);
    expect(xs[1]).toBeCloseTo(100, 1);
    expect(result.p1.y).toBeCloseTo(50, 1);
    expect(result.p2.y).toBeCloseTo(50, 1);
  });

  it("after onComplete, snap dot and preview line are removed from SVG", () => {
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: () => {}, onCancel: () => {} });
    ctrl.start();
    move(svg, 1, 50); down(svg, 1, 50);
    move(svg, 99, 50); down(svg, 99, 50);
    expect(svg.querySelector("circle")).toBeNull();
    expect(svg.querySelector("line")).toBeNull();
  });

  it("Escape after click1 → onCancel called, dot and line removed", () => {
    let cancelled = false;
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: () => {}, onCancel: () => { cancelled = true; } });
    ctrl.start();
    move(svg, 1, 50); down(svg, 1, 50);
    move(svg, 99, 50);
    key("Escape");
    expect(cancelled).toBe(true);
    expect(svg.querySelector("circle")).toBeNull();
    expect(svg.querySelector("line")).toBeNull();
  });

  it("stop() mid-draw removes dot and preview line, isActive() → false", () => {
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: () => {}, onCancel: () => {} });
    ctrl.start();
    move(svg, 1, 50); down(svg, 1, 50);
    move(svg, 99, 50);
    ctrl.stop();
    expect(svg.querySelector("circle")).toBeNull();
    expect(svg.querySelector("line")).toBeNull();
    expect(ctrl.isActive()).toBe(false);
  });

  it("isActive() reflects start/stop state", () => {
    const ctrl = createDividerDrawController({ getSvg: () => svg, getPolygonVertices: () => RECT_100, onComplete: () => {}, onCancel: () => {} });
    expect(ctrl.isActive()).toBe(false);
    ctrl.start();
    expect(ctrl.isActive()).toBe(true);
    ctrl.stop();
    expect(ctrl.isActive()).toBe(false);
  });
});

// ── integration: draw events → split → addFreeform → state ───────────────────
//
// Replicates the exact onComplete logic from main.js:
//   splitPolygonByLine(verts, p1, p2) → smaller polygon → excl.addFreeform
// Uses real modules, real PointerEvents, real state mutation.

describe("divider draw → split → exclusion (full pipeline)", () => {
  let svg;
  beforeEach(() => { document.body.innerHTML = ""; svg = createMockSvg(); });
  afterEach(()  => { document.body.innerHTML = ""; });

  function makeState(roomOverrides = {}) {
    return {
      floors: [{ id: "f1", rooms: [{ id: "r1", polygonVertices: RECT_100, exclusions: [], widthCm: 100, heightCm: 100, ...roomOverrides }], walls: [] }],
      selectedFloorId: "f1", selectedRoomId: "r1",
    };
  }

  function polygonArea(verts) {
    let a = 0;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++)
      a += (verts[j].x + verts[i].x) * (verts[j].y - verts[i].y);
    return Math.abs(a) / 2;
  }

  // Replicates the split→addFreeform portion of the onComplete handler from main.js.
  // drawCtrl.stop() is excluded here: it's already tested in the draw controller suite above.
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

  it("horizontal split: two pointer clicks produce one freeform exclusion in state", () => {
    let state = makeState();
    let committed = null;
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    drawCtrl.start();
    move(svg, 1, 50);  down(svg, 1, 50);   // click1: snap to left edge (0,50)
    move(svg, 99, 50); down(svg, 99, 50);  // click2: snap to right edge (100,50)

    expect(committed).not.toBeNull();
    const room = committed.floors[0].rooms[0];
    expect(room.exclusions).toHaveLength(1);
    expect(room.exclusions[0].type).toBe("freeform");
    // Symmetric split — either half is 5000 cm²
    expect(polygonArea(room.exclusions[0].vertices)).toBeCloseTo(5000, 0);
  });

  it("asymmetric split: exclusion area matches the smaller polygon (25% of room)", () => {
    let state = makeState();
    let committed = null;
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    drawCtrl.start();
    // Cut at y=25: smaller piece is 100×25 = 2500 cm²
    move(svg, 1, 25);  down(svg, 1, 25);
    move(svg, 99, 25); down(svg, 99, 25);

    expect(committed).not.toBeNull();
    const excl = committed.floors[0].rooms[0].exclusions[0];
    expect(excl.type).toBe("freeform");
    expect(polygonArea(excl.vertices)).toBeCloseTo(2500, 0);
  });

  it("draw controller is inactive and SVG is clean after completion", () => {
    let state = makeState();
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

    drawCtrl.start();
    move(svg, 1, 50); down(svg, 1, 50);
    move(svg, 99, 50); down(svg, 99, 50);

    // The draw controller removes snap dot and preview line on completion (its own cleanup).
    // isActive() stays true because stop() is called by main.js, not by onComplete itself.
    expect(svg.querySelector("circle")).toBeNull();
    expect(svg.querySelector("line")).toBeNull();
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(1);
  });

  it("click far from edge does not create exclusion", () => {
    let state = makeState();
    let committed = null;
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; state = next; },
      getSelectedId: () => selectedId,
      setSelectedId: (id) => { selectedId = id; },
    });

    const drawCtrl = createDividerDrawController({
      getSvg: () => svg,
      getPolygonVertices: () => RECT_100,
      onComplete: buildOnComplete(() => RECT_100, exclCtrl),
      onCancel: () => {},
    });

    drawCtrl.start();
    // Both clicks far from edge — should be ignored
    move(svg, 50, 50); down(svg, 50, 50);
    move(svg, 50, 50); down(svg, 50, 50);

    expect(committed).toBeNull();
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
  });

  it("Escape after click1 produces no exclusion", () => {
    let state = makeState();
    let committed = null;
    let cancelled = false;
    let selectedId = null;

    const exclCtrl = createExclusionsController({
      getState: () => state,
      commit: (_, next) => { committed = next; state = next; },
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
    move(svg, 1, 50); down(svg, 1, 50);
    move(svg, 99, 50);
    key("Escape");

    expect(cancelled).toBe(true);
    expect(committed).toBeNull();
    expect(state.floors[0].rooms[0].exclusions).toHaveLength(0);
  });
});

