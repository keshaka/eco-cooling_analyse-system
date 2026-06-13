function resolveApiBaseUrl() {
  const fromWindow = window.API_BASE_URL;
  if (typeof fromWindow === "string" && fromWindow.trim()) {
    return fromWindow.trim().replace(/\/$/, "");
  }

  const meta = document.querySelector('meta[name="api-base-url"]')?.content;
  if (typeof meta === "string" && meta.trim()) {
    return meta.trim().replace(/\/$/, "");
  }

  const host = window.location.hostname;
  const isLocal = host === "127.0.0.1" || host === "localhost";
  if (isLocal) {
    return "http://127.0.0.1:8000";
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${host}:8000`;
}

const API_BASE_URL = resolveApiBaseUrl();

function formatNumber(value, unit = "", precision = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  return `${Number(value).toFixed(precision)}${unit}`;
}

function formatTimestamp(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("en-IN", { 
    timeZone: "Asia/Kolkata",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function initThemeToggle() {
  // Dark mode only — no toggle needed
}

function highlightActiveNav() {
  const page = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll(".nav-links a").forEach((a) => {
    const href = a.getAttribute("href")?.toLowerCase();
    if (href === page) {
      a.classList.add("active");
    }
  });
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const csvBody = rows
    .map((row) =>
      row
        .map((item) => {
          const value = item ?? "";
          const escaped = String(value).replaceAll('"', '""');
          return `"${escaped}"`;
        })
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csvBody], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  highlightActiveNav();
});
