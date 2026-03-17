/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderPatternGroupsCanvas } from './render.js';
import { defaultStateWithRoom } from './core.js';

describe('renderPatternGroupsCanvas smoke', () => {
  it('returns gracefully when floor is null', () => {
    const state = defaultStateWithRoom();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(() => renderPatternGroupsCanvas({ state, floor: null, selectedRoomId: null, svgOverride: svg })).not.toThrow();
  });

  it('renders without throw for valid floor', () => {
    const state = defaultStateWithRoom();
    const floor = state.floors[0];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(() => renderPatternGroupsCanvas({ state, floor, selectedRoomId: null, svgOverride: svg })).not.toThrow();
    expect(svg.childNodes.length).toBeGreaterThan(0);
  });
});
