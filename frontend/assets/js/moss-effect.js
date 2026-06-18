/* ─────────────────────────────────────────────────────────────────
   Moss Effect Analysis – moss-effect.js
   Compare cooling performance across different moss coverage
   percentages.  Each entry calls the existing /api/data/analysis
   endpoint for its date range + global humidity filter, then all
   results are charted side-by-side.
   ───────────────────────────────────────────────────────────────── */

// ── State ──────────────────────────────────────────────────────────

const meCharts = {};      // chart key → Chart instance
let entryCounter = 0;     // unique id for each entry row
let scenarioResults = []; // { pct, label, start, end, data }

// Color palette for scenarios (up to 10 distinct hues)
const SCENARIO_COLORS = [
  { bg: "rgba(114,210,143,0.7)", border: "#72d28f", bgSoft: "rgba(114,210,143,0.15)" },
  { bg: "rgba(90,200,224,0.7)",  border: "#5ac8e0", bgSoft: "rgba(90,200,224,0.15)" },
  { bg: "rgba(240,177,111,0.7)", border: "#f0b16f", bgSoft: "rgba(240,177,111,0.15)" },
  { bg: "rgba(167,139,250,0.7)", border: "#a78bfa", bgSoft: "rgba(167,139,250,0.15)" },
  { bg: "rgba(248,113,113,0.7)", border: "#f87171", bgSoft: "rgba(248,113,113,0.15)" },
  { bg: "rgba(251,191,36,0.7)",  border: "#fbbf24", bgSoft: "rgba(251,191,36,0.15)" },
  { bg: "rgba(52,211,153,0.7)",  border: "#34d399", bgSoft: "rgba(52,211,153,0.15)" },
  { bg: "rgba(244,114,182,0.7)", border: "#f472b6", bgSoft: "rgba(244,114,182,0.15)" },
  { bg: "rgba(129,140,248,0.7)", border: "#818cf8", bgSoft: "rgba(129,140,248,0.15)" },
  { bg: "rgba(45,212,191,0.7)",  border: "#2dd4bf", bgSoft: "rgba(45,212,191,0.15)" },
];

function getColor(idx) {
  return SCENARIO_COLORS[idx % SCENARIO_COLORS.length];
}

// ── Chart defaults (matches analysis.js) ──────────────────────────

function getChartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: "#ebf3ea", font: { family: "'IBM Plex Sans', sans-serif", size: 12 } },
      },
    },
    scales: {
      x: {
        ticks: { color: "#aebcae", font: { size: 11 } },
        grid: { color: "rgba(47,60,50,0.5)" },
      },
      y: {
        ticks: { color: "#aebcae", font: { size: 11 } },
        grid: { color: "rgba(47,60,50,0.5)" },
      },
    },
  };
}

// ── Utility ────────────────────────────────────────────────────────

function destroyChart(key) {
  if (meCharts[key]) { meCharts[key].destroy(); delete meCharts[key]; }
}

function showLoading(show) {
  const el = document.getElementById("meLoading");
  if (el) el.style.display = show ? "flex" : "none";
}

function setStatus(html) {
  const el = document.getElementById("meStatus");
  if (el) el.innerHTML = html;
}

// ── Entry management ──────────────────────────────────────────────

function addEntry(pct = "", start = "", end = "") {
  entryCounter++;
  const id = entryCounter;
  const list = document.getElementById("mossEntriesList");

  const row = document.createElement("div");
  row.className = "me-entry-row";
  row.dataset.entryId = id;
  row.innerHTML = `
    <label class="me-entry-label">
      Moss %
      <input type="number" class="me-input-pct" min="0" max="100" step="1" value="${pct}" placeholder="e.g. 25" />
    </label>
    <label class="me-entry-label">
      Start Date
      <input type="date" class="me-input-start" value="${start}" />
    </label>
    <label class="me-entry-label">
      End Date
      <input type="date" class="me-input-end" value="${end}" />
    </label>
    <button type="button" class="me-btn-remove" title="Remove entry">✕</button>
  `;

  row.querySelector(".me-btn-remove").addEventListener("click", () => row.remove());
  list.appendChild(row);

  // Entrance animation
  requestAnimationFrame(() => row.classList.add("me-entry-visible"));
}

function getEntries() {
  const rows = document.querySelectorAll(".me-entry-row");
  const entries = [];
  rows.forEach((row, idx) => {
    const pct = parseFloat(row.querySelector(".me-input-pct").value);
    const start = row.querySelector(".me-input-start").value;
    const end = row.querySelector(".me-input-end").value;
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    if (!start || !end) return;
    entries.push({ pct, start, end, idx });
  });
  return entries;
}

// ── API call per scenario ─────────────────────────────────────────

async function fetchScenario(entry, minHum, maxHum) {
  const params = new URLSearchParams();
  params.set("start", entry.start);
  params.set("end", entry.end);
  if (minHum !== "") params.set("minHumidity", minHum);
  if (maxHum !== "") params.set("maxHumidity", maxHum);

  const url = `${API_BASE_URL}/api/data/analysis?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── Generate flow ─────────────────────────────────────────────────

async function generate() {
  const entries = getEntries();
  if (entries.length === 0) {
    setStatus('<span style="color:#f87171;">⚠ Add at least one valid entry (percentage 0–100, both dates set).</span>');
    return;
  }

  const minHum = document.getElementById("meMinHumidity").value;
  const maxHum = document.getElementById("meMaxHumidity").value;

  showLoading(true);
  setStatus("");
  document.getElementById("meResults").style.display = "none";

  try {
    const promises = entries.map(e => fetchScenario(e, minHum, maxHum));
    const results = await Promise.all(promises);

    scenarioResults = entries.map((e, i) => ({
      pct: e.pct,
      label: `${e.pct}%`,
      start: e.start,
      end: e.end,
      data: results[i],
    }));

    // Sort by percentage for clean chart ordering
    scenarioResults.sort((a, b) => a.pct - b.pct);

    renderAll();
    document.getElementById("meResults").style.display = "";

    const parts = [`${scenarioResults.length} scenario(s)`];
    if (minHum) parts.push(`Min humidity: ${minHum}%`);
    if (maxHum) parts.push(`Max humidity: ${maxHum}%`);
    setStatus(`<span class="filter-active">🟢 ${parts.join(" · ")}</span>`);
  } catch (err) {
    console.error("Moss-effect generation failed:", err);
    setStatus(`<span style="color:#f87171;">⚠ Error: ${err.message}</span>`);
  } finally {
    showLoading(false);
  }
}

// ── Chart renders ─────────────────────────────────────────────────

function renderAll() {
  renderTempChart();
  renderCoolingChart();
  renderAdvantageChart();
  renderHumidityChart();
  renderDiurnalChart();
  renderSummaryTable();
}

/* 1 – Temperature Comparison (grouped bar) */
function renderTempChart() {
  destroyChart("meTemp");
  const ctx = document.getElementById("meTempChart").getContext("2d");
  const defaults = getChartDefaults();
  const labels = scenarioResults.map(s => s.label);

  // Extract mean values from descriptive stats
  function getMean(data, sensorIncludes) {
    const stat = data.descriptiveStats.find(s => s.sensor.includes(sensorIncludes));
    return stat?.mean ?? null;
  }

  meCharts.meTemp = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Moss Wall Temp (°C)",
          data: scenarioResults.map(s => getMean(s.data, "Moss Wall") ?? null),
          backgroundColor: "rgba(114,210,143,0.75)",
          borderColor: "#72d28f",
          borderWidth: 1,
          borderRadius: 8,
        },
        {
          label: "Non-Moss Wall Temp (°C)",
          data: scenarioResults.map(s => getMean(s.data, "Non-Moss Wall") ?? null),
          backgroundColor: "rgba(240,177,111,0.75)",
          borderColor: "#f0b16f",
          borderWidth: 1,
          borderRadius: 8,
        },
        {
          label: "Outdoor Temp (°C)",
          data: scenarioResults.map(s => getMean(s.data, "Outdoor Temp") ?? null),
          backgroundColor: "rgba(90,200,224,0.55)",
          borderColor: "#5ac8e0",
          borderWidth: 1,
          borderRadius: 8,
        },
      ],
    },
    options: {
      ...defaults,
      plugins: {
        ...defaults.plugins,
        title: { display: true, text: "Average Temperatures by Moss Coverage", color: "#ebf3ea", font: { size: 14 } },
      },
      scales: {
        ...defaults.scales,
        x: { ...defaults.scales.x, title: { display: true, text: "Moss Coverage (%)", color: "#aebcae" } },
        y: { ...defaults.scales.y, title: { display: true, text: "Temperature (°C)", color: "#aebcae" } },
      },
    },
  });
}

/* 2 – Cooling Effect Comparison */
function renderCoolingChart() {
  destroyChart("meCooling");
  const ctx = document.getElementById("meCoolingChart").getContext("2d");
  const defaults = getChartDefaults();
  const labels = scenarioResults.map(s => s.label);

  meCharts.meCooling = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Moss Cooling (°C)",
          data: scenarioResults.map(s => s.data.cooling.mossCooling),
          backgroundColor: "rgba(114,210,143,0.75)",
          borderColor: "#72d28f",
          borderWidth: 1,
          borderRadius: 8,
        },
        {
          label: "Non-Moss Cooling (°C)",
          data: scenarioResults.map(s => s.data.cooling.nonMossCooling),
          backgroundColor: "rgba(240,177,111,0.75)",
          borderColor: "#f0b16f",
          borderWidth: 1,
          borderRadius: 8,
        },
      ],
    },
    options: {
      ...defaults,
      plugins: {
        ...defaults.plugins,
        title: { display: true, text: "Cooling Effect (Outdoor - Wall) by Moss Coverage", color: "#ebf3ea", font: { size: 14 } },
      },
      scales: {
        ...defaults.scales,
        x: { ...defaults.scales.x, title: { display: true, text: "Moss Coverage (%)", color: "#aebcae" } },
        y: { ...defaults.scales.y, title: { display: true, text: "Cooling Effect (°C)", color: "#aebcae" } },
      },
    },
  });
}

/* 3 – Moss Advantage vs Coverage (line + scatter) */
function renderAdvantageChart() {
  destroyChart("meAdvantage");
  const ctx = document.getElementById("meAdvantageChart").getContext("2d");
  const defaults = getChartDefaults();

  const points = scenarioResults.map((s, i) => ({
    x: s.pct,
    y: s.data.cooling.mossAdvantage,
  }));

  meCharts.meAdvantage = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Moss Advantage (°C)",
          data: points,
          backgroundColor: scenarioResults.map((_, i) => getColor(i).bg),
          borderColor: scenarioResults.map((_, i) => getColor(i).border),
          pointRadius: 8,
          pointHoverRadius: 12,
          borderWidth: 2,
        },
        {
          label: "Trend",
          data: points,
          type: "line",
          borderColor: "rgba(114,210,143,0.5)",
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: {
      ...defaults,
      plugins: {
        ...defaults.plugins,
        title: { display: true, text: "Moss Cooling Advantage vs Coverage %", color: "#ebf3ea", font: { size: 14 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed;
              return `${v.x}% moss → ${v.y != null ? v.y.toFixed(2) : "--"}°C advantage`;
            },
          },
        },
      },
      scales: {
        x: {
          ...defaults.scales.x,
          type: "linear",
          title: { display: true, text: "Moss Coverage (%)", color: "#aebcae" },
          min: 0,
          max: Math.max(100, ...scenarioResults.map(s => s.pct)) + 5,
        },
        y: {
          ...defaults.scales.y,
          title: { display: true, text: "Advantage (°C)", color: "#aebcae" },
        },
      },
    },
  });
}

/* 4 – Humidity Buffering */
function renderHumidityChart() {
  destroyChart("meHumidity");
  const ctx = document.getElementById("meHumidityChart").getContext("2d");
  const defaults = getChartDefaults();
  const labels = scenarioResults.map(s => s.label);

  function getStdDev(data, locIncludes) {
    const row = data.humidityBuffering.find(h => h.location.includes(locIncludes));
    return row?.stdDev ?? null;
  }

  meCharts.meHumidity = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Outdoor Humidity Std Dev",
          data: scenarioResults.map(s => getStdDev(s.data, "Outdoor")),
          backgroundColor: "rgba(90,200,224,0.65)",
          borderColor: "#5ac8e0",
          borderWidth: 1,
          borderRadius: 8,
        },
        {
          label: "Near Moss Std Dev",
          data: scenarioResults.map(s => getStdDev(s.data, "Moss")),
          backgroundColor: "rgba(114,210,143,0.65)",
          borderColor: "#72d28f",
          borderWidth: 1,
          borderRadius: 8,
        },
        {
          label: "Near Non-Moss Std Dev",
          data: scenarioResults.map(s => getStdDev(s.data, "Non-Moss")),
          backgroundColor: "rgba(240,177,111,0.65)",
          borderColor: "#f0b16f",
          borderWidth: 1,
          borderRadius: 8,
        },
      ],
    },
    options: {
      ...defaults,
      plugins: {
        ...defaults.plugins,
        title: { display: true, text: "Humidity Variability by Moss Coverage (lower = more stable)", color: "#ebf3ea", font: { size: 14 } },
      },
      scales: {
        ...defaults.scales,
        x: { ...defaults.scales.x, title: { display: true, text: "Moss Coverage (%)", color: "#aebcae" } },
        y: { ...defaults.scales.y, title: { display: true, text: "Std Dev of Humidity (%)", color: "#aebcae" }, beginAtZero: true },
      },
    },
  });
}

/* 5 – Diurnal Patterns */
function renderDiurnalChart() {
  destroyChart("meDiurnal");
  const ctx = document.getElementById("meDiurnalChart").getContext("2d");
  const defaults = getChartDefaults();

  // Labels: for each scenario, show Daytime and Night-time
  const labels = [];
  const mossDayData = [];
  const mossNightData = [];
  const nonMossDayData = [];
  const nonMossNightData = [];

  scenarioResults.forEach(s => {
    labels.push(s.label);
    const day = s.data.diurnal.find(d => d.period.includes("Daytime"));
    const night = s.data.diurnal.find(d => d.period.includes("Night"));
    mossDayData.push(day?.mossWall ?? null);
    mossNightData.push(night?.mossWall ?? null);
    nonMossDayData.push(day?.nonMossWall ?? null);
    nonMossNightData.push(night?.nonMossWall ?? null);
  });

  meCharts.meDiurnal = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Moss Day",
          data: mossDayData,
          backgroundColor: "rgba(114,210,143,0.8)",
          borderColor: "#72d28f",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: "Moss Night",
          data: mossNightData,
          backgroundColor: "rgba(114,210,143,0.4)",
          borderColor: "#72d28f",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: "Non-Moss Day",
          data: nonMossDayData,
          backgroundColor: "rgba(240,177,111,0.8)",
          borderColor: "#f0b16f",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: "Non-Moss Night",
          data: nonMossNightData,
          backgroundColor: "rgba(240,177,111,0.4)",
          borderColor: "#f0b16f",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      ...defaults,
      plugins: {
        ...defaults.plugins,
        title: { display: true, text: "Diurnal Temperature Patterns by Moss Coverage", color: "#ebf3ea", font: { size: 14 } },
      },
      scales: {
        ...defaults.scales,
        x: { ...defaults.scales.x, title: { display: true, text: "Moss Coverage (%)", color: "#aebcae" } },
        y: { ...defaults.scales.y, title: { display: true, text: "Wall Temperature (°C)", color: "#aebcae" } },
      },
    },
  });
}

/* 6 – Summary Table */
function renderSummaryTable() {
  const tbody = document.getElementById("meSummaryBody");

  function getMean(data, sensorIncludes) {
    const stat = data.descriptiveStats.find(s => s.sensor.includes(sensorIncludes));
    return stat?.mean ?? null;
  }

  function fmt(v) { return v != null ? v.toFixed(2) : "--"; }

  tbody.innerHTML = scenarioResults.map((s, i) => {
    const c = getColor(i);
    const mossWall = getMean(s.data, "Moss Wall");
    const nonMossWall = getMean(s.data, "Non-Moss Wall");
    const outdoor = getMean(s.data, "Outdoor Temp");
    const cooling = s.data.cooling;
    const dataPoints = s.data.timeSeries.length;

    return `
      <tr>
        <td><span class="me-pct-dot" style="--dot-color:${c.border};"></span>${s.pct}%</td>
        <td>${s.start} → ${s.end}</td>
        <td>${fmt(mossWall)}</td>
        <td>${fmt(nonMossWall)}</td>
        <td>${fmt(outdoor)}</td>
        <td style="color:#72d28f; font-weight:600;">${fmt(cooling.mossCooling)}</td>
        <td style="color:#f0b16f; font-weight:600;">${fmt(cooling.nonMossCooling)}</td>
        <td><span class="diff-badge">${fmt(cooling.mossAdvantage)}</span></td>
        <td>${dataPoints} hrs</td>
      </tr>`;
  }).join("");
}

// ── Chart download ─────────────────────────────────────────────────

function downloadChartPng(chartKey, filename) {
  const chart = meCharts[chartKey];
  if (!chart) return;

  const canvas = chart.canvas;
  const tempCanvas = document.createElement("canvas");
  const scale = 4;
  tempCanvas.width = canvas.width * scale;
  tempCanvas.height = canvas.height * scale;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.scale(scale, scale);
  tempCtx.fillStyle = "#1b241d";
  tempCtx.fillRect(0, 0, canvas.width, canvas.height);
  tempCtx.drawImage(canvas, 0, 0);

  const link = document.createElement("a");
  link.download = `${filename}.png`;
  link.href = tempCanvas.toDataURL("image/png", 1.0);
  link.click();
}

function downloadAllCharts() {
  const chartMap = {
    meTempChart: "meTemp",
    meCoolingChart: "meCooling",
    meAdvantageChart: "meAdvantage",
    meHumidityChart: "meHumidity",
    meDiurnalChart: "meDiurnal",
  };

  for (const [canvasId, chartKey] of Object.entries(chartMap)) {
    const btn = document.querySelector(`.me-dl-btn[data-chart="${canvasId}"]`);
    const name = btn?.dataset.name || canvasId;
    downloadChartPng(chartKey, name);
  }
}

// ── Map canvas id → chart key for download buttons ────────────────

const CANVAS_TO_KEY = {
  meTempChart: "meTemp",
  meCoolingChart: "meCooling",
  meAdvantageChart: "meAdvantage",
  meHumidityChart: "meHumidity",
  meDiurnalChart: "meDiurnal",
};

// ── Event listeners ────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Add two default empty entries
  addEntry();
  addEntry();

  document.getElementById("addEntryBtn").addEventListener("click", () => addEntry());
  document.getElementById("generateBtn").addEventListener("click", generate);
  document.getElementById("meExportAllBtn").addEventListener("click", () => {
    if (Object.keys(meCharts).length === 0) {
      alert("Please generate charts first.");
      return;
    }
    downloadAllCharts();
  });

  // Individual chart download buttons
  document.querySelectorAll(".me-dl-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const canvasId = btn.dataset.chart;
      const chartKey = CANVAS_TO_KEY[canvasId];
      const name = btn.dataset.name || canvasId;
      if (!chartKey || !meCharts[chartKey]) {
        alert("Please generate charts first.");
        return;
      }
      downloadChartPng(chartKey, name);
    });
  });
});
