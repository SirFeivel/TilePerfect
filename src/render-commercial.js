// src/render-commercial.js
import { computeProjectTotals } from "./calc.js";
import { getRoomBounds } from "./geometry.js";
import { t } from "./i18n.js";

export function renderCommercialTab(state) {
  const roomsListEl = document.getElementById("commercialRoomsList");
  const materialsListEl = document.getElementById("commercialMaterialsList");
  if (!roomsListEl || !materialsListEl) return;

  const proj = computeProjectTotals(state);

  // 1. Render Rooms Table
  roomsListEl.replaceChildren();
  const roomsTable = document.createElement("table");
  roomsTable.className = "commercial-table";
  const roomsThead = document.createElement("thead");
  const roomsHeadRow = document.createElement("tr");
  const roomsHeaders = [
    { label: t("tabs.floor") },
    { label: t("tabs.room") },
    { label: t("tile.reference") },
    { label: t("metrics.netArea"), align: "right" },
    { label: t("metrics.totalTiles"), align: "right" },
    { label: t("metrics.price"), align: "right" }
  ];
  roomsHeaders.forEach(({ label, align }) => {
    const th = document.createElement("th");
    th.textContent = label;
    if (align) th.style.textAlign = align;
    roomsHeadRow.appendChild(th);
  });
  roomsThead.appendChild(roomsHeadRow);
  roomsTable.appendChild(roomsThead);
  const roomsTbody = document.createElement("tbody");
  for (const r of proj.rooms) {
    const tr = document.createElement("tr");
    const floorTd = document.createElement("td");
    floorTd.className = "subtle";
    floorTd.textContent = r.floorName || "";
    const roomTd = document.createElement("td");
    roomTd.className = "room-name";
    roomTd.textContent = r.name || "";
    const refTd = document.createElement("td");
    refTd.className = "material-ref";
    refTd.textContent = r.reference || "-";
    const areaTd = document.createElement("td");
    areaTd.style.textAlign = "right";
    areaTd.textContent = `${r.netAreaM2.toFixed(2)} m²`;
    const tilesTd = document.createElement("td");
    tilesTd.style.textAlign = "right";
    tilesTd.textContent = String(r.totalTiles);
    const costTd = document.createElement("td");
    costTd.style.textAlign = "right";
    costTd.textContent = `${r.totalCost.toFixed(2)} €`;
    tr.append(floorTd, roomTd, refTd, areaTd, tilesTd, costTd);
    roomsTbody.appendChild(tr);
  }
  roomsTable.appendChild(roomsTbody);
  roomsListEl.appendChild(roomsTable);

  // 2. Render Consolidated Materials Table
  materialsListEl.replaceChildren();
  const matsTable = document.createElement("table");
  matsTable.className = "commercial-table";
  const matsThead = document.createElement("thead");
  const matsHeadRow = document.createElement("tr");
  const matsHeaders = [
    { label: t("tile.reference") },
    { label: t("commercial.totalM2"), align: "right" },
    { label: t("commercial.totalTiles"), align: "right" },
    { label: t("commercial.totalPacks"), align: "right" },
    { label: t("commercial.packsFloor"), align: "right" },
    { label: t("commercial.packsSkirting"), align: "right" },
    { label: t("commercial.amountOverride"), align: "right" },
    { label: t("commercial.pricePerM2"), align: "right" },
    { label: t("commercial.pricePerPack"), align: "right" },
    { label: t("commercial.packSize"), align: "right" },
    { label: t("commercial.totalCost"), align: "right" }
  ];
  matsHeaders.forEach(({ label, align }) => {
    const th = document.createElement("th");
    th.textContent = label;
    if (align) th.style.textAlign = align;
    matsHeadRow.appendChild(th);
  });
  matsThead.appendChild(matsHeadRow);
  matsTable.appendChild(matsThead);
  const matsTbody = document.createElement("tbody");
  for (const m of proj.materials) {
    const ref = m.reference || "";
    const pricePerPack = (m.pricePerM2 * m.packM2).toFixed(2);
    const tr = document.createElement("tr");
    const refTd = document.createElement("td");
    refTd.className = "material-ref";
    refTd.textContent = ref || t("commercial.defaultMaterial");
    const areaTd = document.createElement("td");
    areaTd.style.textAlign = "right";
    areaTd.textContent = `${m.netAreaM2.toFixed(2)} m²`;
    const tilesTd = document.createElement("td");
    tilesTd.style.textAlign = "right";
    tilesTd.textContent = String(m.totalTiles);
    const packsTd = document.createElement("td");
    packsTd.style.textAlign = "right";
    const packsStrong = document.createElement("strong");
    packsStrong.textContent = String(m.totalPacks || 0);
    packsTd.appendChild(packsStrong);
    const floorPacksTd = document.createElement("td");
    floorPacksTd.style.textAlign = "right";
    floorPacksTd.textContent = String(m.floorPacks || 0);
    const skirtingPacksTd = document.createElement("td");
    skirtingPacksTd.style.textAlign = "right";
    skirtingPacksTd.textContent = String(m.skirtingPacks || 0);
    const extraTd = document.createElement("td");
    extraTd.style.textAlign = "right";
    const extraInput = document.createElement("input");
    extraInput.type = "number";
    extraInput.step = "1";
    extraInput.className = "commercial-edit";
    extraInput.dataset.ref = ref;
    extraInput.dataset.prop = "extraPacks";
    extraInput.value = String(m.extraPacks);
    extraInput.style.width = "40px";
    extraTd.appendChild(extraInput);
    const priceM2Td = document.createElement("td");
    priceM2Td.style.textAlign = "right";
    const priceM2Input = document.createElement("input");
    priceM2Input.type = "number";
    priceM2Input.step = "0.01";
    priceM2Input.className = "commercial-edit";
    priceM2Input.dataset.ref = ref;
    priceM2Input.dataset.prop = "pricePerM2";
    priceM2Input.value = m.pricePerM2.toFixed(2);
    priceM2Input.style.width = "60px";
    const priceM2Unit = document.createElement("span");
    priceM2Unit.textContent = " €";
    priceM2Td.append(priceM2Input, priceM2Unit);
    const pricePackTd = document.createElement("td");
    pricePackTd.style.textAlign = "right";
    const pricePackInput = document.createElement("input");
    pricePackInput.type = "number";
    pricePackInput.step = "0.01";
    pricePackInput.className = "commercial-edit";
    pricePackInput.dataset.ref = ref;
    pricePackInput.dataset.prop = "pricePerPack";
    pricePackInput.value = pricePerPack;
    pricePackInput.style.width = "60px";
    const pricePackUnit = document.createElement("span");
    pricePackUnit.textContent = " €";
    pricePackTd.append(pricePackInput, pricePackUnit);
    const packSizeTd = document.createElement("td");
    packSizeTd.style.textAlign = "right";
    const packSizeInput = document.createElement("input");
    packSizeInput.type = "number";
    packSizeInput.step = "0.01";
    packSizeInput.className = "commercial-edit";
    packSizeInput.dataset.ref = ref;
    packSizeInput.dataset.prop = "packM2";
    packSizeInput.value = String(m.packM2);
    const packSizeUnit = document.createElement("span");
    packSizeUnit.textContent = " m²";
    packSizeTd.append(packSizeInput, packSizeUnit);
    const costTd = document.createElement("td");
    costTd.style.textAlign = "right";
    const costStrong = document.createElement("strong");
    costStrong.textContent = `${m.adjustedCost.toFixed(2)} €`;
    costTd.appendChild(costStrong);
    tr.append(
      refTd,
      areaTd,
      tilesTd,
      packsTd,
      floorPacksTd,
      skirtingPacksTd,
      extraTd,
      priceM2Td,
      pricePackTd,
      packSizeTd,
      costTd
    );
    matsTbody.appendChild(tr);
  }
  const totalRow = document.createElement("tr");
  totalRow.style.borderTop = "2px solid var(--line2)";
  totalRow.style.fontWeight = "bold";
  const totalLabel = document.createElement("td");
  totalLabel.textContent = t("commercial.grandTotal");
  const totalArea = document.createElement("td");
  totalArea.style.textAlign = "right";
  totalArea.textContent = `${proj.totalNetAreaM2.toFixed(2)} m²`;
  const totalTiles = document.createElement("td");
  totalTiles.style.textAlign = "right";
  totalTiles.textContent = String(proj.totalTiles);
  const totalPacks = document.createElement("td");
  totalPacks.style.textAlign = "right";
  totalPacks.textContent = String(proj.totalPacks);
  const totalFloor = document.createElement("td");
  totalFloor.style.textAlign = "right";
  totalFloor.textContent = "–";
  const totalSkirting = document.createElement("td");
  totalSkirting.style.textAlign = "right";
  totalSkirting.textContent = "–";
  const totalSpacer = document.createElement("td");
  totalSpacer.colSpan = 4;
  const totalCost = document.createElement("td");
  totalCost.style.textAlign = "right";
  totalCost.style.color = "var(--accent)";
  totalCost.textContent = `${proj.totalCost.toFixed(2)} €`;
  totalRow.append(
    totalLabel,
    totalArea,
    totalTiles,
    totalPacks,
    totalFloor,
    totalSkirting,
    totalSpacer,
    totalCost
  );
  matsTbody.appendChild(totalRow);
  matsTable.appendChild(matsTbody);
  materialsListEl.appendChild(matsTable);
}

export function renderExportTab(state, selection = null) {
  const listEl = document.getElementById("exportRoomsList");
  if (!listEl) return;

  listEl.replaceChildren();

  const floors = state.floors || [];
  const roomCount = floors.reduce((sum, floor) => sum + (floor.rooms?.length || 0), 0);
  const btnRoomsPdf = document.getElementById("btnExportRoomsPdf");
  const btnCommercialPdf = document.getElementById("btnExportCommercialPdf");
  const btnCommercialXlsx = document.getElementById("btnExportCommercialXlsx");

  if (btnRoomsPdf) btnRoomsPdf.disabled = roomCount === 0;
  if (btnCommercialPdf) btnCommercialPdf.disabled = roomCount === 0;
  if (btnCommercialXlsx) btnCommercialXlsx.disabled = roomCount === 0;

  if (!floors.length || roomCount === 0) {
    const empty = document.createElement("div");
    empty.className = "subtle";
    empty.textContent = t("export.noRoomsSelected");
    listEl.appendChild(empty);
    return;
  }

  const hasSelection = selection instanceof Set;

  for (const floor of floors) {
    if (!floor.rooms || floor.rooms.length === 0) continue;

    const group = document.createElement("div");
    group.className = "export-room-group";

    const title = document.createElement("div");
    title.className = "export-room-group-title";
    title.textContent = floor.name || t("tabs.floor");
    group.appendChild(title);

    for (const room of floor.rooms) {
      const row = document.createElement("div");
      row.className = "export-room-item";

      const labelWrap = document.createElement("div");
      labelWrap.className = "export-room-label";

      const name = document.createElement("div");
      name.className = "export-room-name";
      name.textContent = room.name || t("tabs.room");

      const meta = document.createElement("div");
      meta.className = "export-room-meta";
      const bounds = getRoomBounds(room);
      if (bounds.width > 0 && bounds.height > 0) {
        meta.textContent = `${Math.round(bounds.width)} x ${Math.round(bounds.height)} cm`;
      } else {
        meta.textContent = "–";
      }

      labelWrap.append(name, meta);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "checkbox export-room-checkbox";
      checkbox.dataset.roomId = room.id;
      checkbox.checked = hasSelection ? selection.has(room.id) : true;

      row.append(checkbox, labelWrap);
      group.appendChild(row);
    }

    listEl.appendChild(group);
  }
}
