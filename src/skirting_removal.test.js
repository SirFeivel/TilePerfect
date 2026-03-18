import { describe, it, expect } from 'vitest';
import { computeSkirtingSegments } from './geometry.js';

describe('centered tile layout — piece boundaries', () => {
  function edgeSegments(segments, yVal) {
    return segments
      .filter(s => Math.abs(s.p1[1] - yVal) < 0.01 && Math.abs(s.p2[1] - yVal) < 0.01)
      .sort((a, b) => a.p1[0] - b.p1[0]);
  }

  it('no grout: 3 pieces on 100cm wall with 60cm tile (left cut = right cut = 20cm)', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 0, y: 10 }],
      tile: { widthCm: 60, heightCm: 60 },
      grout: { widthCm: 0 },
      exclusions: [],
      excludedSkirts: [],
    };
    const segs = edgeSegments(computeSkirtingSegments(room, true), 0);
    // anchor = 100/2 - 60/2 = 20, stepX = 60, centerOffset = 20
    // p0: [0, 20], p1: [20, 80], p2: [80, 100]
    expect(segs).toHaveLength(3);
    expect(segs[0].id).toMatch(/-p0$/);
    expect(segs[0].p1[0]).toBeCloseTo(0);
    expect(segs[0].p2[0]).toBeCloseTo(20);
    expect(segs[1].id).toMatch(/-p1$/);
    expect(segs[1].p1[0]).toBeCloseTo(20);
    expect(segs[1].p2[0]).toBeCloseTo(80);
    expect(segs[2].id).toMatch(/-p2$/);
    expect(segs[2].p1[0]).toBeCloseTo(80);
    expect(segs[2].p2[0]).toBeCloseTo(100);
  });

  it('with grout: step includes grout width — centerOffset differs from grout-free case', () => {
    // 300cm wall, 40cm tile, 0.2cm grout
    // anchor = 300/2 - 40/2 = 130
    // With grout: stepX = 40.2, centerOffset = 130 % 40.2 = 9.4
    // Without grout: stepX = 40, centerOffset = 130 % 40 = 10
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 10 }, { x: 0, y: 10 }],
      tile: { widthCm: 40, heightCm: 40 },
      grout: { widthCm: 0.2 },
      exclusions: [],
      excludedSkirts: [],
    };
    const segs = edgeSegments(computeSkirtingSegments(room, true), 0);
    const p0 = segs.find(s => s.id.endsWith('-p0'));
    expect(p0).toBeDefined();
    // Left cut ends at centerOffset = 9.4 (grout-aware), not 10
    expect(p0.p2[0]).toBeCloseTo(9.4, 1);
    // First full piece starts at 9.4
    const p1 = segs.find(s => s.id.endsWith('-p1'));
    expect(p1).toBeDefined();
    expect(p1.p1[0]).toBeCloseTo(9.4, 1);
  });

  it('symmetric: 60cm wall, 60cm tile, 0 grout — single full piece, no cuts', () => {
    // anchor = 60/2 - 60/2 = 0, centerOffset = 0, no left cut
    // Single piece p0: [0, 60]
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 10 }, { x: 0, y: 10 }],
      tile: { widthCm: 60, heightCm: 60 },
      grout: { widthCm: 0 },
      exclusions: [],
      excludedSkirts: [],
    };
    const segs = edgeSegments(computeSkirtingSegments(room, true), 0);
    expect(segs).toHaveLength(1);
    expect(segs[0].id).toMatch(/-p0$/);
    expect(segs[0].p1[0]).toBeCloseTo(0);
    expect(segs[0].p2[0]).toBeCloseTo(60);
  });

  it('piece IDs are contiguous starting from p0', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 10 }, { x: 0, y: 10 }],
      tile: { widthCm: 40, heightCm: 40 },
      grout: { widthCm: 0.2 },
      exclusions: [],
      excludedSkirts: [],
    };
    const segs = edgeSegments(computeSkirtingSegments(room, true), 0);
    const indices = segs.map(s => parseInt(s.id.match(/-p(\d+)$/)[1]));
    // IDs must be 0, 1, 2, ... without gaps
    expect(indices).toEqual([...Array(indices.length).keys()]);
  });
});

describe('Skirting Exclusions', () => {
  it('respects manual skirting exclusions in excludedSkirts', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      exclusions: [],
      excludedSkirts: []
    };
    
    const allSegments = computeSkirtingSegments(room);
    expect(allSegments.length).toBeGreaterThan(0);
    
    // Pick first segment ID to exclude
    const targetId = allSegments[0].id;
    room.excludedSkirts = [targetId];
    
    // Normal calculation should skip it
    const filteredSegments = computeSkirtingSegments(room);
    expect(filteredSegments.length).toBe(allSegments.length - 1);
    expect(filteredSegments.find(s => s.id === targetId)).toBeUndefined();

    // Removal mode (includeExcluded = true) should show it but marked as excluded
    const removalSegments = computeSkirtingSegments(room, true);
    expect(removalSegments.length).toBe(allSegments.length);
    const excludedSeg = removalSegments.find(s => s.id === targetId);
    expect(excludedSeg).toBeDefined();
    expect(excludedSeg.excluded).toBe(true);
  });

  it('normalizes skirting IDs regardless of direction', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      exclusions: [],
      excludedSkirts: []
    };
    
    const segments = computeSkirtingSegments(room);
    // Find a segment starting at (0,0) - likely the first piece of the top wall
    const seg = segments.find(s => s.p1[0] === 0 && s.p1[1] === 0);
    
    expect(seg).toBeDefined();
    // ID should be w0.00,0.00-100.00,0.00-p0 regardless of direction
    expect(seg.id).toBe('w0.00,0.00-100.00,0.00-p0');
  });
});
