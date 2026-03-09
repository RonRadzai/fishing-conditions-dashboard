export const DEFAULT_ZIP = "24060";
export const ZIP_STORAGE_KEY = "fishing_dashboard_zip";
export const EASTERN_TIMEZONE = "America/New_York";

export function getTzIntegerFromBrowser() {
  return -new Date().getTimezoneOffset() / 60;
}

export function formatDateLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function buildSolunarDates(days) {
  const dates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}${m}${day}`);
  }

  return dates;
}

export function formatUsHour(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

export function formatUsDateTime(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

export function setHtml(el, html) {
  el.innerHTML = html;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getLocalZip() {
  const stored = localStorage.getItem(ZIP_STORAGE_KEY);
  if (stored && /^\d{5}$/.test(stored)) {
    return stored;
  }
  return DEFAULT_ZIP;
}

export function saveLocalZip(zip) {
  localStorage.setItem(ZIP_STORAGE_KEY, zip);
}

export function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
