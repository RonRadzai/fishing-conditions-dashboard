import { EASTERN_TIMEZONE, formatUsDateTime, formatUsHour } from "../utils.js";

const AEP_FORECAST_URL =
  "https://aepcom-api.aep.com/api/hydro/forecast?location=WhitethorneLaunch";
const AEP_REFERENCE_URL = "https://www.aep.com/recreation/hydro/whitethornelaunch/";

function toHourKeyEastern(timestampMs) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  })
    .format(new Date(timestampMs))
    .replace(",", "");
}

function buildTargetKeys(currentDateTimeMs) {
  const floorHour = Math.floor(currentDateTimeMs / 3600000) * 3600000;
  const keys = [];
  for (let i = -2; i <= 8; i += 1) {
    const ts = floorHour + i * 3600000;
    keys.push({
      key: toHourKeyEastern(ts),
      label: formatUsHour(new Date(ts), EASTERN_TIMEZONE),
      ts,
    });
  }
  return keys;
}

export async function getAepFlowWindow() {
  const response = await fetch(AEP_FORECAST_URL);
  if (!response.ok) {
    throw new Error("AEP forecast request failed.");
  }

  const payload = await response.json();
  const points = Array.isArray(payload.forecast) ? payload.forecast : [];
  const nowMs = Number(payload.currentDateTime);
  if (!Number.isFinite(nowMs)) {
    throw new Error("AEP payload missing currentDateTime.");
  }

  const targets = buildTargetKeys(nowMs);
  const latestPerHour = new Map();

  for (const point of points) {
    const [timeMs, flow] = point;
    if (!Number.isFinite(timeMs) || !Number.isFinite(flow)) {
      continue;
    }
    const key = toHourKeyEastern(timeMs);
    const existing = latestPerHour.get(key);
    if (!existing || timeMs > existing.timeMs) {
      latestPerHour.set(key, { timeMs, flow });
    }
  }

  const windowHours = targets.map(({ key, label, ts }) => {
    const point = latestPerHour.get(key);
    return {
      label,
      hourTs: ts,
      flow: point ? point.flow : null,
      pointTs: point ? point.timeMs : null,
    };
  });

  const validPoints = windowHours.filter((h) => h.flow !== null);
  return {
    sourceUrl: AEP_REFERENCE_URL,
    lastUpdated: payload.lastUpdated ? formatUsDateTime(new Date(payload.lastUpdated), EASTERN_TIMEZONE) : "Unknown",
    timezone: "ET",
    hours: windowHours,
    chartMin: validPoints.length ? Math.min(...validPoints.map((h) => h.flow)) : null,
    chartMax: validPoints.length ? Math.max(...validPoints.map((h) => h.flow)) : null,
  };
}
