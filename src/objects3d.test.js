// src/objects3d.test.js
import { describe, it, expect, vi } from 'vitest';
import { prepareObj3dFaceRegion, createObjects3DController } from './objects3d.js';
import { getAllFloorExclusions, getObjFootprintEdges } from './geometry.js';

// ── prepareObj3dFaceRegion ────────────────────────────────────────────

describe('prepareObj3dFaceRegion', () => {
  it('computes side face dimensions for a rect object', () => {
    const obj = { id: 'o1', type: 'rect', w: 50, h: 80, heightCm: 200 };
    const surf = { face: 'front', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region).not.toBeNull();
    expect(region.widthCm).toBe(50);   // front face uses obj.w
    expect(region.heightCm).toBe(200);
    expect(region.exclusions).toHaveLength(0);
    expect(region.tile).toBe(surf.tile);
  });

  it('computes left/right face dimensions for a rect object', () => {
    const obj = { id: 'o1', type: 'rect', w: 50, h: 80, heightCm: 200 };
    const surf = { face: 'left', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region.widthCm).toBe(80);   // left face uses obj.h
    expect(region.heightCm).toBe(200);
  });

  it('computes top face dimensions for a rect object', () => {
    const obj = { id: 'o1', type: 'rect', w: 50, h: 80, heightCm: 200 };
    const surf = { face: 'top', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region.widthCm).toBe(50);   // top face: w
    expect(region.heightCm).toBe(80);  // top face: h
    expect(region.polygonVertices).toHaveLength(4);
  });

  it('injects contact exclusion for a matching face', () => {
    const obj = { id: 'o1', type: 'rect', w: 100, h: 60, heightCm: 200 };
    const surf = { face: 'front', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };
    const contacts = [
      { objId: 'o1', face: 'front', faceLocalX1: 10, faceLocalX2: 40, contactH: 50 },
    ];

    const region = prepareObj3dFaceRegion(obj, surf, contacts);

    expect(region.exclusions).toHaveLength(1);
    const excl = region.exclusions[0];
    expect(excl.type).toBe('rect');
    expect(excl.x).toBe(10);
    expect(excl.y).toBe(0);
    expect(excl.w).toBe(30);   // 40 - 10
    expect(excl.h).toBe(50);
    expect(excl._isContact).toBe(true);
  });

  it('does not inject contact exclusion for a different face', () => {
    const obj = { id: 'o1', type: 'rect', w: 100, h: 60, heightCm: 200 };
    const surf = { face: 'back', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };
    const contacts = [
      { objId: 'o1', face: 'front', faceLocalX1: 10, faceLocalX2: 40, contactH: 50 },
    ];

    const region = prepareObj3dFaceRegion(obj, surf, contacts);

    expect(region.exclusions).toHaveLength(0);
  });

  it('returns null for a freeform side face with no vertices', () => {
    const obj = { id: 'o1', type: 'freeform', vertices: [], heightCm: 200 };
    const surf = { face: 'side-0', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region).toBeNull();
  });

  it('computes tri top face as bounding box of triangle', () => {
    const obj = {
      id: 'o1', type: 'tri',
      p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 50, y: 80 },
      heightCm: 150,
    };
    const surf = { face: 'top', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region).not.toBeNull();
    expect(region.widthCm).toBeCloseTo(100, 0);
    expect(region.heightCm).toBeCloseTo(80, 0);
    // Polygon vertices should be origin-shifted triangle, not a rectangle
    expect(region.polygonVertices).toHaveLength(3);
  });
});

// ── Cylinder: getAllFloorExclusions ───────────────────────────────────

describe('cylinder getAllFloorExclusions', () => {
  it('cylinder is converted to a circle exclusion with _isObject3d', () => {
    const room = {
      exclusions: [],
      objects3d: [{ id: 'cyl1', type: 'cylinder', cx: 100, cy: 80, r: 30, skirtingEnabled: true }],
    };
    const excls = getAllFloorExclusions(room);
    expect(excls).toHaveLength(1);
    const e = excls[0];
    expect(e.type).toBe('circle');
    expect(e.id).toBe('cyl1');
    expect(e.cx).toBe(100);
    expect(e.cy).toBe(80);
    expect(e.r).toBe(30);
    expect(e._isObject3d).toBe(true);
    expect(e.skirtingEnabled).toBe(true);
  });

  it('cylinder exclusion has no tile field (not tilable)', () => {
    const room = {
      exclusions: [],
      objects3d: [{ id: 'cyl1', type: 'cylinder', cx: 50, cy: 50, r: 20, skirtingEnabled: true }],
    };
    const excls = getAllFloorExclusions(room);
    expect(excls[0].tile).toBeUndefined();
  });
});

// ── Cylinder: getObjFootprintEdges ────────────────────────────────────

describe('cylinder getObjFootprintEdges', () => {
  it('returns 16 edges approximating the circle', () => {
    const obj = { type: 'cylinder', cx: 0, cy: 0, r: 10 };
    const edges = getObjFootprintEdges(obj);
    expect(edges).toHaveLength(16);
    // Each edge connects adjacent N-gon vertices
    for (const e of edges) {
      const len = Math.hypot(e.p2.x - e.p1.x, e.p2.y - e.p1.y);
      expect(len).toBeGreaterThan(0);
    }
  });

  it('all edge vertices lie on the circle circumference', () => {
    const cx = 50, cy = 30, r = 20;
    const obj = { type: 'cylinder', cx, cy, r };
    const edges = getObjFootprintEdges(obj);
    for (const e of edges) {
      const d1 = Math.hypot(e.p1.x - cx, e.p1.y - cy);
      const d2 = Math.hypot(e.p2.x - cx, e.p2.y - cy);
      expect(d1).toBeCloseTo(r, 5);
      expect(d2).toBeCloseTo(r, 5);
    }
  });
});

// ── Cylinder: addCylinder controller ─────────────────────────────────

describe('addCylinder controller', () => {
  function makeState() {
    return {
      floors: [{
        id: 'f1',
        rooms: [{
          id: 'r1',
          widthCm: 200, heightCm: 150,
          polygonVertices: [
            { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }
          ],
          exclusions: [],
          objects3d: [],
        }],
      }],
      selectedFloorId: 'f1',
      selectedRoomId: 'r1',
    };
  }

  it('addCylinder adds a cylinder object with correct fields', () => {
    let state = makeState();
    let committed = null;
    const ctrl = createObjects3DController({
      getState: () => state,
      commit: (label, next) => { committed = next; state = next; },
      getSelectedId: () => null,
      setSelectedId: () => {},
    });

    ctrl.addCylinder();

    expect(committed).not.toBeNull();
    const room = committed.floors[0].rooms[0];
    expect(room.objects3d).toHaveLength(1);
    const obj = room.objects3d[0];
    expect(obj.type).toBe('cylinder');
    expect(typeof obj.cx).toBe('number');
    expect(typeof obj.cy).toBe('number');
    expect(obj.r).toBeGreaterThan(0);
    expect(obj.heightCm).toBe(100);
    expect(obj.skirtingEnabled).toBe(true);
    expect(obj.surfaces).toBeUndefined();
    console.log(`[test:addCylinder] cx=${obj.cx} cy=${obj.cy} r=${obj.r}`);
  });

  it('cylinder center is at room center', () => {
    let state = makeState();
    const ctrl = createObjects3DController({
      getState: () => state,
      commit: (label, next) => { state = next; },
      getSelectedId: () => null,
      setSelectedId: () => {},
    });

    ctrl.addCylinder();

    const obj = state.floors[0].rooms[0].objects3d[0];
    expect(obj.cx).toBeCloseTo(100, 0); // widthCm/2
    expect(obj.cy).toBeCloseTo(75, 0);  // heightCm/2
  });
});
