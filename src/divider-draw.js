// src/divider-draw.js — Draw controller for surface divider lines
import { pointerToSvgXY } from './svg-coords.js';
import { findNearestEdgePoint } from './polygon-draw.js';
import { pointInPolygon } from './geometry.js';

/**
 * createDividerDrawController
 *
 * getSvg()            → SVG element
 * getSurfacePolygons() → [{id, type:'uncovered'|'zone', exclId?, vertices:[{x,y}]}]
 *                        All snap-eligible polygons: uncovered area pieces + zones.
 * onComplete({p1, p2, targetPolygon}) → called when both clicks land
 * onCancel()          → called on Escape / right-click
 *
 * Behaviour:
 *  Phase 0 (before click1): raw mouse position determines the active polygon via
 *    point-in-polygon; highlight shows; snap dot is on active polygon's nearest edge.
 *  Phase 1 (after click1): target polygon locked; snap restricted to its edges only.
 *  Shift: constrains line direction to 15° increments using ray-polygon intersection.
 */
export function createDividerDrawController({ getSvg, getSurfacePolygons, onComplete, onCancel }) {
  let active = false;
  let startPt = null;
  let targetPolygon = null; // locked after click1
  let shiftHeld = false;

  // SVG overlay elements
  let snapDot = null;
  let previewLine = null;
  let highlight = null; // polygon fill to show active/target polygon

  // ── helpers ────────────────────────────────────────────────────────────────

  function polyToEdges(poly) {
    const v = poly.vertices;
    return v.map((pt, i) => ({
      roomId: poly.id,
      edge: { p1: pt, p2: v[(i + 1) % v.length] },
    }));
  }

  function allEdges() {
    return getSurfacePolygons().flatMap(polyToEdges);
  }

  function targetEdges() {
    return targetPolygon ? polyToEdges(targetPolygon) : allEdges();
  }

  // Find first intersection of a ray from origin at angleRad with a polygon boundary.
  function rayPolyIntersect(origin, angleRad, vertices) {
    if (!vertices?.length) return null;
    const cx = Math.cos(angleRad), cy = Math.sin(angleRad);
    let bestT = Infinity, best = null;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
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

  function constrainedAngle(from, rawPt) {
    const dx = rawPt.x - from.x, dy = rawPt.y - from.y;
    if (Math.hypot(dx, dy) < 0.01) return null;
    return Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
  }

  // Find which polygon in the set contains rawPt; null if none.
  function findActivePoly(rawPt) {
    const polys = getSurfacePolygons();
    for (const p of polys) {
      if (pointInPolygon(rawPt, p.vertices)) return p;
    }
    return null;
  }

  // ── SVG element management ──────────────────────────────────────────────────

  function ensureHighlight() {
    if (highlight) return highlight;
    highlight = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    highlight.setAttribute('pointer-events', 'none');
    getSvg().appendChild(highlight);
    return highlight;
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

  function updateHighlight(poly, locked) {
    if (!poly) {
      if (highlight) highlight.style.display = 'none';
      return;
    }
    const d = 'M ' + poly.vertices.map(v => `${v.x},${v.y}`).join(' L ') + ' Z';
    const el = ensureHighlight();
    el.setAttribute('d', d);
    if (locked) {
      el.setAttribute('fill', 'rgba(34,197,94,0.10)');
      el.setAttribute('stroke', 'rgba(34,197,94,0.50)');
    } else {
      el.setAttribute('fill', 'rgba(99,102,241,0.08)');
      el.setAttribute('stroke', 'rgba(99,102,241,0.35)');
    }
    el.setAttribute('stroke-width', '1');
    el.setAttribute('stroke-dasharray', '3 2');
    el.style.display = '';
  }

  function reattach() {
    if (!active) return;
    const svg = getSvg();
    if (highlight) svg.appendChild(highlight);
    if (previewLine) svg.appendChild(previewLine);
    if (snapDot) svg.appendChild(snapDot);
  }

  // ── core computation ────────────────────────────────────────────────────────

  function computeFrame(rawPt) {
    const currentPoly = targetPolygon || findActivePoly(rawPt);

    let dotPt = null, previewEnd = null;

    if (currentPoly) {
      if (startPt && shiftHeld) {
        const ang = constrainedAngle(startPt, rawPt);
        if (ang !== null) {
          const intersection = rayPolyIntersect(startPt, ang, currentPoly.vertices);
          dotPt = intersection;
          previewEnd = intersection || rawPt;
          console.log(`[divider-draw:shift] ang=${(ang * 180 / Math.PI).toFixed(0)}° hit=${!!intersection}`);
        }
      }
      if (!dotPt) {
        const edges = targetPolygon ? targetEdges() : polyToEdges(currentPoly);
        const nr = findNearestEdgePoint(rawPt, edges);
        dotPt = nr?.point || null;
        previewEnd = dotPt;
      }
    }

    return { currentPoly, dotPt, previewEnd };
  }

  // ── event handlers ──────────────────────────────────────────────────────────

  function onPointerMove(e) {
    const rawPt = pointerToSvgXY(getSvg(), e.clientX, e.clientY);
    const { currentPoly, dotPt, previewEnd } = computeFrame(rawPt);

    updateHighlight(currentPoly, !!targetPolygon);

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
    const { currentPoly, dotPt } = computeFrame(rawPt);
    if (!dotPt || !currentPoly) return;

    if (!startPt) {
      startPt = dotPt;
      targetPolygon = currentPoly;
      console.log(`[divider-draw:click1] poly=${currentPoly.id} type=${currentPoly.type} startPt=(${dotPt.x.toFixed(1)},${dotPt.y.toFixed(1)})`);
    } else {
      const p1 = startPt, p2 = dotPt;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      console.log(`[divider-draw:click2] p1=(${p1.x.toFixed(1)},${p1.y.toFixed(1)}) p2=(${p2.x.toFixed(1)},${p2.y.toFixed(1)}) dist=${dist.toFixed(1)}cm targetPoly=${targetPolygon.id}`);
      if (dist > 0.1) {
        const tp = targetPolygon;
        cleanup();
        onComplete({ p1, p2, targetPolygon: tp });
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
    targetPolygon = null;
    shiftHeld = false;
    snapDot?.remove(); snapDot = null;
    previewLine?.remove(); previewLine = null;
    highlight?.remove(); highlight = null;
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
