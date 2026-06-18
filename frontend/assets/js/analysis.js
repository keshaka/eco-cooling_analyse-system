/* ────────────────────────────────────────────────
   Analysis Report – analysis.js
   Fetches hourly-averaged data from the backend
   /api/data/analysis endpoint with date-range and
   humidity-range filters.
   ──────────────────────────────────────────────── */

// Charts registry for cleanup
const charts = {};

// Cached API response
let analysisData = null;

// ── Static reference data from the PDF report ────────────────────

const T_TESTS = [
  { comparison: "Wall Temp (°C)",         mossMean: null, nonMossMean: null, tStat: -11.351, pValue: "0.00e+00", sig: "p<0.001" },
  { comparison: "Surface Temp (°C)",      mossMean: null, nonMossMean: null, tStat: -19.494, pValue: "0.00e+00", sig: "p<0.001" },
  { comparison: "Near-Wall Humidity (%)", mossMean: null, nonMossMean: null, tStat: 4.996,   pValue: "6.00e-07", sig: "p<0.001" },
];

const KEY_FINDINGS_TEMPLATE = [
  { icon: "🌡", title: "Temperature Reduction", color: "#72d28f",
    getValue: (d) => {
      const moss = d.descriptiveStats.find(s => s.sensor.includes("Moss Wall"));
      const nonMoss = d.descriptiveStats.find(s => s.sensor.includes("Non-Moss Wall"));
      if (moss?.mean != null && nonMoss?.mean != null) {
        const diff = Math.abs(nonMoss.mean - moss.mean).toFixed(1);
        return { value: `${diff}°C`, detail: `${moss.mean.toFixed(1)}°C (moss) vs ${nonMoss.mean.toFixed(1)}°C (non-moss)` };
      }
      return { value: "--", detail: "No data available" };
    }
  },
  { icon: "❄️", title: "Cooling Effect", color: "#5ac8e0",
    getValue: (d) => {
      if (d.cooling.mossAdvantage != null) {
        return { value: `${d.cooling.mossAdvantage.toFixed(2)}°C`, detail: `Moss: ${d.cooling.mossCooling?.toFixed(2) ?? "--"}°C vs Non-Moss: ${d.cooling.nonMossCooling?.toFixed(2) ?? "--"}°C cooling` };
      }
      return { value: "--", detail: "No data available" };
    }
  },
  { icon: "🧱", title: "Surface Temp Diff", color: "#f0b16f",
    getValue: (d) => {
      const moss = d.descriptiveStats.find(s => s.sensor.includes("Moss Surface"));
      const nonMoss = d.descriptiveStats.find(s => s.sensor.includes("Non-Moss Surface"));
      if (moss?.mean != null && nonMoss?.mean != null) {
        const diff = Math.abs(nonMoss.mean - moss.mean).toFixed(2);
        return { value: `${diff}°C`, detail: `Moss ${moss.mean.toFixed(2)}°C vs Non-Moss ${nonMoss.mean.toFixed(2)}°C` };
      }
      return { value: "--", detail: "No data available" };
    }
  },
  { icon: "💧", title: "Humidity Buffering", color: "#a78bfa",
    getValue: (d) => {
      const moss = d.humidityBuffering.find(h => h.location.includes("Moss"));
      const nonMoss = d.humidityBuffering.find(h => h.location.includes("Non-Moss"));
      if (moss?.stdDev != null && nonMoss?.stdDev != null) {
        return { value: `Std ${moss.stdDev.toFixed(2)} vs ${nonMoss.stdDev.toFixed(2)}`, detail: "Lower std dev = more stable microclimate" };
      }
      return { value: "--", detail: "No data available" };
    }
  },
  { icon: "☀️", title: "Diurnal Pattern", color: "#fbbf24",
    getValue: (d) => {
      const day = d.diurnal.find(r => r.period.includes("Daytime"));
      if (day?.diff != null) {
        return { value: `${day.diff.toFixed(2)}°C gap`, detail: `Daytime: moss ${day.mossWall?.toFixed(2) ?? "--"}°C vs non-moss ${day.nonMossWall?.toFixed(2) ?? "--"}°C` };
      }
      return { value: "--", detail: "No data available" };
    }
  },
  { icon: "📊", title: "Data Points", color: "#f87171",
    getValue: (d) => {
      const count = d.timeSeries.length;
      return { value: `${count} hours`, detail: "Hourly-averaged data points returned by the current filter" };
    }
  },
];

// ── Utility functions ────────────────────────────────────────────

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    delete charts[key];
  }
}

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

function showLoading(show) {
  const el = document.getElementById("loadingIndicator");
  if (el) el.style.display = show ? "flex" : "none";
}

function formatTs(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  return `${month}/${day} ${hour}:00`;
}

// ── API call ─────────────────────────────────────────────────────

async function fetchAnalysis() {
  const startDate = document.getElementById("analysisStartDate").value || "";
  const endDate   = document.getElementById("analysisEndDate").value || "";
  const minHum    = document.getElementById("minHumidity").value || "";
  const maxHum    = document.getElementById("maxHumidity").value || "";

  const params = new URLSearchParams();
  if (startDate) params.set("start", startDate);
  if (endDate)   params.set("end", endDate);
  if (minHum)    params.set("minHumidity", minHum);
  if (maxHum)    params.set("maxHumidity", maxHum);

  const qs = params.toString();
  const url = `${API_BASE_URL}/api/data/analysis${qs ? "?" + qs : ""}`;

  showLoading(true);
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${resp.status}`);
    }
    analysisData = await resp.json();
    renderAll();
    renderFilterStatus();
  } catch (err) {
    console.error("Analysis fetch failed:", err);
    document.getElementById("filterStatus").innerHTML =
      `<span style="color:#f87171;">⚠ Error loading data: ${err.message}</span>`;
  } finally {
    showLoading(false);
  }
}

// ── Chart download ──────────────────────────────────────────────

const ANALYSIS_CANVAS_TO_KEY = {
  timeSeriesTempChart: "timeSeriesTemp",
  timeSeriesHumidityChart: "timeSeriesHumidity",
  boxplotWallTemp: "boxplotWall",
  boxplotSurfaceTemp: "boxplotSurface",
  boxplotHumidity: "boxplotHumidity",
  coolingHistogramChart: "coolingHistogram",
  coolingAdvantageChart: "coolingAdvantage",
  diurnalChart: "diurnal",
  hourlyChart: "hourly",
  humidityScatterChart: "humidityScatter",
  humidityBufferChart: "humidityBuffer",
  correlationChart: "correlation",
};

function downloadChartPng(chartKey, filename) {
  const chart = charts[chartKey];
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
  for (const [canvasId, chartKey] of Object.entries(ANALYSIS_CANVAS_TO_KEY)) {
    if (!charts[chartKey]) continue;
    const btn = document.querySelector(`.analysis-dl-btn[data-chart="${canvasId}"]`);
    const name = btn?.dataset.name || canvasId;
    downloadChartPng(chartKey, name);
  }
}

// ── Render functions ─────────────────────────────────────────────

function renderFilterStatus() {
  const el = document.getElementById("filterStatus");
  const parts = [];
  const s = document.getElementById("analysisStartDate").value;
  const e = document.getElementById("analysisEndDate").value;
  const minH = document.getElementById("minHumidity").value;
  const maxH = document.getElementById("maxHumidity").value;

  if (s) parts.push(`From: ${s}`);
  if (e) parts.push(`To: ${e}`);
  if (minH) parts.push(`Min Humidity: ${minH}%`);
  if (maxH) parts.push(`Max Humidity: ${maxH}%`);

  if (!analysisData) {
    el.innerHTML = '<span class="filter-inactive">Loading data...</span>';
    return;
  }

  const count = analysisData.timeSeries.length;
  const countInfo = ` · ${count} hourly data points`;

  if (parts.length === 0) {
    el.innerHTML = `<span class="filter-inactive">No filters applied — showing all data${countInfo}</span>`;
  } else {
    el.innerHTML = `<span class="filter-active">🟢 Active filters: ${parts.join(" · ")}${countInfo}</span>`;
  }
}

function renderDescriptiveTable() {
  const body = document.getElementById("descriptiveBody");
  if (!analysisData) { body.innerHTML = ""; return; }

  body.innerHTML = analysisData.descriptiveStats.map(row => `
    <tr>
      <td>${row.sensor}</td>
      <td>${row.mean != null ? row.mean.toFixed(2) : "--"}</td>
      <td>${row.std != null ? row.std.toFixed(2) : "--"}</td>
      <td>${row.min != null ? row.min.toFixed(2) : "--"}</td>
      <td>${row.max != null ? row.max.toFixed(2) : "--"}</td>
    </tr>`).join("");
}

function renderTTestTable() {
  const body = document.getElementById("tTestBody");
  if (!analysisData) { body.innerHTML = ""; return; }

  // Populate t-test table with live means from descriptive stats
  const stats = analysisData.descriptiveStats;
  const mossWall = stats.find(s => s.sensor.includes("Moss Wall") && !s.sensor.includes("Non"));
  const nonMossWall = stats.find(s => s.sensor.includes("Non-Moss Wall"));
  const mossSurface = stats.find(s => s.sensor.includes("Moss Surface"));
  const nonMossSurface = stats.find(s => s.sensor.includes("Non-Moss Surface"));
  const nearMossHum = stats.find(s => s.sensor.includes("Near-Moss Humidity"));
  const nearNonMossHum = stats.find(s => s.sensor.includes("Near Non-Moss Humidity"));

  const rows = [
    { comparison: "Wall Temp (°C)", mossMean: mossWall?.mean, nonMossMean: nonMossWall?.mean, tStat: T_TESTS[0].tStat, pValue: T_TESTS[0].pValue, sig: T_TESTS[0].sig },
    { comparison: "Surface Temp (°C)", mossMean: mossSurface?.mean, nonMossMean: nonMossSurface?.mean, tStat: T_TESTS[1].tStat, pValue: T_TESTS[1].pValue, sig: T_TESTS[1].sig },
    { comparison: "Near-Wall Humidity (%)", mossMean: nearMossHum?.mean, nonMossMean: nearNonMossHum?.mean, tStat: T_TESTS[2].tStat, pValue: T_TESTS[2].pValue, sig: T_TESTS[2].sig },
  ];

  body.innerHTML = rows.map(row => `
    <tr>
      <td>${row.comparison}</td>
      <td>${row.mossMean != null ? row.mossMean.toFixed(2) : "--"}</td>
      <td>${row.nonMossMean != null ? row.nonMossMean.toFixed(2) : "--"}</td>
      <td>${row.tStat.toFixed(3)}</td>
      <td>${row.pValue}</td>
      <td><span class="sig-badge">${row.sig}</span></td>
    </tr>`).join("");
}

function renderTTestChart() {
  destroyChart("boxplotWall");
  destroyChart("boxplotSurface");
  destroyChart("boxplotHumidity");
  if (!analysisData) return;

  const ts = analysisData.timeSeries;
  const defaults = getChartDefaults();

  // Extract raw value arrays from time series
  const mossWallArr = ts.map(r => r.mossWallTemp).filter(v => v != null);
  const nonMossWallArr = ts.map(r => r.nonMossWallTemp).filter(v => v != null);
  const mossSurfaceArr = ts.map(r => r.mossSurfaceTemp).filter(v => v != null);
  const nonMossSurfaceArr = ts.map(r => r.nonMossSurfaceTemp).filter(v => v != null);
  const mossHumArr = ts.map(r => r.nearMossHumidity).filter(v => v != null);
  const nonMossHumArr = ts.map(r => r.nearNonMossHumidity).filter(v => v != null);

  // p-value labels from t-test constants
  const pLabels = T_TESTS.map(t => {
    const pNum = parseFloat(t.pValue);
    const pStr = pNum === 0 ? "0.0000" : pNum.toFixed(4);
    return `p=${pStr} ***`;
  });

  function createBoxPlot(canvasId, chartKey, title, subtitle, mossData, nonMossData, yLabel) {
    const ctx = document.getElementById(canvasId).getContext("2d");

    charts[chartKey] = new Chart(ctx, {
      type: "boxplot",
      data: {
        labels: ["Moss", "Non-Moss"],
        datasets: [{
          label: yLabel,
          data: [mossData, nonMossData],
          backgroundColor: ["rgba(56,118,71,0.8)", "rgba(205,154,91,0.8)"],
          borderColor: ["#2d6b3f", "#b8863a"],
          borderWidth: 1.5,
          outlierBackgroundColor: "#1a1a2e",
          outlierBorderColor: "#555",
          outlierRadius: 3,
          medianColor: "#fff",
          itemRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: [title, subtitle],
            color: "#ebf3ea",
            font: { size: 13, family: "'IBM Plex Sans', sans-serif" },
            padding: { bottom: 12 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const stats = ctx.parsed;
                if (!stats) return "";
                return [
                  `Max: ${stats.max?.toFixed(2)}`,
                  `Q3: ${stats.q3?.toFixed(2)}`,
                  `Median: ${stats.median?.toFixed(2)}`,
                  `Q1: ${stats.q1?.toFixed(2)}`,
                  `Min: ${stats.min?.toFixed(2)}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#aebcae", font: { size: 12 } },
            grid: { color: "rgba(47,60,50,0.5)" },
          },
          y: {
            ticks: { color: "#aebcae", font: { size: 11 } },
            grid: { color: "rgba(47,60,50,0.5)" },
            title: { display: true, text: yLabel, color: "#aebcae" },
          },
        },
      },
    });
  }

  createBoxPlot("boxplotWallTemp", "boxplotWall", "Wall Temp", pLabels[0], mossWallArr, nonMossWallArr, "Wall Temp (°C)");
  createBoxPlot("boxplotSurfaceTemp", "boxplotSurface", "Surface Temp", pLabels[1], mossSurfaceArr, nonMossSurfaceArr, "Surface Temp (°C)");
  createBoxPlot("boxplotHumidity", "boxplotHumidity", "Humidity", pLabels[2], mossHumArr, nonMossHumArr, "Humidity (%)");
}

function renderCoolingCards() {
  const container = document.getElementById("coolingCards");
  if (!analysisData) { container.innerHTML = ""; return; }
  const c = analysisData.cooling;

  container.innerHTML = `
    <div class="cooling-card">
      <div class="cooling-label">Moss Cooling vs Outdoor</div>
      <div class="cooling-value" style="color:#72d28f;">${c.mossCooling != null ? c.mossCooling.toFixed(2) : "--"}°C</div>
    </div>
    <div class="cooling-card">
      <div class="cooling-label">Non-Moss Cooling vs Outdoor</div>
      <div class="cooling-value" style="color:#f0b16f;">${c.nonMossCooling != null ? c.nonMossCooling.toFixed(2) : "--"}°C</div>
    </div>
    <div class="cooling-card">
      <div class="cooling-label">Moss Advantage over Non-Moss</div>
      <div class="cooling-value" style="color:#5ac8e0;">${c.mossAdvantage != null ? c.mossAdvantage.toFixed(2) : "--"}°C</div>
    </div>
  `;
}

function renderCoolingHistogram() {
  destroyChart("coolingHistogram");
  if (!analysisData) return;
  const ctx = document.getElementById("coolingHistogramChart").getContext("2d");
  const defaults = getChartDefaults();

  // Build histogram from time series data
  const mossCooling = [];
  const nonMossCooling = [];

  for (const row of analysisData.timeSeries) {
    if (row.outdoorTemp != null && row.mossWallTemp != null) {
      mossCooling.push(row.outdoorTemp - row.mossWallTemp);
    }
    if (row.outdoorTemp != null && row.nonMossWallTemp != null) {
      nonMossCooling.push(row.outdoorTemp - row.nonMossWallTemp);
    }
  }

  // Compute means for legend labels
  const mossMean = mossCooling.length ? (mossCooling.reduce((a, b) => a + b, 0) / mossCooling.length).toFixed(2) : "--";
  const nonMossMean = nonMossCooling.length ? (nonMossCooling.reduce((a, b) => a + b, 0) / nonMossCooling.length).toFixed(2) : "--";

  function buildHistogram(values, binCount = 15) {
    if (values.length === 0) return { labels: [], counts: [] };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const binSize = range / binCount;
    const counts = new Array(binCount).fill(0);
    const labels = [];

    for (let i = 0; i < binCount; i++) {
      labels.push((min + binSize * i).toFixed(1));
    }

    for (const v of values) {
      let idx = Math.floor((v - min) / binSize);
      if (idx >= binCount) idx = binCount - 1;
      counts[idx]++;
    }

    return { labels, counts };
  }

  const mossHist = buildHistogram(mossCooling);
  const nonMossHist = buildHistogram(nonMossCooling);

  charts.coolingHistogram = new Chart(ctx, {
    type: "bar",
    data: {
      labels: mossHist.labels,
      datasets: [
        { label: `Moss (\u03BC=${mossMean}\u00B0C)`, data: mossHist.counts, backgroundColor: "rgba(114,210,143,0.6)", borderColor: "#72d28f", borderWidth: 1, borderRadius: 4 },
        { label: `Non-Moss (\u03BC=${nonMossMean}\u00B0C)`, data: nonMossHist.counts, backgroundColor: "rgba(240,177,111,0.6)", borderColor: "#f0b16f", borderWidth: 1, borderRadius: 4 },
      ],
    },
    options: {
      ...defaults,
      plugins: {
        ...defaults.plugins,
        title: { display: true, text: "Distribution of Cooling Effect", color: "#ebf3ea", font: { size: 13 } },
      },
      scales: {
        ...defaults.scales,
        x: { ...defaults.scales.x, title: { display: true, text: "Cooling (°C)", color: "#aebcae" } },
        y: { ...defaults.scales.y, title: { display: true, text: "Frequency", color: "#aebcae" } },
      },
    },
  });
}

function renderCoolingAdvantageChart() {
  destroyChart("coolingAdvantage");
  if (!analysisData) return;
  const ctx = document.getElementById("coolingAdvantageChart").getContext("2d");
  const defaults = getChartDefaults();
  const ts = analysisData.timeSeries;

  // Compute moss cooling advantage over time: (outdoor - moss) - (outdoor - nonMoss) = nonMoss - moss
  const labels = [];
  const advantageData = [];

  for (const row of ts) {
    labels.push(formatTs(row.timestamp));
    if (row.mossWallTemp != null && row.nonMossWallTemp != null && row.outdoorTemp != null) {
      const mossCool = row.outdoorTemp - row.mossWallTemp;
      const nonMossCool = row.outdoorTemp - row.nonMossWallTemp;
      advantageData.push(mossCool - nonMossCool);
    } else {
      advantageData.push(null);
    }
  }

  // Build separate datasets for positive (moss cooler) and negative (non-moss cooler) fills
  const mossColerData = advantageData.map(v => (v != null && v >= 0) ? v : 0);
  const nonMossCoolerData = advantageData.map(v => (v != null && v < 0) ? v : 0);

  charts.coolingAdvantage = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Temp Advantage (°C)",
          data: advantageData,
          borderColor: "rgba(90,200,224,0.9)",
          borderWidth: 1.5,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
        },
        {
          label: "Moss cooler",
          data: mossColerData,
          borderColor: "transparent",
          backgroundColor: "rgba(114,210,143,0.3)",
          borderWidth: 0,
          tension: 0.3,
          pointRadius: 0,
          fill: "origin",
        },
        {
          label: "Non-moss cooler",
          data: nonMossCoolerData,
          borderColor: "transparent",
          backgroundColor: "rgba(240,177,111,0.3)",
          borderWidth: 0,
          tension: 0.3,
          pointRadius: 0,
          fill: "origin",
        },
        {
          label: "No difference",
          data: advantageData.map(() => 0),
          borderColor: "rgba(248,113,113,0.6)",
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      ...defaults,
      plugins: {
        ...defaults.plugins,
        title: { display: true, text: "Moss Cooling Advantage Over Time", color: "#ebf3ea", font: { size: 13 } },
        legend: {
          labels: {
            ...defaults.plugins.legend.labels,
            filter: (item) => item.text !== "Temp Advantage (°C)",
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              if (context.datasetIndex !== 0) return null;
              const v = context.parsed.y;
              if (v == null) return "No data";
              const who = v >= 0 ? "Moss cooler" : "Non-moss cooler";
              return `${who}: ${Math.abs(v).toFixed(2)}°C`;
            },
          },
        },
      },
      scales: {
        ...defaults.scales,
        x: { ...defaults.scales.x, ticks: { ...defaults.scales.x.ticks, maxTicksLimit: 14 } },
        y: { ...defaults.scales.y, title: { display: true, text: "Temp Advantage (°C)", color: "#aebcae" } },
      },
    },
  });
}

function renderDiurnalTable() {
  const body = document.getElementById("diurnalBody");
  if (!analysisData) { body.innerHTML = ""; return; }

  body.innerHTML = analysisData.diurnal.map(row => `
    <tr>
      <td>${row.period}</td>
      <td>${row.mossWall != null ? row.mossWall.toFixed(2) : "--"}</td>
      <td>${row.nonMossWall != null ? row.nonMossWall.toFixed(2) : "--"}</td>
      <td><span class="diff-badge">${row.diff != null ? row.diff.toFixed(2) : "--"}</span></td>
    </tr>`).join("");
}

function renderDiurnalChart() {
  destroyChart("diurnal");
  if (!analysisData) return;
  const ctx = document.getElementById("diurnalChart").getContext("2d");
  const defaults = getChartDefaults();

  charts.diurnal = new Chart(ctx, {
    type: "bar",
    data: {
      labels: analysisData.diurnal.map(d => d.period),
      datasets: [
        { label: "Moss Wall Temp (°C)", data: analysisData.diurnal.map(d => d.mossWall), backgroundColor: "rgba(114,210,143,0.7)", borderColor: "#72d28f", borderWidth: 1, borderRadius: 8 },
        { label: "Non-Moss Wall Temp (°C)", data: analysisData.diurnal.map(d => d.nonMossWall), backgroundColor: "rgba(240,177,111,0.7)", borderColor: "#f0b16f", borderWidth: 1, borderRadius: 8 },
      ],
    },
    options: defaults,
  });
}

function renderHourlyChart() {
  destroyChart("hourly");
  if (!analysisData) return;
  const ctx = document.getElementById("hourlyChart").getContext("2d");
  const defaults = getChartDefaults();
  const hp = analysisData.hourlyPattern;

  charts.hourly = new Chart(ctx, {
    type: "line",
    data: {
      labels: hp.map(h => `${String(h.hour).padStart(2, "0")}:00`),
      datasets: [
        { label: "Moss Wall Temp", data: hp.map(h => h.mossWall), borderColor: "#72d28f", backgroundColor: "rgba(114,210,143,0.1)", fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 },
        { label: "Non-Moss Wall Temp", data: hp.map(h => h.nonMossWall), borderColor: "#f0b16f", backgroundColor: "rgba(240,177,111,0.1)", fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 },
        { label: "Outdoor Temp", data: hp.map(h => h.outdoor), borderColor: "#5ac8e0", borderDash: [5, 3], tension: 0.4, pointRadius: 1, pointHoverRadius: 4, borderWidth: 1.5, fill: false },
      ],
    },
    options: {
      ...defaults,
      scales: {
        ...defaults.scales,
        x: { ...defaults.scales.x, title: { display: true, text: "Hour of Day", color: "#aebcae" } },
        y: { ...defaults.scales.y, title: { display: true, text: "Temperature (°C)", color: "#aebcae" } },
      },
    },
  });
}

function renderHumidityTable() {
  const body = document.getElementById("humidityBody");
  if (!analysisData) { body.innerHTML = ""; return; }

  body.innerHTML = analysisData.humidityBuffering.map(row => `
    <tr>
      <td>${row.location}</td>
      <td>${row.stdDev != null ? row.stdDev.toFixed(2) : "--"}</td>
      <td>${row.interpretation}</td>
    </tr>`).join("");
}

function renderHumidityScatterChart() {
  destroyChart("humidityScatter");
  if (!analysisData) return;
  const ctx = document.getElementById("humidityScatterChart").getContext("2d");
  const defaults = getChartDefaults();
  const ts = analysisData.timeSeries;

  // Build scatter data: outdoor humidity vs near-wall humidity
  const mossPoints = [];
  const nonMossPoints = [];

  for (const row of ts) {
    if (row.outdoorHumidity != null && row.nearMossHumidity != null) {
      mossPoints.push({ x: row.outdoorHumidity, y: row.nearMossHumidity });
    }
    if (row.outdoorHumidity != null && row.nearNonMossHumidity != null) {
      nonMossPoints.push({ x: row.outdoorHumidity, y: row.nearNonMossHumidity });
    }
  }

  // y = x reference line (no buffering)
  const allX = [...mossPoints.map(p => p.x), ...nonMossPoints.map(p => p.x)];
  const minX = allX.length ? Math.floor(Math.min(...allX)) : 40;
  const maxX = allX.length ? Math.ceil(Math.max(...allX)) : 100;
  const refLine = [];
  for (let v = minX; v <= maxX; v += 1) refLine.push({ x: v, y: v });

  charts.humidityScatter = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Near Moss",
          data: mossPoints,
          backgroundColor: "rgba(114,210,143,0.35)",
          borderColor: "rgba(114,210,143,0.6)",
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 1,
        },
        {
          label: "Near Non-Moss",
          data: nonMossPoints,
          backgroundColor: "rgba(240,177,111,0.35)",
          borderColor: "rgba(240,177,111,0.6)",
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 1,
        },
        {
          label: "y=x (no buffering)",
          data: refLine,
          type: "line",
          borderColor: "rgba(200,200,200,0.5)",
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      ...defaults,
      plugins: {
        ...defaults.plugins,
        legend: {
          labels: { ...defaults.plugins.legend.labels, usePointStyle: true, pointStyle: "circle" },
        },
      },
      scales: {
        x: {
          ...defaults.scales.x,
          title: { display: true, text: "Outdoor Humidity (%)", color: "#aebcae" },
          min: minX - 2,
          max: maxX + 2,
        },
        y: {
          ...defaults.scales.y,
          title: { display: true, text: "Near-Wall Humidity (%)", color: "#aebcae" },
          min: minX - 2,
          max: maxX + 2,
        },
      },
    },
  });
}

function renderHumidityBufferChart() {
  destroyChart("humidityBuffer");
  if (!analysisData) return;
  const ctx = document.getElementById("humidityBufferChart").getContext("2d");
  const defaults = getChartDefaults();
  const hb = analysisData.humidityBuffering;

  charts.humidityBuffer = new Chart(ctx, {
    type: "bar",
    data: {
      labels: hb.map(h => h.location),
      datasets: [{
        label: "Std Dev of Humidity (%)",
        data: hb.map(h => h.stdDev),
        backgroundColor: ["rgba(90,200,224,0.7)", "rgba(114,210,143,0.7)", "rgba(240,177,111,0.7)"],
        borderColor: ["#5ac8e0", "#72d28f", "#f0b16f"],
        borderWidth: 1,
        borderRadius: 8,
      }],
    },
    options: {
      ...defaults,
      plugins: {
        ...defaults.plugins,
        legend: { display: false },
        title: { display: true, text: "Humidity Variability (lower = more stable)", color: "#ebf3ea", font: { size: 13 } },
      },
      scales: {
        ...defaults.scales,
        y: { ...defaults.scales.y, title: { display: true, text: "Std Dev of Humidity (%)", color: "#aebcae" }, beginAtZero: true },
      },
    },
  });
}

function renderTimeSeriesCharts() {
  if (!analysisData) return;
  const ts = analysisData.timeSeries;
  const labels = ts.map(r => formatTs(r.timestamp));

  // Temperature overview
  destroyChart("timeSeriesTemp");
  const ctxTemp = document.getElementById("timeSeriesTempChart").getContext("2d");
  const defaults = getChartDefaults();

  charts.timeSeriesTemp = new Chart(ctxTemp, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Outdoor", data: ts.map(r => r.outdoorTemp), borderColor: "#5ac8e0", borderWidth: 1.5, tension: 0.3, pointRadius: 0 },
        { label: "Moss Wall", data: ts.map(r => r.mossWallTemp), borderColor: "#72d28f", borderWidth: 2, tension: 0.3, pointRadius: 0 },
        { label: "Non-Moss Wall", data: ts.map(r => r.nonMossWallTemp), borderColor: "#f0b16f", borderWidth: 1.5, tension: 0.3, pointRadius: 0 },
        { label: "Moss Surface", data: ts.map(r => r.mossSurfaceTemp), borderColor: "#a78bfa", borderWidth: 1, tension: 0.3, pointRadius: 0, borderDash: [4, 2] },
        { label: "Non-Moss Surface", data: ts.map(r => r.nonMossSurfaceTemp), borderColor: "#fbbf24", borderWidth: 1, tension: 0.3, pointRadius: 0, borderDash: [4, 2] },
      ],
    },
    options: {
      ...defaults,
      scales: {
        ...defaults.scales,
        x: { ...defaults.scales.x, ticks: { ...defaults.scales.x.ticks, maxTicksLimit: 16 } },
        y: { ...defaults.scales.y, title: { display: true, text: "Temperature (°C)", color: "#aebcae" } },
      },
    },
  });

  // Humidity overview
  destroyChart("timeSeriesHumidity");
  const ctxHum = document.getElementById("timeSeriesHumidityChart").getContext("2d");

  charts.timeSeriesHumidity = new Chart(ctxHum, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Outdoor Humidity", data: ts.map(r => r.outdoorHumidity), borderColor: "#5ac8e0", borderWidth: 1.5, tension: 0.3, pointRadius: 0 },
        { label: "Near-Moss Humidity", data: ts.map(r => r.nearMossHumidity), borderColor: "#72d28f", borderWidth: 2, tension: 0.3, pointRadius: 0 },
        { label: "Near Non-Moss Humidity", data: ts.map(r => r.nearNonMossHumidity), borderColor: "#f0b16f", borderWidth: 1.5, tension: 0.3, pointRadius: 0 },
      ],
    },
    options: {
      ...defaults,
      scales: {
        ...defaults.scales,
        x: { ...defaults.scales.x, ticks: { ...defaults.scales.x.ticks, maxTicksLimit: 16 } },
        y: { ...defaults.scales.y, title: { display: true, text: "Humidity (%)", color: "#aebcae" }, min: 40, max: 100 },
      },
    },
  });
}

function renderCorrelationChart() {
  destroyChart("correlation");
  if (!analysisData || analysisData.timeSeries.length < 3) return;
  const ctx = document.getElementById("correlationChart").getContext("2d");
  const ts = analysisData.timeSeries;

  // Compute live Pearson correlations from the hourly data
  const channels = [
    { key: "outdoorTemp",        label: "Outdoor Temp" },
    { key: "outdoorHumidity",    label: "Outdoor Hum" },
    { key: "mossWallTemp",       label: "Moss Wall" },
    { key: "nonMossWallTemp",    label: "Non-Moss Wall" },
    { key: "mossSurfaceTemp",    label: "Moss Surface" },
    { key: "nonMossSurfaceTemp", label: "Non-Moss Surface" },
    { key: "nearMossHumidity",   label: "Near-Moss Hum" },
    { key: "nearNonMossHumidity",label: "Near Non-Moss Hum" },
  ];

  function pearson(xKey, yKey) {
    let n = 0, sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
    for (const row of ts) {
      const x = row[xKey], y = row[yKey];
      if (x == null || y == null) continue;
      n++; sx += x; sy += y; sxy += x * y; sx2 += x * x; sy2 += y * y;
    }
    if (n < 3) return 0;
    const num = n * sxy - sx * sy;
    const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
    return den === 0 ? 0 : num / den;
  }

  const dataPoints = [];
  for (let i = 0; i < channels.length; i++) {
    for (let j = 0; j < channels.length; j++) {
      const v = i === j ? 1 : pearson(channels[i].key, channels[j].key);
      dataPoints.push({ x: j, y: i, v });
    }
  }

  charts.correlation = new Chart(ctx, {
    type: "bubble",
    data: {
      datasets: [{
        data: dataPoints.map(p => ({ x: p.x, y: p.y, r: Math.abs(p.v) * 12 + 2 })),
        backgroundColor: dataPoints.map(p => {
          const v = p.v;
          if (v >= 0.8)  return "rgba(114,210,143,0.8)";
          if (v >= 0.5)  return "rgba(114,210,143,0.5)";
          if (v >= 0.2)  return "rgba(114,210,143,0.3)";
          if (v >= -0.2) return "rgba(150,150,150,0.3)";
          if (v >= -0.5) return "rgba(248,113,113,0.3)";
          if (v >= -0.8) return "rgba(248,113,113,0.5)";
          return "rgba(248,113,113,0.8)";
        }),
        borderColor: "rgba(255,255,255,0.1)",
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const idx = ctx.dataIndex;
              const i = Math.floor(idx / channels.length);
              const j = idx % channels.length;
              return `${channels[i].label} ↔ ${channels[j].label}: ${dataPoints[idx].v.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear", min: -0.5, max: channels.length - 0.5,
          ticks: { stepSize: 1, color: "#aebcae", font: { size: 9 }, callback: (val) => channels[val]?.label || "" },
          grid: { color: "rgba(47,60,50,0.3)" },
        },
        y: {
          type: "linear", min: -0.5, max: channels.length - 0.5, reverse: true,
          ticks: { stepSize: 1, color: "#aebcae", font: { size: 9 }, callback: (val) => channels[val]?.label || "" },
          grid: { color: "rgba(47,60,50,0.3)" },
        },
      },
    },
  });
}

function renderFindings() {
  const grid = document.getElementById("findingsGrid");
  if (!analysisData) { grid.innerHTML = ""; return; }

  grid.innerHTML = KEY_FINDINGS_TEMPLATE.map(f => {
    const { value, detail } = f.getValue(analysisData);
    return `
      <article class="finding-card" style="--accent:${f.color};">
        <div class="finding-icon">${f.icon}</div>
        <h3>${f.title}</h3>
        <div class="finding-value">${value}</div>
        <p class="finding-detail">${detail}</p>
      </article>`;
  }).join("");
}

// ── Master render ────────────────────────────────────────────────

function renderAll() {
  if (!analysisData) return;
  renderDescriptiveTable();
  renderTTestTable();
  renderTTestChart();
  renderCoolingCards();
  renderCoolingHistogram();
  renderCoolingAdvantageChart();
  renderDiurnalTable();
  renderDiurnalChart();
  renderHourlyChart();
  renderHumidityTable();
  renderHumidityScatterChart();
  renderHumidityBufferChart();
  renderTimeSeriesCharts();
  renderCorrelationChart();
  renderFindings();
}

// ── Event listeners ──────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Initial load — no filters, fetch all data
  fetchAnalysis();

  // Apply Filters
  document.getElementById("applyAnalysisFilters").addEventListener("click", () => {
    fetchAnalysis();

    // Pulse animation
    const panel = document.getElementById("filterPanel");
    panel.classList.add("filter-applied");
    setTimeout(() => panel.classList.remove("filter-applied"), 600);
  });

  // Reset Filters
  document.getElementById("resetAnalysisFilters").addEventListener("click", () => {
    document.getElementById("analysisStartDate").value = "";
    document.getElementById("analysisEndDate").value = "";
    document.getElementById("minHumidity").value = "";
    document.getElementById("maxHumidity").value = "";
    fetchAnalysis();
  });

  // Export All Charts button
  const exportAllBtn = document.getElementById("exportAllAnalysisCharts");
  if (exportAllBtn) {
    exportAllBtn.addEventListener("click", () => {
      if (Object.keys(charts).length === 0) {
        alert("Please wait for data to load first.");
        return;
      }
      downloadAllCharts();
    });
  }

  // Individual chart download buttons
  document.querySelectorAll(".analysis-dl-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const canvasId = btn.dataset.chart;
      const chartKey = ANALYSIS_CANVAS_TO_KEY[canvasId];
      const name = btn.dataset.name || canvasId;
      if (!chartKey || !charts[chartKey]) {
        alert("Please wait for data to load first.");
        return;
      }
      downloadChartPng(chartKey, name);
    });
  });
});
