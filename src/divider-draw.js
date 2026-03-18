// src/divider-draw.js — Draw controller for surface divider lines
import { pointerToSvgXY } from './svg-coords.js';
import { findNearestEdgePoint } from './polygon-draw.js';

export function createDividerDrawController({ getSvg, getPolygonVertices, onComplete, onCancel }) {
  // getPolygonVertices() → [{x,y}] vertices of current surface polygon
  let active = false;
  let startPt = null;
  let shiftHeld = false;
  let snapDot = null;    // SVG circle: green dot on nearest edge
  let previewLine = null; // SVG dashed line from startPt to current position

  function getEdges() {
    const verts = getPolygonVertices();
    if (!verts?.length) return [];
    return verts.map((v, i) => ({
      roomId: 'surface',
      edge: { p1: v, p2: verts[(i + 1) % verts.length] },
    }));
  }

  // Always returns nearest edge point (no threshold gate).
  function getNearestEdge(rawPt) {
    return findNearestEdgePoint(rawPt, getEdges());
  }

  // Find first intersection of a ray from origin at angleRad with the polygon boundary.
  function rayPolyIntersect(origin, angleRad, verts) {
    if (!verts?.length) return null;
    const cx = Math.cos(angleRad), cy = Math.sin(angleRad);
    let bestT = Infinity, best = null;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const denom = cx * ey - cy * ex;
      if (Math.abs(denom) < 1e-10) continue;
      const tx = a.x - origin.x, ty = a.y - origin.y;
      const t = (tx * ey - ty * ex) / denom;
      const s = (tx * cy - ty * cx) / denom;
      if (t > 0.01 && s >= -0.001 && s <= 1.001 && t < bestT) {
        bestT = t;
        best = { x: origin.x + t * cx, y: origin.y + t * cy };
      }
    }
    return best;
  }

  // Constrain direction from `from` toward `rawPt` to nearest 15° increment.
  // Returns the constrained angle in radians, or null if distance is negligible.
  function constrainedAngle(from, rawPt) {
    const dx = rawPt.x - from.x, dy = rawPt.y - from.y;
    if (Math.hypot(dx, dy) < 0.01) return null;
    const angle = Math.atan2(dy, dx);
    return Math.round(angle / (Math.PI / 12)) * (Math.PI / 12); // 15° increments
  }

  function ensureSnapDot() {
    if (snapDot) return snapDot;
    snapDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    snapDot.setAttribute('r', '3');
    snapDot.setAttribute('fill', 'rgb(34,197,94)');
    snapDot.setAttribute('stroke', 'white');
    snapDot.setAttribute('stroke-width', '1');
    snapDot.setAttribute('pointer-events', 'none');
    getSvg().appendChild(snapDot);
    return snapDot;
  }

  function ensurePreviewLine() {
    if (previewLine) return previewLine;
    previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    previewLine.setAttribute('stroke', 'rgba(99,102,241,0.8)');
    previewLine.setAttribute('stroke-width', '1.5');
    previewLine.setAttribute('stroke-dasharray', '4 3');
    previewLine.setAttribute('pointer-events', 'none');
    getSvg().appendChild(previewLine);
    return previewLine;
  }

  // Re-append overlay elements after a render clears the SVG.
  function reattach() {
    if (!active) return;
    const svg = getSvg();
    if (snapDot) svg.appendChild(snapDot);
    if (previewLine) svg.appendChild(previewLine);
  }

  function computeDotAndPreview(rawPt) {
    const verts = getPolygonVertices();
    if (startPt && shiftHeld) {
      const ang = constrainedAngle(startPt, rawPt);
      if (ang !== null) {
        const intersection = rayPolyIntersect(startPt, ang, verts);
        const dotPt = intersection || getNearestEdge(rawPt)?.point;
        const previewEnd = intersection || rawPt;
        console.log(`[divider-draw:move-shift] ang=${(ang * 180 / Math.PI).toFixed(0)}° dot=(${dotPt?.x?.toFixed(1)},${dotPt?.y?.toFixed(1)})`);
        return { dotPt, previewEnd };
      }
    }
    // Free mode: snap dot at nearest edge point (always valid, always green)
    const nr = getNearestEdge(rawPt);
    return { dotPt: nr?.point, previewEnd: nr?.point };
  }

  function onPointerMove(e) {
    const rawPt = pointerToSvgXY(getSvg(), e.clientX, e.clientY);
    const { dotPt, previewEnd } = computeDotAndPreview(rawPt);

    if (dotPt) {
      const dot = ensureSnapDot();
      dot.setAttribute('cx', dotPt.x);
      dot.setAttribute('cy', dotPt.y);
      dot.style.display = '';
    } else if (snapDot) {
      snapDot.style.display = 'none';
    }

    if (startPt && previewEnd) {
      const line = ensurePreviewLine();
      line.setAttribute('x1', startPt.x); line.setAttribute('y1', startPt.y);
      line.setAttribute('x2', previewEnd.x); line.setAttribute('y2', previewEnd.y);
      line.style.display = '';
    } else if (previewLine) {
      previewLine.style.display = 'none';
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const rawPt = pointerToSvgXY(getSvg(), e.clientX, e.clientY);
    const { dotPt } = computeDotAndPreview(rawPt);
    const snapped = dotPt;
    if (!snapped) return;

    if (!startPt) {
      startPt = snapped;
      console.log(`[divider-draw:click1] startPt=(${snapped.x.toFixed(1)},${snapped.y.toFixed(1)})`);
    } else {
      const p1 = startPt, p2 = snapped;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      console.log(`[divider-draw:click2] p1=(${p1.x.toFixed(1)},${p1.y.toFixed(1)}) p2=(${p2.x.toFixed(1)},${p2.y.toFixed(1)}) dist=${dist.toFixed(1)}cm`);
      if (dist > 0.1) {
        cleanup();
        onComplete({ p1, p2 });
      }
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Shift') { shiftHeld = true; return; }
    if (e.key === 'Escape') { cleanup(); onCancel?.(); }
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') shiftHeld = false;
  }

  function onContextMenu(e) {
    e.preventDefault();
    cleanup();
    onCancel?.();
  }

  function cleanup() {
    startPt = null;
    shiftHeld = false;
    snapDot?.remove(); snapDot = null;
    previewLine?.remove(); previewLine = null;
  }

  function start() {
    active = true;
    shiftHeld = false;
    const svg = getSvg();
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    console.log('[divider-draw:start] draw mode active');
  }

  function stop() {
    active = false;
    cleanup();
    const svg = getSvg();
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerdown', onPointerDown);
    svg.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    console.log('[divider-draw:stop] draw mode inactive');
  }

  return { start, stop, isActive: () => active, reattach };
}
