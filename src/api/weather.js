import { fetchWithTimeout } from "../utils.js";

const WEATHER_TIMEOUT_MS = 8000;

let pointsCacheKey = null;
let pointsCachePromise = null;

// Both exports need the same NWS points lookup; share one in-flight request.
function getPointsData(lat, lon) {
  const key = `${lat},${lon}`;
  if (!pointsCachePromise || pointsCacheKey !== key) {
    pointsCacheKey = key;
    pointsCachePromise = fetchWithTimeout(`https://api.weather.gov/points/${lat},${lon}`, {
      headers: { Accept: "application/geo+json" },
    }, WEATHER_TIMEOUT_MS).then((res) => {
      if (!res.ok) throw new Error("NWS points lookup failed.");
      return res.json();
    });
    pointsCachePromise.catch(() => {
      if (pointsCacheKey === key) {
        pointsCachePromise = null;
      }
    });
  }
  return pointsCachePromise;
}

export async function getCurrentObservation(lat, lon) {
  const pointsData = await getPointsData(lat, lon);
  const stationsUrl = pointsData.properties?.observationStations;
  if (!stationsUrl) throw new Error("NWS points response missing observationStations.");

  const stationsRes = await fetchWithTimeout(stationsUrl, { headers: { Accept: "application/geo+json" } }, WEATHER_TIMEOUT_MS);
  if (!stationsRes.ok) throw new Error("NWS stations request failed.");

  const stationsData = await stationsRes.json();
  const stationId = stationsData.features?.[0]?.properties?.stationIdentifier;
  if (!stationId) throw new Error("No observation stations found.");

  const obsRes = await fetchWithTimeout(`https://api.weather.gov/stations/${stationId}/observations/latest`, {
    headers: { Accept: "application/geo+json" },
  }, WEATHER_TIMEOUT_MS);
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
  const pointsData = await getPointsData(lat, lon);
  const hourlyUrl = pointsData.properties?.forecastHourly;
  if (!hourlyUrl) {
    throw new Error("NWS points response missing forecastHourly.");
  }

  const hourlyRes = await fetchWithTimeout(hourlyUrl, {
    headers: {
      Accept: "application/geo+json",
    },
  }, WEATHER_TIMEOUT_MS);

  if (!hourlyRes.ok) {
    throw new Error("NWS hourly forecast request failed.");
  }

  const hourlyData = await hourlyRes.json();
  const periods = Array.isArray(hourlyData.properties?.periods)
    ? hourlyData.properties.periods
    : [];

  const now = Date.now();
  const horizon = now + hoursAhead * 3600000;

  // Keep the in-progress hour (endTime > now) so "now" reflects the current period.
  const selected = periods
    .filter((p) => {
      const start = Date.parse(p.startTime);
      if (!Number.isFinite(start) || start > horizon) {
        return false;
      }
      const end = Date.parse(p.endTime);
      return Number.isFinite(end) ? end > now : start >= now;
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
