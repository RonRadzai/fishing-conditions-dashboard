export const EASTERN_TIMEZONE = "America/New_York";

function getTimeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
}

function createStableDateFromYmd(yyyymmdd) {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export function getEasternTzInteger(date = new Date()) {
  const parts = getTimeZoneParts(date, EASTERN_TIMEZONE);
  const easternAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return Math.round((easternAsUtc - date.getTime()) / 3600000);
}

export function formatDateLabel(value) {
  const date = typeof value === "string" ? createStableDateFromYmd(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function buildSolunarDates(days, timeZone = EASTERN_TIMEZONE) {
  const today = getTimeZoneParts(new Date(), timeZone);
  const start = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const dates = [];

  for (let i = 0; i < days; i += 1) {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + i);
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, "0");
    const day = String(current.getUTCDate()).padStart(2, "0");
    dates.push(`${year}${month}${day}`);
  }

  return dates;
}

export function formatUsHour(date, timeZone = EASTERN_TIMEZONE) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

export function formatUsDateTime(date, timeZone = EASTERN_TIMEZONE) {
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

export function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
