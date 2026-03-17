// src/render-metrics.js
import { computePlanMetrics, computeSkirtingNeeds, computeGrandTotals } from "./calc.js";
import { validateState } from "./validation.js";
import { t } from "./i18n.js";

export function renderMetrics(state) {
  const areaEl = document.getElementById("metricArea");
  const tilesEl = document.getElementById("metricTiles");
  const packsEl = document.getElementById("metricPacks");
  const costEl = document.getElementById("metricCost");
  const cutTilesEl = document.getElementById("metricCutTiles");
  const wasteEl = document.getElementById("metricWaste");

  if (!areaEl || !tilesEl || !packsEl || !costEl) return;

  const { errors } = validateState(state);
  const ratioError = errors.find(e =>
    e.title.includes(t("validation.herringboneRatioTitle")) ||
    e.title.includes(t("validation.doubleHerringboneRatioTitle")) ||
    e.title.includes(t("validation.basketweaveRatioTitle"))
  );

  const m = computePlanMetrics(state);
  if (!m.ok || ratioError) {
    areaEl.textContent = "–";
    tilesEl.textContent = "–";
    packsEl.textContent = "–";
    costEl.textContent = ratioError ? `${t("warnings.error")}: ${ratioError.title}` : m.error;
    if (cutTilesEl) cutTilesEl.textContent = "–";
    if (wasteEl) wasteEl.textContent = "–";

    const grandBox = document.getElementById("grandTotalBox");
    if (grandBox) grandBox.style.display = "none";

    return;
  }

  const d = m.data;
  const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");
  const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");

  areaEl.textContent = `${f2(d.area.netAreaM2)} m²`;
  tilesEl.textContent = `${d.tiles.totalTilesWithReserve} (${d.tiles.fullTiles} full, ${d.tiles.cutTiles} cut, ${d.tiles.reusedCuts} reused)`;

  const packs = d.pricing.packs;
  if (packs !== null && packs > 0) {
    packsEl.textContent = `${packs} (${f2(d.material.purchasedAreaM2)} m²)`;
  } else {
    packsEl.textContent = `${f2(d.material.purchasedAreaM2)} m²`;
  }

  costEl.textContent = `${f2(d.pricing.priceTotal)} €`;

  if (cutTilesEl) {
    cutTilesEl.textContent = `${d.labor.cutTiles} (${f1(d.labor.cutTilesPct)}%)`;
  }

  if (wasteEl) {
    wasteEl.textContent = `${f2(d.material.wasteAreaM2)} m² (${f1(d.material.wastePct)}%, ~${d.material.wasteTiles_est} tiles)`;
  }

  // Skirting Metrics
  const skirting = computeSkirtingNeeds(state);
  const skirtingBox = document.getElementById("skirtingMetricsBox");
  if (skirtingBox) {
    if (skirting.enabled) {
      skirtingBox.style.display = "block";
      document.getElementById("metricSkirtingLength").textContent = skirting.totalLengthCm.toFixed(1);
      document.getElementById("metricSkirtingCount").textContent = skirting.count;
      document.getElementById("metricSkirtingCost").textContent = skirting.totalCost.toFixed(2) + " €";

      const labelCount = document.getElementById("labelSkirtingPieces");
      const stripsWrap = document.getElementById("stripsPerTileWrap");

      if (skirting.type === "bought") {
        labelCount.textContent = t("skirting.pieces");
        stripsWrap.style.display = "none";
      } else {
        labelCount.textContent = t("skirting.additionalTiles");
        stripsWrap.style.display = "block";
        document.getElementById("metricSkirtingStripsPerTile").textContent = skirting.stripsPerTile;
      }
    } else {
      skirtingBox.style.display = "none";
    }
  }

  // Grand Total Metrics
  const grand = computeGrandTotals(state);
  const grandBox = document.getElementById("grandTotalBox");
  if (grandBox) {
    if (grand.ok && grand.skirtingEnabled && !ratioError) {
      grandBox.style.display = "block";
      document.getElementById("metricGrandTotalTiles").textContent = grand.totalTiles;

      const packsEl = document.getElementById("metricGrandTotalPacks");
      if (grand.totalPacks !== null) {
        packsEl.textContent = `${grand.totalPacks} (${f2(grand.purchasedAreaM2)} m²)`;
      } else {
        packsEl.textContent = `${f2(grand.purchasedAreaM2)} m²`;
      }

      document.getElementById("metricGrandTotalCost").textContent = grand.totalCost.toFixed(2) + " €";
    } else {
      grandBox.style.display = "none";
    }
  }
}
