let compareBarChart;
let surfaceCompareChart;
let airTempCompareChart;
let humidityCompareChart;
let wallCompareChart;

function sortRowsByTimestamp(rows) {
  return [...rows].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

function initDateDefaults() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);

  document.getElementById("compareStartDate").value = start.toISOString().slice(0, 10);
  document.getElementById("compareEndDate").value = end.toISOString().slice(0, 10);
}

function buildCompareChart() {
  const context = document.getElementById("compareBarChart");
  compareBarChart = new Chart(context, {
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
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}

function buildLineChart(canvasId, labelA, labelB, colorA, colorB) {
  const context = document.getElementById(canvasId);
  return new Chart(context, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: labelA,
          data: [],
          borderColor: colorA,
          backgroundColor: `${colorA}22`,
          tension: 0.3,
          fill: true,
        },
        {
          label: labelB,
          data: [],
          borderColor: colorB,
          backgroundColor: `${colorB}22`,
          tension: 0.3,
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

function buildCompareLineCharts() {
  surfaceCompareChart = buildLineChart("surfaceCompareChart", "Moss", "Non-Moss", "#2d7a4b", "#d4732f");
  airTempCompareChart = buildLineChart("airTempCompareChart", "Moss", "Non-Moss", "#3a9d5e", "#bb5a26");
  humidityCompareChart = buildLineChart("humidityCompareChart", "Moss", "Non-Moss", "#2f8f83", "#a46f1a");
  wallCompareChart = buildLineChart("wallCompareChart", "Moss", "Non-Moss", "#356f9e", "#9d4c7c");
}

function toTimestampKey(value) {
  return new Date(value).toISOString();
}

function updateLineChart(chart, mossRows, nonMossRows, mossKey, nonMossKey) {
  if (!chart) return;

  const moss = sortRowsByTimestamp(mossRows);
  const nonMoss = sortRowsByTimestamp(nonMossRows);
  const mossLookup = new Map(moss.map((row) => [toTimestampKey(row.timestamp), row]));
  const nonMossLookup = new Map(nonMoss.map((row) => [toTimestampKey(row.timestamp), row]));
  const timestamps = [...new Set([...moss.map((row) => toTimestampKey(row.timestamp)), ...nonMoss.map((row) => toTimestampKey(row.timestamp))])].sort();

  chart.data.labels = timestamps.map((timestamp) =>
    new Date(timestamp).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  );
  chart.data.datasets[0].data = timestamps.map((timestamp) => mossLookup.get(timestamp)?.[mossKey] ?? null);
  chart.data.datasets[1].data = timestamps.map((timestamp) => nonMossLookup.get(timestamp)?.[nonMossKey] ?? null);
  chart.update();
}

async function loadCompareLines() {
  const start = document.getElementById("compareStartDate").value;
  const end = document.getElementById("compareEndDate").value;

  if (!start || !end) {
    alert("Please select start and end dates.");
    return;
  }

  try {
    const payload = await apiGet(`/api/data/history?start=${start}&end=${end}`);
    const moss = payload.moss || [];
    const nonMoss = payload.nonMoss || [];

    updateLineChart(surfaceCompareChart, moss, nonMoss, "mossSurfaceTemp", "nonMossSurfaceTemp");
    updateLineChart(airTempCompareChart, moss, nonMoss, "nearMossTemp", "nearNonMossTemp");
    updateLineChart(humidityCompareChart, moss, nonMoss, "nearMossHumidity", "nearNonMossHumidity");
    updateLineChart(wallCompareChart, moss, nonMoss, "wallTemp", "wallTemp");
  } catch (error) {
    console.error(error);
    alert("Failed to load comparison line charts.");
  }
}

async function loadCompare() {
  try {
    const data = await apiGet("/api/data/compare");

    document.getElementById("surfaceDiff").innerHTML = `${formatNumber(data.surfaceTemperature.difference, "", 2)} <small>degC</small>`;
    document.getElementById("airTempDiff").innerHTML = `${formatNumber(data.nearAirTemperature.difference, "", 2)} <small>degC</small>`;
    document.getElementById("humidityDiff").innerHTML = `${formatNumber(data.nearAirHumidity.difference, "", 2)} <small>%</small>`;
    document.getElementById("wallDiff").innerHTML = `${formatNumber(data.wallTemperature.difference, "", 2)} <small>degC</small>`;

    compareBarChart.data.datasets[0].data = [
      data.surfaceTemperature.mossAverage,
      data.nearAirTemperature.mossAverage,
      data.nearAirHumidity.mossAverage,
      data.wallTemperature.mossAverage,
    ];
    compareBarChart.data.datasets[1].data = [
      data.surfaceTemperature.nonMossAverage,
      data.nearAirTemperature.nonMossAverage,
      data.nearAirHumidity.nonMossAverage,
      data.wallTemperature.nonMossAverage,
    ];
    compareBarChart.update();
  } catch (error) {
    console.error(error);
    alert("Failed to load comparison metrics.");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initDateDefaults();
  buildCompareChart();
  buildCompareLineCharts();
  document.getElementById("loadCompareLines").addEventListener("click", loadCompareLines);
  await loadCompare();
  await loadCompareLines();
});
