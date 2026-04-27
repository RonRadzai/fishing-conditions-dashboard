export const EASTERN_TIMEZONE = "America/New_York";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const JULIAN_DAY_UNIX_EPOCH = 2440587.5;
const SYNODIC_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

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

function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function sinDeg(degrees) {
  return Math.sin(degToRad(degrees));
}

function dateFromJulianDay(julianDay) {
  return new Date((julianDay - JULIAN_DAY_UNIX_EPOCH) * MS_PER_DAY);
}

function getJulianDay(date) {
  return date.getTime() / MS_PER_DAY + JULIAN_DAY_UNIX_EPOCH;
}

// Computes New and Full Moon event dates so API phase labels cannot skip them.
function getLunarPhaseDate(k) {
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const e = 1 - 0.002516 * t - 0.0000074 * t2;
  const m = 2.5534 + 29.1053567 * k - 0.0000014 * t2 - 0.00000011 * t3;
  const mp = 201.5643 + 385.81693528 * k + 0.0107582 * t2 + 0.00001238 * t3 - 0.000000058 * t4;
  const f = 160.7108 + 390.67050284 * k - 0.0016118 * t2 - 0.00000227 * t3 + 0.000000011 * t4;
  const omega = 124.7746 - 1.56375588 * k + 0.0020672 * t2 + 0.00000215 * t3;
  const isFullMoon = Math.abs((k % 1 + 1) % 1 - 0.5) < 0.01;

  let correction = (isFullMoon ? -0.40614 : -0.4072) * sinDeg(mp)
    + (isFullMoon ? 0.17302 : 0.17241) * e * sinDeg(m)
    + (isFullMoon ? 0.01614 : 0.01608) * sinDeg(2 * mp)
    + (isFullMoon ? 0.01043 : 0.01039) * sinDeg(2 * f)
    + (isFullMoon ? 0.00734 : 0.00739) * e * sinDeg(mp - m)
    - 0.00515 * e * sinDeg(mp + m)
    + 0.00209 * e * e * sinDeg(2 * m)
    - 0.00111 * sinDeg(mp - 2 * f)
    - 0.00057 * sinDeg(mp + 2 * f)
    + 0.00056 * e * sinDeg(2 * mp + m)
    - 0.00042 * sinDeg(3 * mp)
    + 0.00042 * e * sinDeg(m + 2 * f)
    + 0.00038 * e * sinDeg(m - 2 * f)
    - 0.00024 * e * sinDeg(2 * mp - m)
    - 0.00017 * sinDeg(omega)
    - 0.00007 * sinDeg(mp + 2 * m)
    + 0.00004 * sinDeg(2 * mp - 2 * f)
    + 0.00004 * sinDeg(3 * m)
    + 0.00003 * sinDeg(mp + m - 2 * f)
    + 0.00003 * sinDeg(2 * mp + 2 * f)
    - 0.00003 * sinDeg(mp + m + 2 * f)
    + 0.00003 * sinDeg(mp - m + 2 * f)
    - 0.00002 * sinDeg(mp - m - 2 * f)
    - 0.00002 * sinDeg(3 * mp + m)
    + 0.00002 * sinDeg(4 * mp);

  const planetaryCorrections = [
    [0.000325, 299.77 + 0.107408 * k - 0.009173 * t2],
    [0.000165, 251.88 + 0.016321 * k],
    [0.000164, 251.83 + 26.651886 * k],
    [0.000126, 349.42 + 36.412478 * k],
    [0.00011, 84.66 + 18.206239 * k],
    [0.000062, 141.74 + 53.303771 * k],
    [0.00006, 207.14 + 2.453732 * k],
    [0.000056, 154.84 + 7.30686 * k],
    [0.000047, 34.52 + 27.261239 * k],
    [0.000042, 207.19 + 0.121824 * k],
    [0.00004, 291.34 + 1.844379 * k],
    [0.000037, 161.72 + 24.198154 * k],
    [0.000035, 239.56 + 25.513099 * k],
    [0.000023, 331.55 + 3.592518 * k],
  ];

  correction += planetaryCorrections.reduce((total, [coefficient, angle]) => {
    return total + coefficient * sinDeg(angle);
  }, 0);

  const julianDay = 2451550.09765
    + SYNODIC_MONTH_DAYS * k
    + 0.0001337 * t2
    - 0.00000015 * t3
    + 0.00000000073 * t4
    + correction;

  return dateFromJulianDay(julianDay);
}

function getMoonPhaseBaseIndex(date) {
  return Math.round((getJulianDay(date) - 2451550.09765) / SYNODIC_MONTH_DAYS);
}

function titleCasePhase(phase) {
  return phase === "new" ? "New Moon" : "Full Moon";
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

export function formatYmdInTimeZone(date, timeZone = EASTERN_TIMEZONE) {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
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

export function getMoonPhaseFraction(date) {
  const elapsed = date.getTime() - KNOWN_NEW_MOON_MS;
  const synodicMonthMs = SYNODIC_MONTH_DAYS * MS_PER_DAY;
  return (((elapsed % synodicMonthMs) + synodicMonthMs) % synodicMonthMs) / synodicMonthMs;
}

export function getMoonPhaseFractionForDate(yyyymmdd) {
  return getMoonPhaseFraction(createStableDateFromYmd(yyyymmdd));
}

export function getMoonPhaseTypeFromText(phaseText) {
  const normalized = String(phaseText ?? "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();

  if (/\bnew\b/.test(normalized)) {
    return "new";
  }
  if (/\bfull\b/.test(normalized)) {
    return "full";
  }
  return null;
}

export function getTrackedMoonPhaseForDate(yyyymmdd, timeZone = EASTERN_TIMEZONE) {
  const date = createStableDateFromYmd(yyyymmdd);
  const baseIndex = getMoonPhaseBaseIndex(date);

  for (let offset = -2; offset <= 2; offset += 1) {
    const newMoonDate = getLunarPhaseDate(baseIndex + offset);
    if (formatYmdInTimeZone(newMoonDate, timeZone) === yyyymmdd) {
      return {
        type: "new",
        label: titleCasePhase("new"),
        date: newMoonDate,
      };
    }

    const fullMoonDate = getLunarPhaseDate(baseIndex + offset + 0.5);
    if (formatYmdInTimeZone(fullMoonDate, timeZone) === yyyymmdd) {
      return {
        type: "full",
        label: titleCasePhase("full"),
        date: fullMoonDate,
      };
    }
  }

  return null;
}

export function getApproximateMoonPhaseName(yyyymmdd) {
  const phaseFraction = getMoonPhaseFractionForDate(yyyymmdd);

  if (phaseFraction < 0.0625 || phaseFraction >= 0.9375) return "New Moon";
  if (phaseFraction < 0.1875) return "Waxing Crescent";
  if (phaseFraction < 0.3125) return "First Quarter";
  if (phaseFraction < 0.4375) return "Waxing Gibbous";
  if (phaseFraction < 0.5625) return "Full Moon";
  if (phaseFraction < 0.6875) return "Waning Gibbous";
  if (phaseFraction < 0.8125) return "Last Quarter";
  return "Waning Crescent";
}
