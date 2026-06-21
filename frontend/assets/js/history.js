let currentPage = 1;
let totalRows = 0;
let totalPages = 1;
let rowsPerPage = 30;
let allMergedRowsForExport = null; // lazily fetched for CSV export

function getRowsPerPage() {
  const select = document.getElementById("rowsPerPage");
  return select ? parseInt(select.value, 10) : 30;
}

function buildPageNumbers(current, total) {
  const container = document.getElementById("pageNumbers");
  if (!container) return;
  container.innerHTML = "";

  const pages = [];
  const WINDOW = 2;

  for (let i = 1; i <= total; i++) {
    if (
      i === 1 ||
      i === total ||
      (i >= current - WINDOW && i <= current + WINDOW)
    ) {
      pages.push(i);
    }
  }

  const withGaps = [];
  let prev = 0;
  pages.forEach((p) => {
    if (prev && p - prev > 1) {
      withGaps.push("...");
    }
    withGaps.push(p);
    prev = p;
  });

  withGaps.forEach((item) => {
    if (item === "...") {
      const el = document.createElement("span");
      el.className = "page-ellipsis";
      el.textContent = "\u2026";
      container.appendChild(el);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item;
      btn.className = "page-btn" + (item === current ? " active" : "");
      btn.addEventListener("click", () => loadPage(item));
      container.appendChild(btn);
    }
  });
}

function renderRows(rows) {
  const body = document.getElementById("historyTableBody");
  body.innerHTML = "";

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatTimestamp(row.timestamp)}</td>
      <td>${formatNumber(row.outdoorTemp, "", 2)}</td>
      <td>${formatNumber(row.outdoorHumidity, "", 2)}</td>
      <td>${formatNumber(row.mossSurfaceTemp, "", 2)}</td>
      <td>${formatNumber(row.nearMossTemp, "", 2)}</td>
      <td>${formatNumber(row.nearMossHumidity, "", 2)}</td>
      <td>${formatNumber(row.mossWallTemp, "", 2)}</td>
      <td>${formatNumber(row.nonMossSurfaceTemp, "", 2)}</td>
      <td>${formatNumber(row.nearNonMossTemp, "", 2)}</td>
      <td>${formatNumber(row.nearNonMossHumidity, "", 2)}</td>
      <td>${formatNumber(row.nonMossWallTemp, "", 2)}</td>
    `;
    body.appendChild(tr);
  });
}

function updatePaginationUI(page, total, rowCount) {
  const controls = document.getElementById("paginationControls");
  if (rowCount > 0) {
    controls.style.display = "";

    const startIdx = (page - 1) * rowsPerPage + 1;
    const endIdx = Math.min(page * rowsPerPage, rowCount);
    const rowCountEl = document.getElementById("rowCount");
    if (rowCountEl) {
      rowCountEl.textContent = `Showing ${startIdx}\u2013${endIdx} of ${rowCount} rows`;
    }

    document.getElementById("prevPage").disabled = page === 1;
    document.getElementById("nextPage").disabled = page === total;
    buildPageNumbers(page, total);
  } else {
    controls.style.display = "none";
  }
}

function buildFilterQuery() {
  const params = new URLSearchParams();
  const startTime = document.getElementById("histStartTime")?.value || "";
  const endTime = document.getElementById("histEndTime")?.value || "";
  const minHum = document.getElementById("histMinHumidity")?.value || "";
  const maxHum = document.getElementById("histMaxHumidity")?.value || "";

  if (startTime) params.set("startTime", startTime);
  if (endTime) params.set("endTime", endTime);
  if (minHum) params.set("minHumidity", minHum);
  if (maxHum) params.set("maxHumidity", maxHum);

  return params.toString();
}

function renderHistoryFilterStatus() {
  const el = document.getElementById("historyFilterStatus");
  if (!el) return;

  const parts = [];
  const s = document.getElementById("startDate").value;
  const st = document.getElementById("histStartTime")?.value || "";
  const e = document.getElementById("endDate").value;
  const et = document.getElementById("histEndTime")?.value || "";
  const minH = document.getElementById("histMinHumidity")?.value || "";
  const maxH = document.getElementById("histMaxHumidity")?.value || "";

  if (s) parts.push(`From: ${s}${st ? " " + st : ""}`);
  if (e) parts.push(`To: ${e}${et ? " " + et : ""}`);
  if (!s && st) parts.push(`Start Time: ${st}`);
  if (!e && et) parts.push(`End Time: ${et}`);
  if (minH) parts.push(`Min Humidity: ${minH}%`);
  if (maxH) parts.push(`Max Humidity: ${maxH}%`);

  const countInfo = totalRows > 0 ? ` \u00b7 ${totalRows} total rows` : "";

  if (parts.length <= 2) {
    // Only date filters (default)
    el.innerHTML = `<span class="filter-inactive">Date range only${countInfo}</span>`;
  } else {
    el.innerHTML = `<span class="filter-active">\ud83d\udfe2 Active filters: ${parts.join(" \u00b7 ")}${countInfo}</span>`;
  }
}

async function loadPage(page) {
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;

  if (!start || !end) {
    alert("Please select start and end dates.");
    return;
  }

  rowsPerPage = getRowsPerPage();

  try {
    const extraFilters = buildFilterQuery();
    const url = `/api/data/history/paginated?start=${start}&end=${end}&page=${page}&per_page=${rowsPerPage}${extraFilters ? "&" + extraFilters : ""}`;
    const payload = await apiGet(url);

    currentPage = payload.page;
    totalRows = payload.totalRows;
    totalPages = payload.totalPages;

    renderRows(payload.rows);
    updatePaginationUI(currentPage, totalPages, totalRows);
    renderHistoryFilterStatus();

    // Invalidate cached export data when filters might have changed
    allMergedRowsForExport = null;
  } catch (error) {
    console.error(error);
    alert("Failed to load historical data.");
  }
}

function loadHistoryRange() {
  return loadPage(1);
}

async function exportAllAsCsv() {
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;

  if (!start || !end) {
    alert("Please select start and end dates.");
    return;
  }

  try {
    // Fetch all pages for export with current filters
    if (!allMergedRowsForExport) {
      const extraFilters = buildFilterQuery();
      const payload = await apiGet(`/api/data/history/paginated?start=${start}&end=${end}&page=1&per_page=${totalRows || 999999}${extraFilters ? "&" + extraFilters : ""}`);
      allMergedRowsForExport = payload.rows;
    }

    if (!allMergedRowsForExport.length) {
      alert("No data available.");
      return;
    }

    const header = [
      "timestamp",
      "outdoor_temp",
      "outdoor_humidity",
      "moss_surface_temp",
      "near_moss_temp",
      "near_moss_humidity",
      "moss_wall_temp",
      "non_moss_surface_temp",
      "near_non_moss_temp",
      "near_non_moss_humidity",
      "non_moss_wall_temp",
    ];

    const rows = allMergedRowsForExport.map((row) => [
      row.timestamp,
      row.outdoorTemp,
      row.outdoorHumidity,
      row.mossSurfaceTemp,
      row.nearMossTemp,
      row.nearMossHumidity,
      row.mossWallTemp,
      row.nonMossSurfaceTemp,
      row.nearNonMossTemp,
      row.nearNonMossHumidity,
      row.nonMossWallTemp,
    ]);

    downloadCsv(`environment_history_${Date.now()}.csv`, [header, ...rows]);
  } catch (error) {
    console.error(error);
    alert("Failed to export data.");
  }
}

function initDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 2);

  document.getElementById("startDate").value = start.toISOString().slice(0, 10);
  document.getElementById("endDate").value = end.toISOString().slice(0, 10);
}

function bindEvents() {
  document.getElementById("loadHistory").addEventListener("click", loadHistoryRange);

  document.getElementById("prevPage").addEventListener("click", () => {
    if (currentPage > 1) {
      loadPage(currentPage - 1);
    }
  });

  document.getElementById("nextPage").addEventListener("click", () => {
    if (currentPage < totalPages) {
      loadPage(currentPage + 1);
    }
  });

  document.getElementById("rowsPerPage").addEventListener("change", () => {
    loadPage(1);
  });

  document.getElementById("exportCsv").addEventListener("click", exportAllAsCsv);

  // Reset Filters
  const resetBtn = document.getElementById("resetHistoryFilters");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      document.getElementById("histStartTime").value = "";
      document.getElementById("histEndTime").value = "";
      document.getElementById("histMinHumidity").value = "";
      document.getElementById("histMaxHumidity").value = "";
      initDefaultDates();
      loadHistoryRange();
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initDefaultDates();
  bindEvents();
  await loadHistoryRange();
});
