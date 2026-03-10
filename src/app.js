import { getCoordinatesFromZip } from "./api/zip.js";
import { getSolunarRange } from "./api/solunar.js";
import { getAepCurrent } from "./api/aep.js";
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

const MOON_PHASE_STYLES = [
  { pattern: /new/i, className: "moon-new", symbol: "New" },
  { pattern: /waxing crescent/i, className: "moon-waxing-crescent", symbol: "Wax +" },
  { pattern: /first quarter/i, className: "moon-first-quarter", symbol: "Half +" },
  { pattern: /waxing gibbous/i, className: "moon-waxing-gibbous", symbol: "Glow +" },
  { pattern: /full/i, className: "moon-full", symbol: "Full" },
  { pattern: /waning gibbous/i, className: "moon-waning-gibbous", symbol: "Glow -" },
  { pattern: /last quarter|third quarter/i, className: "moon-last-quarter", symbol: "Half -" },
  { pattern: /waning crescent/i, className: "moon-waning-crescent", symbol: "Wax -" },
];

function renderState(target, message, isError = false) {
  setHtml(target, `<p class="state ${isError ? "error" : ""}">${escapeHtml(message)}</p>`);
}

function getMoonPhaseDisplay(phase) {
  const match = MOON_PHASE_STYLES.find((item) => item.pattern.test(phase));
  return match ?? { className: "moon-generic", symbol: "Moon" };
}

function getSolunarHighlightMap(days) {
  const highlightMap = new Map(days.map((day, index) => [index, "normal"]));
  const anchorIndexes = days
    .map((day, index) => ({ phase: day.moonPhase, index }))
    .filter(({ phase }) => /^(full|new)\b/i.test(String(phase).trim()))
    .map(({ index }) => index);

  anchorIndexes.forEach((anchorIndex) => {
    for (let offset = -2; offset <= 2; offset += 1) {
      const targetIndex = anchorIndex + offset;
      if (targetIndex < 0 || targetIndex >= days.length) {
        continue;
      }
      const current = highlightMap.get(targetIndex);
      if (offset === 0) {
        highlightMap.set(targetIndex, "peak");
      } else if (current !== "peak") {
        highlightMap.set(targetIndex, "window");
      }
    }
  });

  return highlightMap;
}

function getSolunarHighlightMeta(level) {
  if (level === "peak") {
    return {
      className: "solunar-highlight-peak",
      label: "Peak day",
      description: "Full or New Moon",
    };
  }
  if (level === "window") {
    return {
      className: "solunar-highlight-window",
      label: "Prime window",
      description: "Within 2 days of Full or New Moon",
    };
  }
  return {
    className: "",
    label: "",
    description: "",
  };
}

function renderDataRows(rows) {
  return `<div class="data-rows">${rows
    .map(
      (row) => `<div class="data-row">
        <p class="data-label">${escapeHtml(row.label)}</p>
        <p class="data-value ${row.emphasis ? `data-value-${row.emphasis}` : ""}">${escapeHtml(
          row.value
        )}</p>
      </div>`
    )
    .join("")}</div>`;
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
      return `<li class="table-row-rich">
        <div class="table-time-block">
          <span class="table-time">${escapeHtml(time)}</span>
        </div>
        <div class="table-detail-block">
          <p class="table-main-value">${escapeHtml(String(p.temperature))}${escapeHtml(
            p.temperatureUnit
          )}</p>
          <p class="table-subdetail">Rain ${escapeHtml(rain)} | Wind ${escapeHtml(
            p.windSpeed
          )} ${escapeHtml(p.windDirection)}</p>
        </div>
      </li>`;
    })
    .join("");

  el.weatherUpdated.textContent = weather.updated
    ? `Updated ${formatUsDateTime(new Date(weather.updated), EASTERN_TIMEZONE)} ET`
    : "";
  setHtml(el.weatherContent, `<ul class="table-list table-list-rich">${rows}</ul>`);
}

function renderAep(aep) {
  const flow = `${aep.currentFlowCfs.toLocaleString()} cfs`;
  const releaseLag = aep.waterReleasedHoursOffset === null
    ? "Unknown"
    : `${aep.waterReleasedHoursOffset} hours`;
  const currentAsOf = aep.currentDateTime
    ? formatUsDateTime(new Date(aep.currentDateTime), EASTERN_TIMEZONE)
    : null;
  const generatedAt = aep.generatedAt
    ? formatUsDateTime(new Date(aep.generatedAt), EASTERN_TIMEZONE)
    : null;
  const checkpoints = aep.forecastCheckpoints.length
    ? `<ul class="table-list">${aep.forecastCheckpoints
        .map((point) => {
          const time = formatUsHour(new Date(point.timestamp), EASTERN_TIMEZONE);
          return `<li>
            <span class="table-time">${escapeHtml(point.label)}</span>
            <span class="table-detail">${escapeHtml(time)}: ${escapeHtml(
              point.flowCfs.toLocaleString()
            )} cfs</span>
          </li>`;
        })
        .join("")}</ul>`
    : `<p class="state">Forecast checkpoints unavailable.</p>`;

  el.aepUpdated.textContent = aep.lastUpdated
    ? `AEP data updated ${formatUsDateTime(new Date(aep.lastUpdated), EASTERN_TIMEZONE)} ET`
    : "AEP data updated time unavailable";

  setHtml(
    el.aepContent,
    `<div class="stat-grid stat-grid-elevated">
      <div class="stat-item">
        <p class="stat-label">Current Flow</p>
        <p class="stat-value">${escapeHtml(flow)}</p>
      </div>
      <div class="stat-item">
        <p class="stat-label">Release Lag</p>
        <p class="stat-value">${escapeHtml(releaseLag)}</p>
      </div>
    </div>
    <div class="card-section">
      <p class="section-label">Arrival outlook</p>
      <p class="supporting-copy">Current arrival estimate${currentAsOf ? ` at ${escapeHtml(
        currentAsOf
      )} ET` : ""}.</p>
      ${checkpoints}
    </div>
    <p class="card-meta">Source: <a href="${aep.sourceUrl}" target="_blank" rel="noreferrer">AEP Whitethorne Launch</a>${generatedAt ? ` | Synced ${escapeHtml(generatedAt)} ET` : ""}${aep.stale ? " | Data may be stale" : ""}</p>`
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
    `<div class="stat-grid stat-grid-elevated">
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

function renderMoonPhase(phase) {
  const moon = getMoonPhaseDisplay(phase);
  return `<div class="moon-phase">
    <span class="moon-badge ${moon.className}" aria-hidden="true">${escapeHtml(moon.symbol)}</span>
    <div>
      <p class="section-label">Moon phase</p>
      <p class="moon-phase-name">${escapeHtml(phase)}</p>
    </div>
  </div>`;
}

function renderSolunarTimingCard(title, timings, emphasis) {
  return `<section class="solunar-timing ${emphasis ? `solunar-timing-${emphasis}` : ""}">
    <p class="section-label">${escapeHtml(title)}</p>
    ${renderDataRows(timings)}
  </section>`;
}

function renderSolunar(days) {
  if (!days.length) {
    renderState(el.solunarContent, "No solunar days were returned.");
    return;
  }

  const highlightMap = getSolunarHighlightMap(days);
  const [today, ...rest] = days;
  const todayHighlight = getSolunarHighlightMeta(highlightMap.get(0));

  const todayHtml = `<section class="solunar-today ${todayHighlight.className}">
    <div class="solunar-today-header">
      <div>
        <p class="section-kicker">Best first read</p>
        <h3>${escapeHtml(formatDateLabel(today.date))}</h3>
        ${
          todayHighlight.label
            ? `<div class="solunar-highlight-pill ${todayHighlight.className}">
                <span>${escapeHtml(todayHighlight.label)}</span>
                <span>${escapeHtml(todayHighlight.description)}</span>
              </div>`
            : ""
        }
      </div>
      ${renderMoonPhase(today.moonPhase)}
    </div>
    <div class="solunar-today-grid">
      ${renderSolunarTimingCard(
        "Major periods",
        [
          { label: "Major 1", value: today.major1, emphasis: "major" },
          { label: "Major 2", value: today.major2, emphasis: "major" },
        ],
        "major"
      )}
      ${renderSolunarTimingCard(
        "Minor periods",
        [
          { label: "Minor 1", value: today.minor1, emphasis: "minor" },
          { label: "Minor 2", value: today.minor2, emphasis: "minor" },
        ],
        "minor"
      )}
    </div>
    <div class="solunar-meta-grid">
      <div class="meta-chip">
        <p class="section-label">Sun</p>
        <p class="meta-chip-value">${escapeHtml(today.sunrise)} to ${escapeHtml(today.sunset)}</p>
      </div>
      <div class="meta-chip">
        <p class="section-label">Moon</p>
        <p class="meta-chip-value">${escapeHtml(today.moonrise)} to ${escapeHtml(today.moonset)}</p>
      </div>
    </div>
  </section>`;

  const weekHtml = rest
    .map((day, restIndex) => {
      const moon = getMoonPhaseDisplay(day.moonPhase);
      const highlight = getSolunarHighlightMeta(highlightMap.get(restIndex + 1));
      return `<article class="solunar-day-card ${highlight.className}">
        <div class="solunar-day-top">
          <h4>${escapeHtml(formatDateLabel(day.date))}</h4>
          <span class="moon-badge ${moon.className}" aria-hidden="true">${escapeHtml(moon.symbol)}</span>
        </div>
        ${
          highlight.label
            ? `<div class="solunar-highlight-pill ${highlight.className}">
                <span>${escapeHtml(highlight.label)}</span>
                <span>${escapeHtml(highlight.description)}</span>
              </div>`
            : ""
        }
        <p class="solunar-phase-inline">${escapeHtml(day.moonPhase)}</p>
        ${renderDataRows([
          { label: "Major 1", value: day.major1, emphasis: "major" },
          { label: "Major 2", value: day.major2, emphasis: "major" },
          { label: "Minor 1", value: day.minor1, emphasis: "minor" },
          { label: "Minor 2", value: day.minor2, emphasis: "minor" },
        ])}
        <div class="solunar-day-meta">
          <p>Sun ${escapeHtml(day.sunrise)} to ${escapeHtml(day.sunset)}</p>
          <p>Moon ${escapeHtml(day.moonrise)} to ${escapeHtml(day.moonset)}</p>
        </div>
      </article>`;
    })
    .join("");

  setHtml(
    el.solunarContent,
    `<div class="solunar-layout">
      ${todayHtml}
      <section class="solunar-week">
        <div class="solunar-week-header">
          <p class="section-label">Coming up</p>
          <p class="supporting-copy">The next 6 days, kept compact for quick scanning.</p>
        </div>
        <div class="solunar-week-grid">${weekHtml}</div>
      </section>
    </div>`
  );
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
      getAepCurrent(),
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
