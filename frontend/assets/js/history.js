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

async function loadPage(page) {
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;

  if (!start || !end) {
    alert("Please select start and end dates.");
    return;
  }

  rowsPerPage = getRowsPerPage();

  try {
    const url = `/api/data/history/paginated?start=${start}&end=${end}&page=${page}&per_page=${rowsPerPage}`;
    const payload = await apiGet(url);

    currentPage = payload.page;
    totalRows = payload.totalRows;
    totalPages = payload.totalPages;

    renderRows(payload.rows);
    updatePaginationUI(currentPage, totalPages, totalRows);

    // Invalidate cached export data when the date range might have changed
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
    // Fetch all pages for export (use the old non-paginated endpoint for full data)
    if (!allMergedRowsForExport) {
      const payload = await apiGet(`/api/data/history/paginated?start=${start}&end=${end}&page=1&per_page=${totalRows || 999999}`);
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
}

document.addEventListener("DOMContentLoaded", async () => {
  initDefaultDates();
  bindEvents();
  await loadHistoryRange();
});
