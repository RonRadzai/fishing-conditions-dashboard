const AEP_DATA_URL = new URL("../data/aep-whitethorne.json", import.meta.url);
const STALE_AFTER_HOURS = 6;

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getAepCurrent() {
  const response = await fetch(`${AEP_DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("AEP Whitethorne data file is unavailable.");
  }

  const data = await response.json();
  if (!data || data.location !== "WhitethorneLaunch") {
    throw new Error("AEP Whitethorne data file is invalid.");
  }

  const currentFlowCfs = asNumber(data.currentFlowCfs);
  if (currentFlowCfs === null) {
    throw new Error("AEP Whitethorne data file is missing current flow.");
  }

  const generatedAtMs = Date.parse(data.generatedAt);
  const stale = Number.isFinite(generatedAtMs)
    ? Date.now() - generatedAtMs > STALE_AFTER_HOURS * 60 * 60 * 1000
    : false;

  return {
    sourceUrl: data.sourceUrl,
    generatedAt: data.generatedAt,
    lastUpdated: data.lastUpdated,
    currentDateTime: data.currentDateTime,
    waterReleasedHoursOffset: asNumber(data.waterReleasedHoursOffset),
    currentFlowCfs,
    forecastPoints: Array.isArray(data.forecastPoints) ? data.forecastPoints : [],
    forecastCheckpoints: Array.isArray(data.forecastCheckpoints) ? data.forecastCheckpoints : [],
    stale,
  };
}
