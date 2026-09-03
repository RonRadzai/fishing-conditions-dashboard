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

// Automated airport stations (AWOS) often omit the sky/weather text even when
// they report temperature and wind. Numbers come from the closest station that
// has them; the conditions text is borrowed from the closest station that
// reports one, so the description is never blank when a nearby station has it.
const OBSERVATION_STATION_CANDIDATES = 4;

async function fetchLatestObservation(station) {
  const stationId = station.properties?.stationIdentifier;
  if (!stationId) throw new Error("Station missing identifier.");
  const obsRes = await fetchWithTimeout(`https://api.weather.gov/stations/${stationId}/observations/latest`, {
    headers: { Accept: "application/geo+json" },
  }, WEATHER_TIMEOUT_MS);
  if (!obsRes.ok) throw new Error("NWS observation request failed.");
  const properties = (await obsRes.json()).properties || {};
  return { stationId, stationName: station.properties?.name || stationId, properties };
}

export async function getCurrentObservation(lat, lon) {
  const pointsData = await getPointsData(lat, lon);
  const stationsUrl = pointsData.properties?.observationStations;
  if (!stationsUrl) throw new Error("NWS points response missing observationStations.");

  const stationsRes = await fetchWithTimeout(stationsUrl, { headers: { Accept: "application/geo+json" } }, WEATHER_TIMEOUT_MS);
  if (!stationsRes.ok) throw new Error("NWS stations request failed.");

  const stationsData = await stationsRes.json();
  const stations = (stationsData.features || []).slice(0, OBSERVATION_STATION_CANDIDATES);
  if (!stations.length) throw new Error("No observation stations found.");

  const results = await Promise.allSettled(stations.map(fetchLatestObservation));
  const usable = results
    .filter((r) => r.status === "fulfilled" && r.value.properties.temperature?.value != null)
    .map((r) => r.value);
  const chosen = usable[0];
  if (!chosen) {
    const firstError = results.find((r) => r.status === "rejected");
    throw firstError ? firstError.reason : new Error("No usable observations found.");
  }
  const described = usable.find((o) => o.properties.textDescription) || null;

  const p = chosen.properties;

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
    textDescription:       described ? described.properties.textDescription : null,
    temperature:           toF(p.temperature?.value),
    windSpeed:             toMph(p.windSpeed?.value),
    windDirection:         toCardinal(p.windDirection?.value),
    windGust:              toMph(p.windGust?.value),
    barometricPressure:    toInHg(p.barometricPressure?.value),
    visibility:            toMiles(p.visibility?.value),
    relativeHumidity:      p.relativeHumidity?.value != null ? Math.round(p.relativeHumidity.value) : null,
    precipitationLastHour: toIn(p.precipitationLastHour?.value),
    timestamp:             p.timestamp || null,
    stationId:             chosen.stationId,
    stationName:           chosen.stationName,
    descriptionStationId:  described ? described.stationId : null,
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
