export async function getCurrentObservation(lat, lon) {
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: { Accept: "application/geo+json" },
  });
  if (!pointsRes.ok) throw new Error("NWS points lookup failed.");

  const pointsData = await pointsRes.json();
  const stationsUrl = pointsData.properties?.observationStations;
  if (!stationsUrl) throw new Error("NWS points response missing observationStations.");

  const stationsRes = await fetch(stationsUrl, { headers: { Accept: "application/geo+json" } });
  if (!stationsRes.ok) throw new Error("NWS stations request failed.");

  const stationsData = await stationsRes.json();
  const stationId = stationsData.features?.[0]?.properties?.stationIdentifier;
  if (!stationId) throw new Error("No observation stations found.");

  const obsRes = await fetch(`https://api.weather.gov/stations/${stationId}/observations/latest`, {
    headers: { Accept: "application/geo+json" },
  });
  if (!obsRes.ok) throw new Error("NWS observation request failed.");

  const p = (await obsRes.json()).properties;

  const toF   = (c)   => c  != null ? Math.round(c * 9 / 5 + 32)      : null;
  const toMph = (kmh) => kmh != null ? Math.round(kmh * 0.621371)       : null;
  const toInHg = (pa) => pa  != null ? (pa / 3386.389).toFixed(2)        : null;
  const toMiles = (m) => m   != null ? (m / 1609.344).toFixed(1)         : null;
  const toIn  = (mm)  => mm  != null ? (mm * 0.0393701).toFixed(2)       : null;
  const toCardinal = (deg) => {
    if (deg == null) return null;
    return ["N","NE","E","SE","S","SW","W","NW"][Math.round(deg / 45) % 8];
  };

  return {
    textDescription:       p.textDescription || null,
    temperature:           toF(p.temperature?.value),
    windSpeed:             toMph(p.windSpeed?.value),
    windDirection:         toCardinal(p.windDirection?.value),
    windGust:              toMph(p.windGust?.value),
    barometricPressure:    toInHg(p.barometricPressure?.value),
    visibility:            toMiles(p.visibility?.value),
    relativeHumidity:      p.relativeHumidity?.value != null ? Math.round(p.relativeHumidity.value) : null,
    precipitationLastHour: toIn(p.precipitationLastHour?.value),
    timestamp:             p.timestamp || null,
  };
}

export async function getHourlyWeather(lat, lon, hoursAhead = 8) {
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: {
      Accept: "application/geo+json",
    },
  });

  if (!pointsRes.ok) {
    throw new Error("NWS points lookup failed.");
  }

  const pointsData = await pointsRes.json();
  const hourlyUrl = pointsData.properties?.forecastHourly;
  if (!hourlyUrl) {
    throw new Error("NWS points response missing forecastHourly.");
  }

  const hourlyRes = await fetch(hourlyUrl, {
    headers: {
      Accept: "application/geo+json",
    },
  });

  if (!hourlyRes.ok) {
    throw new Error("NWS hourly forecast request failed.");
  }

  const hourlyData = await hourlyRes.json();
  const periods = Array.isArray(hourlyData.properties?.periods)
    ? hourlyData.properties.periods
    : [];

  const now = Date.now();
  const horizon = now + hoursAhead * 3600000;

  const selected = periods
    .filter((p) => {
      const ts = Date.parse(p.startTime);
      return Number.isFinite(ts) && ts >= now && ts <= horizon;
    })
    .slice(0, hoursAhead);

  return {
    updated: hourlyData.properties?.updateTime || null,
    periods: selected.map((p) => ({
      startTime: p.startTime,
      temperature: p.temperature,
      temperatureUnit: p.temperatureUnit || "F",
      rainChance: p.probabilityOfPrecipitation?.value,
      windSpeed: p.windSpeed || "N/A",
      windDirection: p.windDirection || "N/A",
      windGust: p.windGust || null,
      shortForecast: p.shortForecast || null,
    })),
  };
}
