let latestMergedRows = [];
let currentPage = 1;
const ROWS_PER_PAGE = 30;
const MAX_MERGE_GAP_MS = 2 * 60 * 1000;

function sortRowsByTimestamp(rows) {
  return [...rows].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

function renderTable(pageNumber = 1) {
  const body = document.getElementById("historyTableBody");
  body.innerHTML = "";

  const totalPages = Math.ceil(latestMergedRows.length / ROWS_PER_PAGE);
  const startIdx = (pageNumber - 1) * ROWS_PER_PAGE;
  const endIdx = startIdx + ROWS_PER_PAGE;
  const pageRows = latestMergedRows.slice(startIdx, endIdx);

  pageRows.forEach((row) => {
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

  // Update pagination controls
  const paginationControls = document.getElementById("paginationControls");
  if (totalPages > 1) {
    paginationControls.style.display = "flex";
    paginationControls.style.justifyContent = "center";
    paginationControls.style.alignItems = "center";
    document.getElementById("pageInfo").textContent = `Page ${pageNumber} of ${totalPages}`;
    document.getElementById("prevPage").disabled = pageNumber === 1;
    document.getElementById("nextPage").disabled = pageNumber === totalPages;
  } else {
    paginationControls.style.display = "none";
  }

  currentPage = pageNumber;
}

async function loadHistoryRange() {
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;

  if (!start || !end) {
    alert("Please select start and end dates.");
    return;
  }

  try {
    const payload = await apiGet(`/api/data/history?start=${start}&end=${end}`);
    const moss = sortRowsByTimestamp(payload.moss || []);
    const nonMoss = sortRowsByTimestamp(payload.nonMoss || []);

    latestMergedRows = mergeByNearestTimestamp(moss, nonMoss);
    renderTable(1);
  } catch (error) {
    console.error(error);
    alert("Failed to load historical data.");
  }
}

function parseTimestampMs(value) {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function lowerBoundByTime(rows, targetMs) {
  let left = 0;
  let right = rows.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const midMs = parseTimestampMs(rows[mid]?.timestamp);

    if (midMs === null || midMs < targetMs) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

function findNearestUnmatchedIndex(rows, usedIndexes, targetMs) {
  if (!rows.length || targetMs === null) return -1;

  const pivot = lowerBoundByTime(rows, targetMs);
  let left = pivot - 1;
  let right = pivot;
  let bestIndex = -1;
  let bestDiff = Number.POSITIVE_INFINITY;

  while (left >= 0 || right < rows.length) {
    let checked = false;

    if (left >= 0) {
      checked = true;
      if (!usedIndexes.has(left)) {
        const leftMs = parseTimestampMs(rows[left]?.timestamp);
        if (leftMs !== null) {
          const diff = Math.abs(leftMs - targetMs);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIndex = left;
          }
        }
      }
      left -= 1;
    }

    if (right < rows.length) {
      checked = true;
      if (!usedIndexes.has(right)) {
        const rightMs = parseTimestampMs(rows[right]?.timestamp);
        if (rightMs !== null) {
          const diff = Math.abs(rightMs - targetMs);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIndex = right;
          }
        }
      }
      right += 1;
    }

    // Once both directions moved beyond the best known distance, stop searching.
    const leftMs = left >= 0 ? parseTimestampMs(rows[left]?.timestamp) : null;
    const rightMs = right < rows.length ? parseTimestampMs(rows[right]?.timestamp) : null;
    const leftGap = leftMs === null ? Number.POSITIVE_INFINITY : Math.abs(targetMs - leftMs);
    const rightGap = rightMs === null ? Number.POSITIVE_INFINITY : Math.abs(rightMs - targetMs);

    if (!checked || (bestIndex !== -1 && leftGap > bestDiff && rightGap > bestDiff)) {
      break;
    }
  }

  if (bestIndex === -1 || bestDiff > MAX_MERGE_GAP_MS) {
    return -1;
  }

  return bestIndex;
}

function toMergedRow(moss, non, timestamp) {
  return {
    timestamp: timestamp || moss?.timestamp || non?.timestamp || "",
    outdoorTemp: moss?.outdoorTemp,
    outdoorHumidity: moss?.outdoorHumidity,
    mossSurfaceTemp: moss?.mossSurfaceTemp,
    nonMossSurfaceTemp: non?.nonMossSurfaceTemp,
    nearMossTemp: moss?.nearMossTemp,
    nearNonMossTemp: non?.nearNonMossTemp,
    nearMossHumidity: moss?.nearMossHumidity,
    nearNonMossHumidity: non?.nearNonMossHumidity,
    mossWallTemp: moss?.wallTemp,
    nonMossWallTemp: non?.wallTemp,
  };
}

function mergeByNearestTimestamp(mossRows, nonMossRows) {
  if (!mossRows.length) {
    return nonMossRows.map((non) => toMergedRow(null, non, non.timestamp));
  }
  if (!nonMossRows.length) {
    return mossRows.map((moss) => toMergedRow(moss, null, moss.timestamp));
  }

  const primaryIsMoss = mossRows.length >= nonMossRows.length;
  const primary = primaryIsMoss ? mossRows : nonMossRows;
  const secondary = primaryIsMoss ? nonMossRows : mossRows;
  const usedSecondary = new Set();
  const merged = [];

  primary.forEach((row) => {
    const rowMs = parseTimestampMs(row.timestamp);
    const nearestIndex = findNearestUnmatchedIndex(secondary, usedSecondary, rowMs);
    const nearest = nearestIndex >= 0 ? secondary[nearestIndex] : null;

    if (nearestIndex >= 0) {
      usedSecondary.add(nearestIndex);
    }

    const moss = primaryIsMoss ? row : nearest;
    const non = primaryIsMoss ? nearest : row;
    merged.push(toMergedRow(moss, non, row.timestamp));
  });

  secondary.forEach((row, index) => {
    if (usedSecondary.has(index)) return;
    const moss = primaryIsMoss ? null : row;
    const non = primaryIsMoss ? row : null;
    merged.push(toMergedRow(moss, non, row.timestamp));
  });

  return sortRowsByTimestamp(merged);
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
      renderTable(currentPage - 1);
    }
  });
  
  document.getElementById("nextPage").addEventListener("click", () => {
    const totalPages = Math.ceil(latestMergedRows.length / ROWS_PER_PAGE);
    if (currentPage < totalPages) {
      renderTable(currentPage + 1);
    }
  });

  document.getElementById("exportCsv").addEventListener("click", () => {
    if (!latestMergedRows.length) {
      alert("No data available. Load a date range first.");
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

    const rows = latestMergedRows.map((row) => [
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
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  initDefaultDates();
  bindEvents();
  await loadHistoryRange();
});
