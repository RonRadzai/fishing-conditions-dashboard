import { getCoordinatesFromZip } from "./api/zip.js";
import { getSolunarRange } from "./api/solunar.js";
import { getAepFlowWindow } from "./api/aep.js";
import { getUsgsRadfordLatest } from "./api/usgs.js";
import { getHourlyWeather } from "./api/weather.js";
import {
  EASTERN_TIMEZONE,
  escapeHtml,
  formatDateLabel,
  formatUsDateTime,
  formatUsHour,
  getLocalZip,
  getTzIntegerFromBrowser,
  saveLocalZip,
  setHtml,
} from "./utils.js";

const el = {
  locationSummary: document.querySelector("#location-summary"),
  zipForm: document.querySelector("#zip-form"),
  zipInput: document.querySelector("#zip-input"),
  zipMessage: document.querySelector("#zip-message"),
  weatherUpdated: document.querySelector("#weather-updated"),
  weatherContent: document.querySelector("#weather-content"),
  aepUpdated: document.querySelector("#aep-updated"),
  aepContent: document.querySelector("#aep-content"),
  usgsContent: document.querySelector("#usgs-content"),
  solunarContent: document.querySelector("#solunar-content"),
};

function renderState(target, message, isError = false) {
  setHtml(target, `<p class="state ${isError ? "error" : ""}">${escapeHtml(message)}</p>`);
}

function renderWeather(weather) {
  if (!weather.periods.length) {
    renderState(el.weatherContent, "No hourly weather periods were returned.");
    return;
  }

  const rows = weather.periods
    .map((p) => {
      const time = formatUsHour(new Date(p.startTime), EASTERN_TIMEZONE);
      const rain = p.rainChance === null || p.rainChance === undefined ? "N/A" : `${p.rainChance}%`;
      return `<li>
        <span class="table-time">${escapeHtml(time)}</span>
        <span class="table-detail">${escapeHtml(String(p.temperature))}${escapeHtml(
          p.temperatureUnit
        )}, rain ${escapeHtml(rain)}, wind ${escapeHtml(p.windSpeed)} ${escapeHtml(
          p.windDirection
        )}</span>
      </li>`;
    })
    .join("");

  el.weatherUpdated.textContent = weather.updated
    ? `Updated ${formatUsDateTime(new Date(weather.updated), EASTERN_TIMEZONE)} ET`
    : "";
  setHtml(el.weatherContent, `<ul class="table-list">${rows}</ul>`);
}

function buildChartSvg(hours) {
  const usable = hours.filter((h) => h.flow !== null);
  if (usable.length < 2) {
    return "";
  }

  const width = 420;
  const height = 110;
  const pad = 14;
  const values = usable.map((h) => h.flow);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const step = (width - pad * 2) / (usable.length - 1);

  const points = usable
    .map((h, i) => {
      const x = pad + i * step;
      const y = height - pad - ((h.flow - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaPoints = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  return `<svg class="mini-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="AEP flow trend">
    <polygon class="chart-area" points="${areaPoints}"></polygon>
    <polyline class="chart-line" points="${points}"></polyline>
  </svg>`;
}

function renderAep(aep) {
  const chart = buildChartSvg(aep.hours);
  const rows = aep.hours
    .map((h) => {
      const value = h.flow === null ? "N/A" : `${h.flow.toLocaleString()} cfs`;
      return `<li>
        <span class="table-time">${escapeHtml(h.label)}</span>
        <span class="table-detail">${escapeHtml(value)}</span>
      </li>`;
    })
    .join("");

  el.aepUpdated.textContent = `Last update: ${aep.lastUpdated} ET`;
  setHtml(
    el.aepContent,
    `${chart}<ul class="table-list">${rows}</ul><p class="card-meta">Source: <a href="${aep.sourceUrl}" target="_blank" rel="noreferrer">AEP Whitethorne</a></p>`
  );
}

function renderUsgs(usgs) {
  const flow = usgs.flow?.value !== null && usgs.flow?.value !== undefined
    ? `${usgs.flow.value.toLocaleString()} cfs`
    : "N/A";
  const level = usgs.gaugeHeight?.value !== null && usgs.gaugeHeight?.value !== undefined
    ? `${usgs.gaugeHeight.value} ft`
    : "N/A";

  setHtml(
    el.usgsContent,
    `<div class="stat-grid">
      <div class="stat-item">
        <p class="stat-label">Flow</p>
        <p class="stat-value">${escapeHtml(flow)}</p>
      </div>
      <div class="stat-item">
        <p class="stat-label">Gage Height</p>
        <p class="stat-value">${escapeHtml(level)}</p>
      </div>
    </div>
    <p class="card-meta">Reference station: USGS 03171000 (Radford, VA)</p>`
  );
}

function renderSolunar(days) {
  const cards = days
    .map(
      (d) => `<article class="solunar-day">
        <h3>${escapeHtml(formatDateLabel(d.date))}</h3>
        <p>Sunrise: ${escapeHtml(d.sunrise)} | Sunset: ${escapeHtml(d.sunset)}</p>
        <p>Moonrise: ${escapeHtml(d.moonrise)} | Moonset: ${escapeHtml(d.moonset)}</p>
        <p>Moon phase: ${escapeHtml(d.moonPhase)}</p>
        <p>Major: ${escapeHtml(d.major1)}, ${escapeHtml(d.major2)}</p>
        <p>Minor: ${escapeHtml(d.minor1)}, ${escapeHtml(d.minor2)}</p>
      </article>`
    )
    .join("");

  setHtml(el.solunarContent, `<div class="solunar-grid">${cards}</div>`);
}

async function loadDashboard(zip) {
  el.zipInput.value = zip;
  el.zipMessage.textContent = "";
  el.zipMessage.className = "message";

  renderState(el.weatherContent, "Loading weather...");
  renderState(el.aepContent, "Loading AEP flow...");
  renderState(el.usgsContent, "Loading USGS data...");
  renderState(el.solunarContent, "Loading solunar data...");
  el.weatherUpdated.textContent = "";
  el.aepUpdated.textContent = "";

  try {
    const location = await getCoordinatesFromZip(zip);
    el.locationSummary.textContent = `${location.city}, ${location.state} (${zip})`;
    saveLocalZip(zip);

    const tz = getTzIntegerFromBrowser();
    const [weatherResult, aepResult, usgsResult, solunarResult] = await Promise.allSettled([
      getHourlyWeather(location.lat, location.lon, 8),
      getAepFlowWindow(),
      getUsgsRadfordLatest(),
      getSolunarRange(location.lat, location.lon, tz, 7),
    ]);

    if (weatherResult.status === "fulfilled") {
      renderWeather(weatherResult.value);
    } else {
      renderState(el.weatherContent, `Weather error: ${weatherResult.reason.message}`, true);
    }

    if (aepResult.status === "fulfilled") {
      renderAep(aepResult.value);
    } else {
      setHtml(
        el.aepContent,
        `<p class="state error">AEP error: ${escapeHtml(
          aepResult.reason.message
        )}</p><p><a href="https://www.aep.com/recreation/hydro/whitethornelaunch/" target="_blank" rel="noreferrer">Open live Whitethorne page</a></p>`
      );
    }

    if (usgsResult.status === "fulfilled") {
      renderUsgs(usgsResult.value);
    } else {
      renderState(el.usgsContent, `USGS error: ${usgsResult.reason.message}`, true);
    }

    if (solunarResult.status === "fulfilled") {
      renderSolunar(solunarResult.value);
    } else {
      renderState(el.solunarContent, `Solunar error: ${solunarResult.reason.message}`, true);
    }
  } catch (error) {
    el.locationSummary.textContent = "Location unavailable";
    renderState(el.weatherContent, "Waiting for a valid ZIP.");
    renderState(el.aepContent, "Waiting for a valid ZIP.");
    renderState(el.usgsContent, "Waiting for a valid ZIP.");
    renderState(el.solunarContent, "Waiting for a valid ZIP.");
    el.zipMessage.textContent = error.message;
    el.zipMessage.className = "message error";
  }
}

function onZipSubmit(event) {
  event.preventDefault();
  const zip = el.zipInput.value.trim();
  if (!/^\d{5}$/.test(zip)) {
    el.zipMessage.textContent = "Please enter a 5-digit ZIP code.";
    el.zipMessage.className = "message error";
    return;
  }
  loadDashboard(zip);
}

el.zipForm.addEventListener("submit", onZipSubmit);
loadDashboard(getLocalZip());
