import { buildSolunarDates } from "../utils.js";

function normalizeSolunar(raw, yyyymmdd) {
  const year = yyyymmdd.slice(0, 4);
  const month = yyyymmdd.slice(4, 6);
  const day = yyyymmdd.slice(6, 8);
  const iso = `${year}-${month}-${day}T00:00:00`;

  return {
    date: new Date(iso),
    sunrise: raw.sunRise ?? "N/A",
    sunset: raw.sunSet ?? "N/A",
    moonrise: raw.moonRise ?? "N/A",
    moonset: raw.moonSet ?? "N/A",
    moonPhase: raw.moonPhase ?? "N/A",
    major1: raw.major1 ?? "N/A",
    major2: raw.major2 ?? "N/A",
    minor1: raw.minor1 ?? "N/A",
    minor2: raw.minor2 ?? "N/A",
  };
}

export async function getSolunarForDate(lat, lon, yyyymmdd, tz) {
  const endpoint = `https://api.solunar.org/solunar/${lat},${lon},${yyyymmdd},${tz}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Solunar request failed for ${yyyymmdd}.`);
  }
  const payload = await response.json();
  return normalizeSolunar(payload, yyyymmdd);
}

export async function getSolunarRange(lat, lon, tz, days = 7) {
  const dates = buildSolunarDates(days);
  const results = await Promise.all(dates.map((d) => getSolunarForDate(lat, lon, d, tz)));
  return results;
}
