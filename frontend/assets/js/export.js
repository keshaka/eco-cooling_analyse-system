// ── Chart registry ─────────────────────────────────────────────────
const charts = new Map();

// ── Chart definitions ──────────────────────────────────────────────

const SINGLE_LINE_CHARTS = [
  // Outdoor
  { canvasId: "expOutdoorTempChart", rowKey: "moss", valueKey: "outdoorTemp", label: "Outdoor Temperature (°C)", color: "#2d7a4b", group: "outdoor" },
  { canvasId: "expOutdoorHumidityChart", rowKey: "moss", valueKey: "outdoorHumidity", label: "Outdoor Humidity (%)", color: "#3a9d5e", group: "outdoor" },
  // Moss
  { canvasId: "expMossSurfaceChart", rowKey: "moss", valueKey: "mossSurfaceTemp", label: "Surface Temperature (°C)", color: "#4e8d5f", group: "moss" },
  { canvasId: "expMossAirTempChart", rowKey: "moss", valueKey: "nearMossTemp", label: "Near Moss Temperature (°C)", color: "#2f8f83", group: "moss" },
  { canvasId: "expMossHumidityChart", rowKey: "moss", valueKey: "nearMossHumidity", label: "Near Moss Humidity (%)", color: "#2a9382", group: "moss" },
  { canvasId: "expMossWallTempChart", rowKey: "moss", valueKey: "wallTemp", label: "Wall Temperature (°C)", color: "#356f9e", group: "moss" },
  // Non-Moss
  { canvasId: "expNonMossSurfaceChart", rowKey: "nonMoss", valueKey: "nonMossSurfaceTemp", label: "Surface Temperature (°C)", color: "#d4732f", group: "nonMoss" },
  { canvasId: "expNonMossAirTempChart", rowKey: "nonMoss", valueKey: "nearNonMossTemp", label: "Near Non-Moss Temperature (°C)", color: "#bb5a26", group: "nonMoss" },
  { canvasId: "expNonMossHumidityChart", rowKey: "nonMoss", valueKey: "nearNonMossHumidity", label: "Near Non-Moss Humidity (%)", color: "#a46f1a", group: "nonMoss" },
  { canvasId: "expNonMossWallTempChart", rowKey: "nonMoss", valueKey: "wallTemp", label: "Wall Temperature (°C)", color: "#9d4c7c", group: "nonMoss" },
];

const COMPARE_LINE_CHARTS = [
  { canvasId: "expSurfaceCompareChart", mossKey: "mossSurfaceTemp", nonMossKey: "nonMossSurfaceTemp", label: "Surface Temperature", group: "compare" },
  { canvasId: "expAirTempCompareChart", mossKey: "nearMossTemp", nonMossKey: "nearNonMossTemp", label: "Near-Air Temperature", group: "compare" },
  { canvasId: "expHumidityCompareChart", mossKey: "nearMossHumidity", nonMossKey: "nearNonMossHumidity", label: "Near-Air Humidity", group: "compare" },
  { canvasId: "expWallCompareChart", mossKey: "wallTemp", nonMossKey: "wallTemp", label: "Wall Temperature", group: "compare" },
];

// ── Chart creation helpers ─────────────────────────────────────────

function makeSingleLineChart(canvasId, label, color) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor: color,
        backgroundColor: `${color}22`,
        tension: 0.35,
        fill: true,
        pointRadius: 1.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10 } },
      },
    },
  });
  charts.set(canvasId, chart);
  return chart;
}

function makeCompareLineChart(canvasId, label) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: `Moss — ${label}`,
          data: [],
          borderColor: "#2d7a4b",
          backgroundColor: "#2d7a4b22",
          tension: 0.3,
          fill: true,
          pointRadius: 1.5,
        },
        {
          label: `Non-Moss — ${label}`,
          data: [],
          borderColor: "#d4732f",
          backgroundColor: "#d4732f22",
          tension: 0.3,
          fill: true,
          pointRadius: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10 } },
      },
    },
  });
  charts.set(canvasId, chart);
  return chart;
}

function makeCompareBarChart() {
  const ctx = document.getElementById("expCompareBarChart");
  if (!ctx) return null;

  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Surface Temp", "Near-Air Temp", "Near-Air Humidity", "Wall Temp"],
      datasets: [
        {
          label: "Moss Average",
          data: [],
          backgroundColor: "#2d7a4bcc",
          borderRadius: 8,
        },
        {
          label: "Non-Moss Average",
          data: [],
          backgroundColor: "#d4732fcc",
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
  charts.set("expCompareBarChart", chart);
  return chart;
}

// ── Data helpers ───────────────────────────────────────────────────

function sortByTimestamp(rows) {
  return [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function toTimeLabel(ts) {
  return new Date(ts).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toTimestampKey(value) {
  return new Date(value).toISOString();
}

// ── Update chart data ─────────────────────────────────────────────

function updateSingleChart(canvasId, rows, valueKey) {
  const chart = charts.get(canvasId);
  if (!chart) return;
  const sorted = sortByTimestamp(rows);
  chart.data.labels = sorted.map((r) => toTimeLabel(r.timestamp));
  chart.data.datasets[0].data = sorted.map((r) => r[valueKey]);
  chart.update();
}

function updateCompareLineChart(canvasId, mossRows, nonMossRows, mossKey, nonMossKey) {
  const chart = charts.get(canvasId);
  if (!chart) return;

  const moss = sortByTimestamp(mossRows);
  const nonMoss = sortByTimestamp(nonMossRows);
  const mossLookup = new Map(moss.map((r) => [toTimestampKey(r.timestamp), r]));
  const nonMossLookup = new Map(nonMoss.map((r) => [toTimestampKey(r.timestamp), r]));
  const timestamps = [
    ...new Set([
      ...moss.map((r) => toTimestampKey(r.timestamp)),
      ...nonMoss.map((r) => toTimestampKey(r.timestamp)),
    ]),
  ].sort();

  chart.data.labels = timestamps.map((ts) => toTimeLabel(ts));
  chart.data.datasets[0].data = timestamps.map((ts) => mossLookup.get(ts)?.[mossKey] ?? null);
  chart.data.datasets[1].data = timestamps.map((ts) => nonMossLookup.get(ts)?.[nonMossKey] ?? null);
  chart.update();
}

function updateCompareBarChart(compareData) {
  const chart = charts.get("expCompareBarChart");
  if (!chart) return;

  chart.data.datasets[0].data = [
    compareData.surfaceTemperature.mossAverage,
    compareData.nearAirTemperature.mossAverage,
    compareData.nearAirHumidity.mossAverage,
    compareData.wallTemperature.mossAverage,
  ];
  chart.data.datasets[1].data = [
    compareData.surfaceTemperature.nonMossAverage,
    compareData.nearAirTemperature.nonMossAverage,
    compareData.nearAirHumidity.nonMossAverage,
    compareData.wallTemperature.nonMossAverage,
  ];
  chart.update();
}

// ── Export helpers ─────────────────────────────────────────────────

function downloadCanvasAsPng(canvasId, filename) {
  const chart = charts.get(canvasId);
  if (!chart) return;

  const canvas = chart.canvas;
  // Create a temporary canvas with white background for clean export
  const tempCanvas = document.createElement("canvas");
  const scale = 2; // 2x resolution for crisp export
  tempCanvas.width = canvas.width * scale;
  tempCanvas.height = canvas.height * scale;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.scale(scale, scale);
  tempCtx.fillStyle = "#1b241d";
  tempCtx.fillRect(0, 0, canvas.width, canvas.height);
  tempCtx.drawImage(canvas, 0, 0);

  const link = document.createElement("a");
  link.download = `${filename}.png`;
  link.href = tempCanvas.toDataURL("image/png");
  link.click();
}

function downloadGroupAsPng(groupName) {
  const canvasIds = getGroupCanvasIds(groupName);
  canvasIds.forEach((canvasId) => {
    const nameAttr = document.querySelector(`[data-canvas="${canvasId}"]`)?.dataset.name || canvasId;
    downloadCanvasAsPng(canvasId, nameAttr);
  });
}

function downloadAllAsPng() {
  document.querySelectorAll(".btn-export-single").forEach((btn) => {
    const canvasId = btn.dataset.canvas;
    const name = btn.dataset.name || canvasId;
    downloadCanvasAsPng(canvasId, name);
  });
}

function getGroupCanvasIds(groupName) {
  const groupMap = {
    outdoor: SINGLE_LINE_CHARTS.filter((c) => c.group === "outdoor").map((c) => c.canvasId),
    moss: SINGLE_LINE_CHARTS.filter((c) => c.group === "moss").map((c) => c.canvasId),
    nonMoss: SINGLE_LINE_CHARTS.filter((c) => c.group === "nonMoss").map((c) => c.canvasId),
    compare: [
      "expCompareBarChart",
      ...COMPARE_LINE_CHARTS.map((c) => c.canvasId),
    ],
  };
  return groupMap[groupName] || [];
}

// ── Main generate flow ────────────────────────────────────────────

function initAllCharts() {
  // Destroy existing
  charts.forEach((chart) => chart.destroy());
  charts.clear();

  // Single line charts
  SINGLE_LINE_CHARTS.forEach((cfg) => {
    makeSingleLineChart(cfg.canvasId, cfg.label, cfg.color);
  });

  // Compare bar
  makeCompareBarChart();

  // Compare line charts
  COMPARE_LINE_CHARTS.forEach((cfg) => {
    makeCompareLineChart(cfg.canvasId, cfg.label);
  });
}

async function generateAllCharts() {
  const start = document.getElementById("exportStartDate").value;
  const end = document.getElementById("exportEndDate").value;

  if (!start || !end) {
    alert("Please select start and end dates.");
    return;
  }

  const loading = document.getElementById("loadingIndicator");
  loading.style.display = "flex";

  // Show all chart groups
  document.querySelectorAll(".export-group").forEach((el) => {
    el.style.display = "";
  });

  // Re-initialize charts (in case this isn't the first time)
  initAllCharts();

  try {
    // Fetch history data (both moss and non-moss)
    const [historyData, compareData] = await Promise.all([
      apiGet(`/api/data/history?start=${start}&end=${end}`),
      apiGet("/api/data/compare"),
    ]);

    const moss = historyData.moss || [];
    const nonMoss = historyData.nonMoss || [];

    // Update single-line charts
    SINGLE_LINE_CHARTS.forEach((cfg) => {
      const rows = cfg.rowKey === "moss" ? moss : nonMoss;
      updateSingleChart(cfg.canvasId, rows, cfg.valueKey);
    });

    // Update compare bar chart
    updateCompareBarChart(compareData);

    // Update compare line charts
    COMPARE_LINE_CHARTS.forEach((cfg) => {
      updateCompareLineChart(cfg.canvasId, moss, nonMoss, cfg.mossKey, cfg.nonMossKey);
    });
  } catch (error) {
    console.error("Failed to generate charts:", error);
    alert("Failed to load data. Check your connection and date range.");
  } finally {
    loading.style.display = "none";
  }
}

// ── Event binding ─────────────────────────────────────────────────

function initDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);

  document.getElementById("exportStartDate").value = start.toISOString().slice(0, 10);
  document.getElementById("exportEndDate").value = end.toISOString().slice(0, 10);
}

document.addEventListener("DOMContentLoaded", () => {
  initDefaultDates();

  // Generate button
  document.getElementById("generateCharts").addEventListener("click", generateAllCharts);

  // Export All
  document.getElementById("exportAllPng").addEventListener("click", () => {
    if (charts.size === 0) {
      alert("Please generate charts first.");
      return;
    }
    downloadAllAsPng();
  });

  // Individual export buttons
  document.querySelectorAll(".btn-export-single").forEach((btn) => {
    btn.addEventListener("click", () => {
      const canvasId = btn.dataset.canvas;
      const name = btn.dataset.name || canvasId;
      if (!charts.has(canvasId)) {
        alert("Please generate charts first.");
        return;
      }
      downloadCanvasAsPng(canvasId, name);
    });
  });

  // Group export buttons
  document.querySelectorAll(".btn-export-group").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.dataset.group;
      if (charts.size === 0) {
        alert("Please generate charts first.");
        return;
      }
      downloadGroupAsPng(group);
    });
  });
});
