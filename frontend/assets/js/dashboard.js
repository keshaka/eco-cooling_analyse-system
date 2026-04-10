const HISTORY_DAYS = 1;

const LATEST_METRICS = [
  { id: "mossOutdoorTemp", path: ["moss", "outdoorTemp"], unit: "degC" },
  { id: "mossOutdoorHumidity", path: ["moss", "outdoorHumidity"], unit: "%" },
  { id: "mossSurface", path: ["moss", "mossSurfaceTemp"], unit: "degC" },
  { id: "mossAirTemp", path: ["moss", "nearMossTemp"], unit: "degC" },
  { id: "mossHumidity", path: ["moss", "nearMossHumidity"], unit: "%" },
  { id: "mossWallTemp", path: ["moss", "wallTemp"], unit: "degC" },
  { id: "nonMossSurface", path: ["nonMoss", "nonMossSurfaceTemp"], unit: "degC" },
  { id: "nonMossAirTemp", path: ["nonMoss", "nearNonMossTemp"], unit: "degC" },
  { id: "nonMossHumidity", path: ["nonMoss", "nearNonMossHumidity"], unit: "%" },
  { id: "nonMossWallTemp", path: ["nonMoss", "wallTemp"], unit: "degC" },
];

const CHARTS = [
  { canvasId: "mossOutdoorTempChart", rowKey: "moss", valueKey: "outdoorTemp", label: "Outdoor Temperature", color: "#2d7a4b" },
  { canvasId: "mossOutdoorHumidityChart", rowKey: "moss", valueKey: "outdoorHumidity", label: "Outdoor Humidity", color: "#3a9d5e" },
  { canvasId: "mossSurfaceChart", rowKey: "moss", valueKey: "mossSurfaceTemp", label: "Surface Temperature", color: "#4e8d5f" },
  { canvasId: "mossAirTempChart", rowKey: "moss", valueKey: "nearMossTemp", label: "Near Moss Temperature", color: "#2f8f83" },
  { canvasId: "mossHumidityChart", rowKey: "moss", valueKey: "nearMossHumidity", label: "Near Moss Humidity", color: "#2a9382" },
  { canvasId: "mossWallTempChart", rowKey: "moss", valueKey: "wallTemp", label: "Wall Temperature", color: "#356f9e" },
  { canvasId: "nonMossSurfaceChart", rowKey: "nonMoss", valueKey: "nonMossSurfaceTemp", label: "Surface Temperature", color: "#d4732f" },
  { canvasId: "nonMossAirTempChart", rowKey: "nonMoss", valueKey: "nearNonMossTemp", label: "Near Non-Moss Temperature", color: "#bb5a26" },
  { canvasId: "nonMossHumidityChart", rowKey: "nonMoss", valueKey: "nearNonMossHumidity", label: "Near Non-Moss Humidity", color: "#a46f1a" },
  { canvasId: "nonMossWallTempChart", rowKey: "nonMoss", valueKey: "wallTemp", label: "Wall Temperature", color: "#9d4c7c" },
];

const chartInstances = new Map();
let chartInitAttempted = false;

function makeLineChart(canvasId, label, color) {
  const context = document.getElementById(canvasId);
  if (!context) {
    console.warn(`Missing chart canvas: ${canvasId}`);
    return null;
  }

  return new Chart(context, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label,
          data: [],
          borderColor: color,
          backgroundColor: `${color}22`,
          tension: 0.35,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
      },
    },
  });
}

function getNestedValue(source, path) {
  return path.reduce((current, key) => current?.[key], source);
}

function sortRowsByTimestamp(rows) {
  return [...rows].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

function setLatestMetric(id, value, unit) {
  const element = document.getElementById(id);
  if (!element) return;
  element.innerHTML = `${formatNumber(value, "", 2)} <small>${unit}</small>`;
}

function initDashboardCharts() {
  CHARTS.forEach((chartConfig) => {
    const chart = makeLineChart(chartConfig.canvasId, chartConfig.label, chartConfig.color);
    if (chart) {
      chartInstances.set(chartConfig.canvasId, chart);
    }
  });
}

function allChartCanvasesReady() {
  return CHARTS.every((chartConfig) => document.getElementById(chartConfig.canvasId));
}

async function bootstrapDashboardCharts() {
  if (chartInitAttempted) return;

  chartInitAttempted = true;

  const ready = allChartCanvasesReady();
  if (!ready) {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  initDashboardCharts();
}

async function loadLatest() {
  try {
    const latest = await apiGet("/api/data/latest");

    LATEST_METRICS.forEach((metric) => {
      setLatestMetric(metric.id, getNestedValue(latest, metric.path), metric.unit);
    });

    const timestamps = [latest?.moss?.timestamp, latest?.nonMoss?.timestamp].filter(Boolean).map((value) => new Date(value));
    const latestStamp = timestamps.length ? new Date(Math.max(...timestamps.map((value) => value.getTime()))) : null;
    document.getElementById("lastUpdated").textContent = `Last update: ${formatTimestamp(latestStamp)}`;
  } catch (error) {
    console.error(error);
    document.getElementById("lastUpdated").textContent = "Last update: request failed";
  }
}

function updateChart(chart, rows, valueKey) {
  if (!chart) return;

  const sortedRows = sortRowsByTimestamp(rows);
  const labels = sortedRows.map((row) => {
    const date = new Date(row.timestamp);
    return date.toLocaleTimeString("en-IN", { 
      timeZone: "Asia/Kolkata", 
      hour: "2-digit", 
      minute: "2-digit", 
      second: "2-digit",
      hour12: false 
    });
  });
  chart.data.labels = labels;
  chart.data.datasets[0].data = sortedRows.map((row) => row[valueKey]);
  chart.update();
}

async function loadRecentTrend() {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - HISTORY_DAYS);

    const params = `?start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`;
    const history = await apiGet(`/api/data/history${params}`);

    const moss = history.moss || [];
    const nonMoss = history.nonMoss || [];

    CHARTS.forEach((chartConfig) => {
      const chart = chartInstances.get(chartConfig.canvasId);
      const rows = chartConfig.rowKey === "moss" ? moss : nonMoss;
      updateChart(chart, rows, chartConfig.valueKey);
    });
  } catch (error) {
    console.error(error);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await bootstrapDashboardCharts();
  await loadLatest();
  await loadRecentTrend();

  setInterval(async () => {
    await loadLatest();
    await loadRecentTrend();
  }, 10000);
});
