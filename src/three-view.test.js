// src/three-view.test.js
import { describe, it, expect } from "vitest";
import { parseTilePathD, parseHexColor, createWallMapper, createFloorMapper, createBoxFaceMapper, createOffsetMapper, createGroutQuad, exclusionToShape } from "./three-view.js";

describe("parseTilePathD", () => {
  it("parses a simple M/L/Z path into one ring", () => {
    const rings = parseTilePathD("M 0 0 L 10 0 L 10 10 L 0 10 Z");
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it("parses multi-ring paths", () => {
    const rings = parseTilePathD("M 0 0 L 5 0 L 5 5 Z M 10 10 L 20 10 L 20 20 Z");
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveLength(3);
    expect(rings[1]).toHaveLength(3);
  });

  it("parses implicit L continuations (bare coordinate pairs)", () => {
    const rings = parseTilePathD("M 0 0 L 10 0 20 0 30 0 Z");
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTilePathD("")).toEqual([]);
  });

  it("handles NaN coordinates gracefully", () => {
    const rings = parseTilePathD("M abc def L 10 0 Z");
    expect(rings).toHaveLength(1);
    // NaN coordinates from "abc def" are skipped; only valid "L 10 0" is kept
    expect(rings[0]).toHaveLength(1);
    expect(rings[0][0]).toEqual({ x: 10, y: 0 });
  });

  it("parses decimal coordinates", () => {
    const rings = parseTilePathD("M 1.5 2.7 L 3.14 4.0 Z");
    expect(rings[0][0]).toEqual({ x: 1.5, y: 2.7 });
    expect(rings[0][1]).toEqual({ x: 3.14, y: 4.0 });
  });
});

describe("parseHexColor", () => {
  it("returns white for null input", () => {
    const c = parseHexColor(null);
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(1);
    expect(c.b).toBeCloseTo(1);
  });

  it("returns white for non-string input", () => {
    const c = parseHexColor(42);
    expect(c.r).toBeCloseTo(1);
  });

  it("parses valid #rrggbb hex string", () => {
    const c = parseHexColor("#ff0000");
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(0);
    expect(c.b).toBeCloseTo(0);
  });

  it("parses black", () => {
    const c = parseHexColor("#000000");
    expect(c.r).toBeCloseTo(0);
    expect(c.g).toBeCloseTo(0);
    expect(c.b).toBeCloseTo(0);
  });
});

describe("createWallMapper", () => {
  it("returns null for null surfaceVerts", () => {
    expect(createWallMapper(null, 0, 0, 10, 0, 200, 200)).toBeNull();
  });

  it("returns null for fewer than 4 surfaceVerts", () => {
    const verts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(createWallMapper(verts, 0, 0, 10, 0, 200, 200)).toBeNull();
  });

  it("returns null for degenerate (zero-area) surface", () => {
    // All points on a line → det ≈ 0
    const verts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(createWallMapper(verts, 0, 0, 10, 0, 200, 200)).toBeNull();
  });

  it("maps corners of a unit square surface correctly", () => {
    // Surface verts: A@ground, B@ground, B@height, A@height
    // Unit square: (0,0)→(100,0)→(100,200)→(0,200)
    const verts = [
      { x: 0, y: 0 },     // A@ground
      { x: 100, y: 0 },   // B@ground
      { x: 100, y: 200 }, // B@height
      { x: 0, y: 200 },   // A@height
    ];
    // Wall goes from (0,0,0) to (100,0,0) in 3D, height 200
    const mapper = createWallMapper(verts, 0, 0, 100, 0, 200, 200);
    expect(mapper).not.toBeNull();

    // Bottom-left corner (0,0) → 3D (0, 0, 0)
    const bl = mapper(0, 0);
    expect(bl.x).toBeCloseTo(0);
    expect(bl.y).toBeCloseTo(0);
    expect(bl.z).toBeCloseTo(0);

    // Bottom-right corner (100,0) → 3D (100, 0, 0)
    const br = mapper(100, 0);
    expect(br.x).toBeCloseTo(100);
    expect(br.y).toBeCloseTo(0);
    expect(br.z).toBeCloseTo(0);

    // Top-left corner (0,200) → 3D (0, 200, 0)
    const tl = mapper(0, 200);
    expect(tl.x).toBeCloseTo(0);
    expect(tl.y).toBeCloseTo(200);
    expect(tl.z).toBeCloseTo(0);

    // Top-right corner (100,200) → 3D (100, 200, 0)
    const tr = mapper(100, 200);
    expect(tr.x).toBeCloseTo(100);
    expect(tr.y).toBeCloseTo(200);
    expect(tr.z).toBeCloseTo(0);
  });
});

describe("createFloorMapper", () => {
  it("maps 2D coords to XZ plane with offset", () => {
    const mapper = createFloorMapper({ x: 10, y: 20 });
    const p = mapper(5, 7);
    expect(p.x).toBe(15);
    expect(p.y).toBe(0);
    expect(p.z).toBe(27);
  });

  it("maps origin with zero offset", () => {
    const mapper = createFloorMapper({ x: 0, y: 0 });
    const p = mapper(0, 0);
    expect(p).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("exclusionToShape", () => {
  it("returns a Shape for rect exclusion", () => {
    const shape = exclusionToShape({ type: "rect", x: 10, y: 20, w: 50, h: 30 });
    expect(shape).not.toBeNull();
    const points = shape.getPoints();
    expect(points.length).toBeGreaterThanOrEqual(4);
  });

  it("returns a Shape for circle exclusion with rx/ry", () => {
    const shape = exclusionToShape({ type: "circle", cx: 50, cy: 50, rx: 30, ry: 20 });
    expect(shape).not.toBeNull();
    const points = shape.getPoints();
    expect(points.length).toBeGreaterThanOrEqual(10);
  });

  it("returns a Shape for circle exclusion falling back to r", () => {
    const shape = exclusionToShape({ type: "circle", cx: 50, cy: 50, r: 25 });
    expect(shape).not.toBeNull();
  });

  it("returns a Shape for tri exclusion", () => {
    const shape = exclusionToShape({
      type: "tri",
      p1: { x: 0, y: 0 },
      p2: { x: 100, y: 0 },
      p3: { x: 50, y: 80 },
    });
    expect(shape).not.toBeNull();
    const points = shape.getPoints();
    expect(points.length).toBeGreaterThanOrEqual(3);
  });

  it("returns a Shape for freeform exclusion with >= 3 vertices", () => {
    const shape = exclusionToShape({
      type: "freeform",
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    });
    expect(shape).not.toBeNull();
  });

  it("returns null for freeform exclusion with < 3 vertices", () => {
    const shape = exclusionToShape({
      type: "freeform",
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    });
    expect(shape).toBeNull();
  });

  it("returns null for unknown type", () => {
    const shape = exclusionToShape({ type: "unknown" });
    expect(shape).toBeNull();
  });
});

describe("createOffsetMapper", () => {
  it("offsets output along (nx, nz) by the given amount", () => {
    const base = (x, y) => ({ x, y: y, z: 0 });
    const offset = createOffsetMapper(base, 1, 0, 5);
    const p = offset(10, 20);
    expect(p.x).toBeCloseTo(15);  // 10 + 1*5
    expect(p.y).toBeCloseTo(20);  // unchanged
    expect(p.z).toBeCloseTo(0);   // 0 + 0*5
  });

  it("offsets in both x and z when normal is diagonal", () => {
    const base = (x, y) => ({ x, y, z: 0 });
    const nx = Math.SQRT1_2, nz = Math.SQRT1_2;
    const offset = createOffsetMapper(base, nx, nz, 10);
    const p = offset(0, 0);
    expect(p.x).toBeCloseTo(10 * Math.SQRT1_2);
    expect(p.z).toBeCloseTo(10 * Math.SQRT1_2);
  });

  it("zero offset returns same point as base mapper", () => {
    const base = (x, y) => ({ x: x + 100, y: y + 50, z: x - y });
    const offset = createOffsetMapper(base, 1, 1, 0);
    const p = offset(7, 3);
    expect(p).toEqual(base(7, 3));
  });

  it("preserves y from the base mapper (only offsets xz)", () => {
    const base = (x, y) => ({ x: 0, y: 999, z: 0 });
    const offset = createOffsetMapper(base, 0, 1, 50);
    const p = offset(0, 0);
    expect(p.y).toBe(999);
    expect(p.z).toBeCloseTo(50);
  });
});

describe("createBoxFaceMapper", () => {
  const rectObj = { type: "rect", x: 10, y: 20, w: 100, h: 80, heightCm: 200 };
  const roomPos = { x: 0, y: 0 };

  it("maps front face: sx along width, sy up", () => {
    const m = createBoxFaceMapper(rectObj, roomPos, "front");
    expect(m).not.toBeNull();
    // Front face at z = roomPos.y + obj.y = 20
    const bl = m(0, 0);    // bottom-left of front
    expect(bl.x).toBeCloseTo(10);  // ox = roomPos.x + obj.x
    expect(bl.y).toBeCloseTo(0);
    expect(bl.z).toBeCloseTo(20);  // oz = roomPos.y + obj.y
    const br = m(100, 0);  // bottom-right of front
    expect(br.x).toBeCloseTo(110);
    expect(br.z).toBeCloseTo(20);
    const tl = m(0, 200);  // top-left
    expect(tl.y).toBeCloseTo(200);
  });

  it("maps back face: sx reversed along width", () => {
    const m = createBoxFaceMapper(rectObj, roomPos, "back");
    expect(m).not.toBeNull();
    const bl = m(0, 0);
    expect(bl.x).toBeCloseTo(110); // ox + w - 0
    expect(bl.z).toBeCloseTo(100); // oz + d = 20 + 80
  });

  it("maps top face at object height", () => {
    const m = createBoxFaceMapper(rectObj, roomPos, "top");
    expect(m).not.toBeNull();
    const p = m(50, 40);
    expect(p.x).toBeCloseTo(60);   // ox + sx
    expect(p.y).toBeCloseTo(200);  // heightCm
    expect(p.z).toBeCloseTo(60);   // oz + sy
  });

  it("returns null for unknown face name", () => {
    expect(createBoxFaceMapper(rectObj, roomPos, "bogus")).toBeNull();
  });

  describe("tri object side faces", () => {
    const triObj = {
      type: "tri",
      p1: { x: 0, y: 0 },
      p2: { x: 100, y: 0 },
      p3: { x: 50, y: 80 },
      heightCm: 150,
    };

    it("maps side-0 along edge p1→p2", () => {
      const m = createBoxFaceMapper(triObj, roomPos, "side-0");
      expect(m).not.toBeNull();
      // Edge from p1(0,0) to p2(100,0), length=100, horizontal
      const start = m(0, 0);
      expect(start.x).toBeCloseTo(0);   // p1.x
      expect(start.y).toBeCloseTo(0);
      expect(start.z).toBeCloseTo(0);   // p1.y
      const end = m(100, 0);
      expect(end.x).toBeCloseTo(100);   // p2.x
      expect(end.z).toBeCloseTo(0);
      const top = m(0, 150);
      expect(top.y).toBeCloseTo(150);   // sy = height
    });

    it("maps side-1 along edge p2→p3", () => {
      const m = createBoxFaceMapper(triObj, roomPos, "side-1");
      expect(m).not.toBeNull();
      const start = m(0, 0);
      expect(start.x).toBeCloseTo(100); // p2.x
      expect(start.z).toBeCloseTo(0);   // p2.y
      const edgeLen = Math.sqrt(50 * 50 + 80 * 80);
      const end = m(edgeLen, 0);
      expect(end.x).toBeCloseTo(50);    // p3.x
      expect(end.z).toBeCloseTo(80);    // p3.y
    });

    it("returns null for out-of-range side index", () => {
      // tri has 3 vertices, so side-3 is valid (wraps to p3→p0) but side-4 should fail
      // Actually side-3 has index 3, verts[3] is undefined for a triangle
      expect(createBoxFaceMapper(triObj, roomPos, "side-5")).toBeNull();
    });
  });

  describe("freeform object", () => {
    const freeObj = {
      type: "freeform",
      vertices: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 100, y: 150 },
        { x: 0, y: 100 },
      ],
      heightCm: 120,
    };

    it("maps top face using bounding box origin", () => {
      const m = createBoxFaceMapper(freeObj, roomPos, "top");
      expect(m).not.toBeNull();
      const p = m(0, 0);
      expect(p.x).toBeCloseTo(0);    // minX of vertices
      expect(p.y).toBeCloseTo(120);  // heightCm
      expect(p.z).toBeCloseTo(0);    // minY of vertices
    });

    it("maps side-2 along edge v2→v3", () => {
      const m = createBoxFaceMapper(freeObj, roomPos, "side-2");
      expect(m).not.toBeNull();
      const start = m(0, 0);
      expect(start.x).toBeCloseTo(200); // v2.x
      expect(start.z).toBeCloseTo(100); // v2.y
    });
  });
});

describe("createGroutQuad", () => {
  it("returns a Mesh with correct geometry for a simple wall face", () => {
    // 4 corners of a 100cm wide × 250cm tall surface
    const surfVerts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 250 },
      { x: 0, y: 250 },
    ];
    // Wall along X axis at z=50
    const mapper = (sx, sy) => ({ x: sx, y: sy, z: 50 });
    // Normal pointing outward (toward -z)
    const nx = 0, nz = -1;
    const mesh = createGroutQuad(surfVerts, mapper, nx, nz, "#cccccc");

    expect(mesh).not.toBeNull();
    expect(mesh.geometry).toBeDefined();
    expect(mesh.material).toBeDefined();

    // Should have 4 vertices (12 floats)
    const pos = mesh.geometry.attributes.position.array;
    expect(pos.length).toBe(12);

    // Vertices should be offset from z=50 by SURFACE_GROUT_OFFSET (0.3) in -z direction
    // So z should be 50 + (-1 * 0.3) = 49.7
    for (let i = 2; i < pos.length; i += 3) {
      expect(pos[i]).toBeCloseTo(49.7, 1);
    }

    // Material should be the parsed grout color (#cccccc)
    // THREE.Color stores in linear color space, so compare via getHexString
    expect(mesh.material.color.getHexString()).toBe("cccccc");
  });

  it("returns null for fewer than 4 surface vertices", () => {
    const surfVerts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const mapper = (sx, sy) => ({ x: sx, y: sy, z: 0 });
    expect(createGroutQuad(surfVerts, mapper, 0, 1, "#fff")).toBeNull();
  });

  it("returns null for null surface vertices", () => {
    const mapper = (sx, sy) => ({ x: sx, y: sy, z: 0 });
    expect(createGroutQuad(null, mapper, 0, 1, "#fff")).toBeNull();
  });

  it("grout quad offset is in the normal direction, not arbitrary", () => {
    const surfVerts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];
    // Diagonal normal: (0.6, 0, 0.8) normalized
    const mapper = (sx, sy) => ({ x: sx + 200, y: sy, z: 300 });
    const nx = 0.6, nz = 0.8;
    const mesh = createGroutQuad(surfVerts, mapper, nx, nz, "#ffffff");
    expect(mesh).not.toBeNull();

    const pos = mesh.geometry.attributes.position.array;
    // First vertex: mapper(0,0) = (200, 0, 300), offset by (0.6*0.3, 0, 0.8*0.3) = (0.18, 0, 0.24)
    expect(pos[0]).toBeCloseTo(200.18, 1);  // x
    expect(pos[1]).toBeCloseTo(0, 1);       // y unchanged
    expect(pos[2]).toBeCloseTo(300.24, 1);  // z
  });
});
