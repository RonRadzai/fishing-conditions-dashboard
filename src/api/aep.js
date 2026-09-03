import { asNumber } from "../utils.js";

const AEP_DATA_DIR = new URL("../data/aep/", import.meta.url);
const STALE_AFTER_HOURS = 6;

export async function getAepCurrent(location) {
  const dataUrl = new URL(`${location.id}.json`, AEP_DATA_DIR);
  const response = await fetch(`${dataUrl}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`AEP ${location.name} data file is unavailable.`);
  }

  const data = await response.json();
  if (!data || data.location !== location.aepSlug) {
    throw new Error(`AEP ${location.name} data file is invalid.`);
  }

  const currentFlowCfs = asNumber(data.currentFlowCfs);
  if (currentFlowCfs === null) {
    throw new Error(`AEP ${location.name} data file is missing current flow.`);
  }

  const generatedAtMs = Date.parse(data.generatedAt);
  const stale = Number.isFinite(generatedAtMs)
    ? Date.now() - generatedAtMs > STALE_AFTER_HOURS * 60 * 60 * 1000
    : false;

  return {
    locationId: location.id,
    sourceUrl: data.sourceUrl || location.aepUrl,
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
