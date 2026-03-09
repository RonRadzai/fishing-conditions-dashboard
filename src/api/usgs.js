const USGS_URL =
  "https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items?f=json&monitoring_location_id=USGS-03171000&parameter_code=00060,00065";

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

export async function getUsgsRadfordLatest() {
  const response = await fetch(USGS_URL, {
    headers: {
      Accept: "application/geo+json",
    },
  });

  if (!response.ok) {
    throw new Error("USGS request failed.");
  }

  const payload = await response.json();
  const features = Array.isArray(payload.features) ? payload.features : [];

  const flow = pluckValueByCode(features, "00060");
  const gaugeHeight = pluckValueByCode(features, "00065");

  return {
    flow,
    gaugeHeight,
  };
}
