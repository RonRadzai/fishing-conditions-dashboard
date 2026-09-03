import { fetchWithTimeout } from "../utils.js";

const USGS_BASE_URL =
  "https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items?f=json&parameter_code=00060,00065";
const USGS_TIMEOUT_MS = 8000;

function pluckValueByCode(features, code) {
  const match = features.find((f) => {
    const props = f.properties || {};
    return props.parameter_code === code;
  });

  if (!match) {
    return null;
  }

  const props = match.properties || {};
  const value = Number(props.value);
  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    value,
    dateTime: props.time || null,
    unit: props.unit_of_measure || null,
  };
}

// gaugeId is a USGS monitoring location id such as "USGS-03171000".
export async function getUsgsLatest(gaugeId) {
  const url = `${USGS_BASE_URL}&monitoring_location_id=${encodeURIComponent(gaugeId)}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/geo+json",
    },
  }, USGS_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error("USGS request failed.");
  }

  const payload = await response.json();
  const features = Array.isArray(payload.features) ? payload.features : [];

  const flow = pluckValueByCode(features, "00060");
  const gaugeHeight = pluckValueByCode(features, "00065");

  return {
    gaugeId,
    flow,
    gaugeHeight,
  };
}
