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
    })),
  };
}
