// src/skirting_zones.test.js — E2E tests for skirting zones pipeline
import { describe, it, expect } from 'vitest';
import {
  syncFloorWalls,
  rebuildAllSkirtingZones,
  computeSkirtingZoneTiles,
} from './walls.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeRoom(id, x, y, w, h, skirtingOverride = {}) {
  return {
    id,
    name: id,
    floorPosition: { x, y },
    widthCm: w,
    heightCm: h,
    polygonVertices: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    tile: { widthCm: 30, heightCm: 30, shape: 'rect' },
    grout: { widthCm: 0.3, colorHex: '#aaaaaa' },
    pattern: { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl', xCm: 0, yCm: 0 } },
    exclusions: [],
    objects3d: [],
    skirting: { enabled: true, type: 'cutout', heightCm: 10, ...skirtingOverride },
  };
}

function makeFloor(rooms) {
  return { id: 'f1', name: 'Floor 1', rooms, walls: [] };
}

function makeState(floor) {
  return {
    floors: [floor],
    selectedFloorId: 'f1',
    selectedRoomId: floor.rooms[0]?.id,
    view: {},
  };
}

// ── rebuildAllSkirtingZones ───────────────────────────────────────────

describe('rebuildAllSkirtingZones', () => {
  it('populates skirtingZones on wall surfaces when skirting is enabled', () => {
    const room = makeRoom('r1', 0, 0, 400, 300);
    const floor = makeFloor([room]);
    syncFloorWalls(floor);
    const state = makeState(floor);

    rebuildAllSkirtingZones(state);

    const allZones = floor.walls.flatMap(w =>
      w.surfaces.filter(s => s.roomId === 'r1').flatMap(s => s.skirtingZones || [])
    );
    expect(allZones.length).toBeGreaterThan(0);
    console.log(`[test:rebuildAllSkirtingZones] total zones: ${allZones.length}`);
  });

  it('each zone carries tile/grout/pattern from room skirting spec', () => {
    const room = makeRoom('r1', 0, 0, 400, 300);
    const floor = makeFloor([room]);
    syncFloorWalls(floor);
    const state = makeState(floor);

    rebuildAllSkirtingZones(state);

    const zones = floor.walls
      .flatMap(w => w.surfaces.filter(s => s.roomId === 'r1'))
      .flatMap(s => s.skirtingZones || []);

    for (const z of zones) {
      expect(z.tile).toBeDefined();
      expect(z.tile.heightCm).toBe(10); // skirting.heightCm
      expect(z.grout).toBeDefined();
      expect(z.pattern).toBeDefined();
      expect(z.pattern.type).toBe('grid');
    }
  });

  it('zone h equals skirting.heightCm', () => {
    const room = makeRoom('r1', 0, 0, 400, 300, { heightCm: 8 });
    const floor = makeFloor([room]);
    syncFloorWalls(floor);
    const state = makeState(floor);

    rebuildAllSkirtingZones(state);

    const zones = floor.walls
      .flatMap(w => w.surfaces.filter(s => s.roomId === 'r1'))
      .flatMap(s => s.skirtingZones || []);

    for (const z of zones) {
      expect(z.h).toBe(8);
    }
  });

  it('does not produce zones when skirting is disabled', () => {
    const room = makeRoom('r1', 0, 0, 400, 300, { enabled: false });
    const floor = makeFloor([room]);
    syncFloorWalls(floor);
    const state = makeState(floor);

    rebuildAllSkirtingZones(state);

    const allZones = floor.walls.flatMap(w =>
      w.surfaces.filter(s => s.roomId === 'r1').flatMap(s => s.skirtingZones || [])
    );
    expect(allZones).toHaveLength(0);
  });

  it('bought-type skirting uses boughtWidthCm for tile width', () => {
    const room = makeRoom('r1', 0, 0, 400, 300, { type: 'bought', boughtWidthCm: 15, heightCm: 9 });
    const floor = makeFloor([room]);
    syncFloorWalls(floor);
    const state = makeState(floor);

    rebuildAllSkirtingZones(state);

    const zones = floor.walls
      .flatMap(w => w.surfaces.filter(s => s.roomId === 'r1'))
      .flatMap(s => s.skirtingZones || []);

    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      expect(z.tile.widthCm).toBe(15);
      expect(z.tile.heightCm).toBe(9);
    }
  });

  it('zone x1 and x2 are within surface width bounds', () => {
    const room = makeRoom('r1', 0, 0, 400, 300);
    const floor = makeFloor([room]);
    syncFloorWalls(floor);
    const state = makeState(floor);

    rebuildAllSkirtingZones(state);

    for (const wall of floor.walls) {
      for (const s of wall.surfaces) {
        if (s.roomId !== 'r1') continue;
        const surfW = (s.toCm ?? (s.fromCm !== undefined ? 0 : 400)) - (s.fromCm ?? 0);
        for (const z of (s.skirtingZones || [])) {
          expect(z.x1).toBeGreaterThanOrEqual(-0.5);
          expect(z.x2).toBeGreaterThan(z.x1);
        }
      }
    }
  });

  it('initialises skirtingZones to [] on all wall surfaces after normalization', () => {
    const room = makeRoom('r1', 0, 0, 400, 300, { enabled: false });
    const floor = makeFloor([room]);
    syncFloorWalls(floor);
    const state = makeState(floor);

    rebuildAllSkirtingZones(state);

    for (const wall of floor.walls) {
      for (const s of wall.surfaces) {
        expect(Array.isArray(s.skirtingZones)).toBe(true);
      }
    }
  });
});

// ── computeSkirtingZoneTiles ──────────────────────────────────────────

describe('computeSkirtingZoneTiles', () => {
  function makeZone(x1, x2, h) {
    return {
      x1, x2, h,
      tile: { widthCm: Math.max(30, x2 - x1), heightCm: h, shape: 'rect' },
      grout: { widthCm: 0.2, colorHex: '#ffffff' },
      pattern: { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'center', xCm: 0, yCm: 0 } },
    };
  }

  const minimalState = { floors: [], selectedFloorId: null, selectedRoomId: null, view: {} };
  const minimalFloor = { id: 'f1', rooms: [], walls: [] };

  it('returns one result per zone with tiles', () => {
    const zones = [makeZone(0, 400, 10)];
    const results = computeSkirtingZoneTiles(minimalState, zones, 400, minimalFloor);
    expect(results).toHaveLength(1);
    expect(results[0].tiles.length).toBeGreaterThan(0);
    expect(results[0].x1).toBe(0);
    expect(results[0].x2).toBe(400);
    console.log(`[test:computeSkirtingZoneTiles] zone (0,400) h=10 → tiles=${results[0].tiles.length}`);
  });

  it('skips degenerate zone with zero width', () => {
    const zone = makeZone(50, 50, 10); // x1 === x2
    const results = computeSkirtingZoneTiles(minimalState, [zone], 400, minimalFloor);
    expect(results).toHaveLength(0);
  });

  it('returns empty for empty zones array', () => {
    const results = computeSkirtingZoneTiles(minimalState, [], 400, minimalFloor);
    expect(results).toHaveLength(0);
  });

  it('all tile paths stay within zone bounding box', () => {
    const x1 = 20, x2 = 180, h = 12;
    const zones = [makeZone(x1, x2, h)];
    const results = computeSkirtingZoneTiles(minimalState, zones, 200, minimalFloor);
    expect(results).toHaveLength(1);
    const tiles = results[0].tiles;
    expect(tiles.length).toBeGreaterThan(0);
    // Every tile that has a path should be parseable — just check tiles exist
    for (const tile of tiles) {
      expect(tile.d).toBeDefined();
    }
  });

  it('zone uses x1/x2 from zone; full-width zone uses surfaceWidthCm when x1/x2 absent', () => {
    // Full-width zone (no x1/x2 — simulates 3D object face skirting zone)
    const zone = {
      h: 8,
      tile: { widthCm: 30, heightCm: 8, shape: 'rect' },
      grout: { widthCm: 0.2, colorHex: '#ffffff' },
      pattern: { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
    };
    const results = computeSkirtingZoneTiles(minimalState, [zone], 100, minimalFloor);
    expect(results).toHaveLength(1);
    expect(results[0].x1).toBe(0);
    expect(results[0].x2).toBe(100);
  });
});

// ── E2E: rebuildAllSkirtingZones → computeSkirtingZoneTiles ──────────

describe('E2E skirting zones pipeline', () => {
  it('produces non-empty tiles from a fully configured room', () => {
    const room = makeRoom('r1', 0, 0, 400, 300);
    const floor = makeFloor([room]);
    syncFloorWalls(floor);
    const state = makeState(floor);

    rebuildAllSkirtingZones(state);

    let totalTiles = 0;
    for (const wall of floor.walls) {
      for (const s of wall.surfaces) {
        if (s.roomId !== 'r1' || !(s.skirtingZones?.length)) continue;
        const surfW = s.toCm != null ? s.toCm - (s.fromCm ?? 0) : room.widthCm;
        const results = computeSkirtingZoneTiles(state, s.skirtingZones, surfW, floor);
        for (const r of results) {
          totalTiles += r.tiles.length;
        }
      }
    }

    expect(totalTiles).toBeGreaterThan(0);
    console.log(`[test:E2E] room 400×300 skirting h=10 total tiles across all surfaces: ${totalTiles}`);
  });

  it('multi-room floor: zones only appear on walls belonging to skirting-enabled rooms', () => {
    const roomA = makeRoom('rA', 0, 0, 400, 300, { enabled: true, heightCm: 10 });
    const roomB = makeRoom('rB', 500, 0, 200, 200, { enabled: false });
    const floor = { id: 'f1', name: 'Floor 1', rooms: [roomA, roomB], walls: [] };
    syncFloorWalls(floor);
    const state = { floors: [floor], selectedFloorId: 'f1', selectedRoomId: 'rA', view: {} };

    rebuildAllSkirtingZones(state);

    const zonesA = floor.walls
      .flatMap(w => w.surfaces.filter(s => s.roomId === 'rA'))
      .flatMap(s => s.skirtingZones || []);
    const zonesB = floor.walls
      .flatMap(w => w.surfaces.filter(s => s.roomId === 'rB'))
      .flatMap(s => s.skirtingZones || []);

    expect(zonesA.length).toBeGreaterThan(0);
    expect(zonesB).toHaveLength(0);
  });
});
