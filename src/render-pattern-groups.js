// src/render-pattern-groups.js
import { svgEl, multiPolygonToPathD, roomPolygon, getRoomBounds } from "./geometry.js";
import { getRoomPatternGroup } from "./pattern-groups.js";
import { setBaseViewBox, calculateEffectiveViewBox } from "./viewport.js";
import { getFloorBounds } from "./floor_geometry.js";
import { t } from "./i18n.js";

function isCircleRoom(room) {
  return room?.circle && room.circle.rx > 0;
}

export function renderPatternGroupsCanvas({
  state,
  floor,
  selectedRoomId,
  activeGroupId = null,
  onRoomClick,
  onRoomDoubleClick,
  svgOverride = null
}) {
  const svg = svgOverride || document.getElementById("planSvg");
  if (!svg) return;

  // Clear existing content
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (!floor || !floor.rooms?.length) {
    svg.setAttribute("viewBox", "0 0 100 100");
    return;
  }

  // Get floor bounds encompassing all rooms
  const bounds = getFloorBounds(floor);
  const padding = 80;

  const baseViewBox = {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    width: bounds.width + 2 * padding,
    height: bounds.height + 2 * padding
  };

  // Use floor-specific viewport key (shared with floor view)
  const viewportKey = `floor:${floor.id}`;
  setBaseViewBox(viewportKey, baseViewBox);

  const effectiveViewBox = calculateEffectiveViewBox(viewportKey) || baseViewBox;
  const viewBox = effectiveViewBox;

  svg.setAttribute("viewBox", `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Background
  const bgPadding = Math.max(viewBox.width, viewBox.height) * 2;
  svg.appendChild(svgEl("rect", {
    x: viewBox.minX - bgPadding,
    y: viewBox.minY - bgPadding,
    width: viewBox.width + 2 * bgPadding,
    height: viewBox.height + 2 * bgPadding,
    fill: "#081022"
  }));

  // Render grid - use viewBox with extra padding for aspect ratio letterboxing
  if (state.view?.showGrid) {
    const gridGroup = svgEl("g", { opacity: 0.5 });
    const minor = 10, major = 100;
    const gridPadding = Math.max(viewBox.width, viewBox.height) * 0.5;
    const gridBounds = {
      minX: Math.floor((viewBox.minX - gridPadding) / major) * major,
      minY: Math.floor((viewBox.minY - gridPadding) / major) * major,
      maxX: Math.ceil((viewBox.minX + viewBox.width + gridPadding) / major) * major,
      maxY: Math.ceil((viewBox.minY + viewBox.height + gridPadding) / major) * major
    };

    for (let x = gridBounds.minX; x <= gridBounds.maxX; x += minor) {
      const isMajor = x % major === 0;
      gridGroup.appendChild(svgEl("line", {
        x1: x, y1: gridBounds.minY, x2: x, y2: gridBounds.maxY,
        stroke: isMajor ? "#1f2b46" : "#14203a",
        "stroke-width": isMajor ? 0.6 : 0.3
      }));
    }
    for (let y = gridBounds.minY; y <= gridBounds.maxY; y += minor) {
      const isMajor = y % major === 0;
      gridGroup.appendChild(svgEl("line", {
        x1: gridBounds.minX, y1: y, x2: gridBounds.maxX, y2: y,
        stroke: isMajor ? "#1f2b46" : "#14203a",
        "stroke-width": isMajor ? 0.6 : 0.3
      }));
    }
    svg.appendChild(gridGroup);
  }

  // Render rooms
  const roomsToRenderPG = floor.rooms;

  for (const room of roomsToRenderPG) {
    const pos = room.floorPosition || { x: 0, y: 0 };
    const roomGroup = svgEl("g", {
      transform: `translate(${pos.x}, ${pos.y})`,
      "data-roomid": room.id,
      cursor: "pointer"
    });

    const isSelected = room.id === selectedRoomId;
    const patternGroup = getRoomPatternGroup(floor, room.id);
    const isInGroup = !!patternGroup;
    const isOrigin = patternGroup?.originRoomId === room.id;
    const isActiveGroup = isInGroup && patternGroup.id === activeGroupId;

    // Determine colors based on group membership and active state
    let fillColor, strokeColor, strokeWidth;

    if (isActiveGroup) {
      fillColor = isOrigin ? "rgba(59, 130, 246, 0.35)" : "rgba(59, 130, 246, 0.2)";
      strokeColor = "#3b82f6";
      strokeWidth = isOrigin ? 4 : 3;
    } else if (isInGroup) {
      fillColor = "rgba(100, 116, 139, 0.2)";
      strokeColor = "rgba(148, 163, 184, 0.8)";
      strokeWidth = 3;
    } else {
      fillColor = "rgba(100, 116, 139, 0.15)";
      strokeColor = "rgba(148, 163, 184, 0.5)";
      strokeWidth = 2;
    }

    // Get room polygon
    const roomPoly = roomPolygon(room);
    if (isCircleRoom(room)) {
      const { cx, cy, rx, ry } = room.circle;
      roomGroup.appendChild(svgEl("ellipse", {
        cx, cy, rx, ry,
        fill: fillColor,
        stroke: strokeColor,
        "stroke-width": strokeWidth
      }));
      if (isSelected) {
        roomGroup.appendChild(svgEl("ellipse", {
          cx, cy, rx, ry,
          fill: "none",
          stroke: "#ffffff",
          "stroke-width": 6,
          "stroke-opacity": 0.6
        }));
        roomGroup.appendChild(svgEl("ellipse", {
          cx, cy, rx, ry,
          fill: "none",
          stroke: "#3b82f6",
          "stroke-width": 3,
          "stroke-dasharray": "8,4"
        }));
      }
    } else if (roomPoly && roomPoly.length > 0) {
      const pathD = multiPolygonToPathD(roomPoly);

      // Room fill
      roomGroup.appendChild(svgEl("path", {
        d: pathD,
        fill: fillColor,
        stroke: strokeColor,
        "stroke-width": strokeWidth
      }));

      // Add selection highlight ring for selected room (visible over any group color)
      if (isSelected) {
        // Outer glow/selection ring
        roomGroup.appendChild(svgEl("path", {
          d: pathD,
          fill: "none",
          stroke: "#ffffff",
          "stroke-width": 6,
          "stroke-opacity": 0.6
        }));
        // Inner bright border
        roomGroup.appendChild(svgEl("path", {
          d: pathD,
          fill: "none",
          stroke: "#3b82f6",
          "stroke-width": 3,
          "stroke-dasharray": "8,4"
        }));
      }

      // Add origin marker for origin rooms
      if (isOrigin) {
        const roomBounds = getRoomBounds(room);
        const markerX = roomBounds.minX + 15;
        const markerY = roomBounds.minY + 15;
        const markerColor = isActiveGroup ? "#3b82f6" : "rgba(148, 163, 184, 0.8)";
        const markerFill = isActiveGroup ? "rgba(59, 130, 246, 0.35)" : "rgba(100, 116, 139, 0.3)";

        // Target/origin icon
        roomGroup.appendChild(svgEl("circle", {
          cx: markerX, cy: markerY, r: 10,
          fill: markerFill,
          stroke: markerColor,
          "stroke-width": 2
        }));
        roomGroup.appendChild(svgEl("circle", {
          cx: markerX, cy: markerY, r: 4,
          fill: markerColor
        }));
      }
    }

    // Room label
    const roomBounds = getRoomBounds(room);
    const labelX = roomBounds.width / 2 + roomBounds.minX;
    const labelY = roomBounds.height / 2 + roomBounds.minY;

    const labelColor = isActiveGroup
      ? "#3b82f6"
      : (isSelected ? "#94a3b8" : "rgba(148, 163, 184, 0.8)");

    const fontSize = Math.min(14, Math.max(9, roomBounds.width / 12));

    const textEl = svgEl("text", {
      x: labelX,
      y: labelY,
      fill: labelColor,
      "font-size": fontSize,
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "font-weight": isOrigin ? "700" : (isInGroup ? "600" : "500"),
      "text-anchor": "middle",
      "dominant-baseline": "middle"
    });
    textEl.appendChild(document.createTextNode(room.name || t("tabs.room")));
    roomGroup.appendChild(textEl);

    // Event handlers
    if (onRoomClick) {
      roomGroup.addEventListener("click", (e) => {
        e.stopPropagation();
        onRoomClick(room.id);
      });
    }

    if (onRoomDoubleClick) {
      roomGroup.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        onRoomDoubleClick(room.id);
      });
    }

    svg.appendChild(roomGroup);
  }
}
