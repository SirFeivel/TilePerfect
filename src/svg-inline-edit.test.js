/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  startSvgEdit,
  startSvgTextEdit,
  cancelSvgEdit,
  commitSvgEdit,
} from './svg-inline-edit.js';

function makeSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);
  return svg;
}

afterEach(() => {
  document.body.innerHTML = '';
  // Ensure any lingering edit is cancelled
  cancelSvgEdit();
});

describe('svg-inline-edit', () => {
  it('cancelSvgEdit with no active edit does not throw', () => {
    expect(() => cancelSvgEdit()).not.toThrow();
  });

  it('startSvgEdit then cancelSvgEdit does not call onCommit', () => {
    const svg = makeSvg();
    const onCommit = vi.fn();
    startSvgEdit({ svg, x: 50, y: 50, value: 42, onCommit, textStyle: {} });
    cancelSvgEdit();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('startSvgEdit then commitSvgEdit calls onCommit with numeric value', () => {
    const svg = makeSvg();
    const onCommit = vi.fn();
    startSvgEdit({ svg, x: 50, y: 50, value: 42, onCommit, textStyle: {} });
    commitSvgEdit();
    expect(onCommit).toHaveBeenCalledWith(42);
  });

  it('startSvgTextEdit then cancelSvgEdit does not call onCommit', () => {
    const svg = makeSvg();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    startSvgTextEdit({ svg, x: 50, y: 50, value: 'Room A', onCommit, onCancel, textStyle: {} });
    cancelSvgEdit();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
