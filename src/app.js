import { getSolunarRange } from "./api/solunar.js";
import { getAepCurrent } from "./api/aep.js";
import { getUsgsRadfordLatest } from "./api/usgs.js";
import { getCurrentObservation, getHourlyWeather } from "./api/weather.js";
import {
  EASTERN_TIMEZONE,
  escapeHtml,
  formatDateLabel,
  formatUsDateTime,
  formatUsHour,
  getEasternTzInteger,
  getMoonPhaseFractionForDate,
  getMoonPhaseTypeFromText,
  setHtml,
} from "./utils.js";

const LOCATION = { city: "Blacksburg", state: "VA", lat: 37.2296, lon: -80.4139, zip: "24060" };

const STATIC_TTL_MS = 10 * 60 * 1000;

const el = {
  locationSummary: document.querySelector("#location-summary"),
  weatherMeta: document.querySelector("#weather-meta"),
  weatherUpdated: document.querySelector("#weather-updated"),
  weatherContent: document.querySelector("#weather-content"),
  aepUpdated: document.querySelector("#aep-updated"),
  aepContent: document.querySelector("#aep-content"),
  usgsContent: document.querySelector("#usgs-content"),
  solunarMeta: document.querySelector("#solunar-meta"),
  solunarContent: document.querySelector("#solunar-content"),
  qvContent: document.querySelector("#qv-content"),
};

const cache = {
  aep: {
    value: null,
    fetchedAt: 0,
    promise: null,
  },
  usgs: {
    value: null,
    fetchedAt: 0,
    promise: null,
  },
};

const state = {
  activeLoadId: 0,
  expandedFutureIndex: null,
  solunar: null,
  aep: null,
  usgs: null,
  weather: null,
  observation: null,
};

function renderState(target, message, isError = false) {
  setHtml(target, `<p class="state ${isError ? "error" : ""}">${escapeHtml(message)}</p>`);
}

function isActiveRequest(loadId) {
  return state.activeLoadId === loadId;
}

function getMoonLitMarkup(phaseFraction) {
  const normalizedPhase = ((phaseFraction % 1) + 1) % 1;
  const cx = 20, cy = 20, R = 18;
  const topY = cy - R;
  const botY = cy + R;

  if (normalizedPhase <= 0.01 || normalizedPhase >= 0.99) {
    return "";
  }
  if (Math.abs(normalizedPhase - 0.5) <= 0.01) {
    return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#F6E7B0"/>`;
  }
  if (normalizedPhase < 0.5) {
    const rx = (R * Math.abs(Math.cos(2 * Math.PI * normalizedPhase))).toFixed(2);
    const sweep = normalizedPhase < 0.25 ? 0 : 1;
    return `<path d="M${cx},${topY} A${R},${R} 0 0 1 ${cx},${botY} A${rx},${R} 0 0 ${sweep} ${cx},${topY}Z" fill="#F6E7B0"/>`;
  }

  const wf = normalizedPhase - 0.5;
  const rx = (R * Math.abs(Math.cos(2 * Math.PI * wf))).toFixed(2);
  const sweep = wf < 0.25 ? 0 : 1;
  return `<path d="M${cx},${topY} A${R},${R} 0 0 0 ${cx},${botY} A${rx},${R} 0 0 ${sweep} ${cx},${topY}Z" fill="#F6E7B0"/>`;
}

function renderMoonPhaseIcon(phaseFraction, className = "") {
  const classes = ["moon-icon", className].filter(Boolean).join(" ");

  return `<span class="${classes}" aria-hidden="true">
    <svg viewBox="0 0 40 40" class="moon-svg">
      <circle cx="20" cy="20" r="18" fill="#0E1625"/>
      ${getMoonLitMarkup(phaseFraction)}
      <circle cx="20" cy="20" r="18" fill="none" stroke="#FFF6D8" stroke-width="0.8" opacity="0.4"/>
    </svg>
  </span>`;
}

function isMajorMoonPhaseDay(day) {
  if (!day) {
    return false;
  }
  if (day.moonPhaseType === "full" || day.moonPhaseType === "new") {
    return true;
  }
  if (!Object.prototype.hasOwnProperty.call(day, "moonPhaseType")) {
    return Boolean(getMoonPhaseTypeFromText(day.moonPhase));
  }
  return false;
}

function getDisplayMoonPhaseFraction(day) {
  if (day?.moonPhaseType === "new") {
    return 0;
  }
  if (day?.moonPhaseType === "full") {
    return 0.5;
  }
  return getMoonPhaseFractionForDate(day.dateYmd);
}

function renderMoonIconSm(phaseFraction) {
  return renderMoonPhaseIcon(phaseFraction, "moon-icon-sm");
}

function getSolunarHighlightMap(days) {
  const highlightMap = new Map(days.map((_, index) => [index, "normal"]));
  const anchorIndexes = days
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => isMajorMoonPhaseDay(day))
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
      label: "Best day",
      description: "Full or New Moon",
      isPeak: true,
    };
  }
  if (level === "window") {
    return {
      className: "solunar-highlight-window",
      label: "Prime window",
      description: "Within 2 days of Full or New Moon",
      isPeak: false,
    };
  }
  return {
    className: "",
    label: "",
    description: "",
    isPeak: false,
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

function renderHighlightPill(meta) {
  if (!meta.label) {
    return "";
  }

  return `<div class="solunar-highlight-pill ${meta.className}">
    ${meta.isPeak ? `<span class="solunar-peak-star" aria-hidden="true">&#9733;</span>` : ""}
    <span>${escapeHtml(meta.label)}</span>
    <span>${escapeHtml(meta.description)}</span>
  </div>`;
}

function renderSolunarTriggerPill(highlight) {
  if (!highlight.label) {
    return "";
  }

  return `<span class="solunar-trigger-pill ${highlight.className}">
    ${highlight.isPeak ? `<span class="solunar-peak-star" aria-hidden="true">&#9733;</span>` : ""}
    <span>${escapeHtml(highlight.label)}</span>
  </span>`;
}

function parsePeriodStartTime(rangeStr, todayYmd) {
  if (!rangeStr) return null;
  const parts = rangeStr.split(" - ");
  if (!parts.length) return null;
  const timeStr = parts[0].trim();
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(timeStr);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (meridiem === "AM") {
    if (hours === 12) hours = 0;
  } else {
    if (hours !== 12) hours += 12;
  }

  const tzOffset = getEasternTzInteger(new Date());
  const year = Number(todayYmd.slice(0, 4));
  const month = Number(todayYmd.slice(4, 6)) - 1;
  const day = Number(todayYmd.slice(6, 8));
  return new Date(Date.UTC(year, month, day, hours - tzOffset, minutes, 0));
}

function parsePeriodEndTime(rangeStr, todayYmd) {
  if (!rangeStr) return null;
  const parts = rangeStr.split(" - ");
  if (parts.length < 2) return null;
  const timeStr = parts[1].trim();
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(timeStr);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (meridiem === "AM") {
    if (hours === 12) hours = 0;
  } else {
    if (hours !== 12) hours += 12;
  }

  const tzOffset = getEasternTzInteger(new Date());
  const year = Number(todayYmd.slice(0, 4));
  const month = Number(todayYmd.slice(4, 6)) - 1;
  const day = Number(todayYmd.slice(6, 8));
  return new Date(Date.UTC(year, month, day, hours - tzOffset, minutes, 0));
}

function formatCountdown(diffMs) {
  if (diffMs < 60000) return "now";
  if (diffMs < 3600000) return `in ${Math.floor(diffMs / 60000)}m`;
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

function getUpcomingSolunarPeriods(todayData) {
  if (!todayData) return [];
  const now = Date.now();
  const ymd = todayData.dateYmd;
  const periods = [
    { label: "Maj 1", range: todayData.major1, type: "major" },
    { label: "Maj 2", range: todayData.major2, type: "major" },
    { label: "Min 1", range: todayData.minor1, type: "minor" },
    { label: "Min 2", range: todayData.minor2, type: "minor" },
  ];

  return periods
    .map((p) => ({
      ...p,
      startTime: parsePeriodStartTime(p.range, ymd),
      endTime: parsePeriodEndTime(p.range, ymd),
    }))
    .filter((p) => {
      if (!p.startTime) return false;
      const cutoff = p.endTime ? p.endTime.getTime() + 30 * 60000 : p.startTime.getTime();
      return cutoff > now;
    })
    .sort((a, b) => a.startTime - b.startTime)
    .map((p) => {
      const countdown = p.startTime.getTime() > now
        ? formatCountdown(p.startTime.getTime() - now)
        : "active";
      return { ...p, countdown };
    });
}

function renderQuickView(aep, weather, solunar, observation) {
  const today = solunar ? (solunar.days.find((d) => d.dateYmd === solunar.startDate) ?? null) : null;
  const phaseFraction = today ? getDisplayMoonPhaseFraction(today) : null;
  const todayIndex = solunar ? solunar.days.findIndex((d) => d.dateYmd === solunar.startDate) : -1;
  const highlight = solunar && todayIndex >= 0
    ? getSolunarHighlightMeta(getSolunarHighlightMap(solunar.days).get(todayIndex))
    : { className: "", label: "", description: "" };

  // Moon conditions
  const moonIcon = phaseFraction !== null ? renderMoonPhaseIcon(phaseFraction) : "";
  const moonPhase = today ? escapeHtml(today.moonPhase) : "--";
  const moonGroup = `<div class="qv-group qv-group-moon" aria-label="Moon and solunar conditions">
    <p class="qv-group-label">Moon</p>
    <div class="qv-moon-row">
    ${moonIcon}
      <div class="qv-moon-info">
        <span class="qv-moon-phase">${moonPhase}</span>
        ${renderHighlightPill(highlight)}
      </div>
    </div>
  </div>`;

  // Current conditions
  const flowVal = aep ? aep.currentFlowCfs.toLocaleString() : "--";
  const nowWeather = weather && weather.periods.length ? weather.periods[0] : null;
  const tempVal = nowWeather ? `${nowWeather.temperature}°` : "--";
  const tempUnit = nowWeather ? nowWeather.temperatureUnit : "";
  const windVal = nowWeather ? nowWeather.windSpeed : "--";
  const windDir = nowWeather ? nowWeather.windDirection : "";
  const conditionText = observation ? escapeHtml(observation.textDescription || "--") : "";
  const humidityVal = observation && observation.relativeHumidity != null ? `${observation.relativeHumidity}` : "--";
  const pressureVal = observation && observation.barometricPressure != null ? `${observation.barometricPressure}` : "--";
  const currentConditions = `<div class="qv-snapshot">
    ${moonGroup}
    <div class="qv-group qv-group-river" aria-label="River conditions">
      <p class="qv-group-label">River</p>
      <div class="qv-readout">
        <span class="qv-label">Current flow</span>
        <span class="qv-value-line"><span class="qv-val">${escapeHtml(flowVal)}</span><span class="qv-unit">cfs</span></span>
      </div>
    </div>
    <div class="qv-group qv-group-weather" aria-label="Weather conditions">
      <p class="qv-group-label">Weather</p>
      ${conditionText ? `<p class="qv-cond-text">${conditionText}</p>` : ""}
      <div class="qv-weather-metrics">
        <div class="qv-readout">
          <span class="qv-label">Air temp</span>
          <span class="qv-value-line"><span class="qv-val">${escapeHtml(tempVal)}</span><span class="qv-unit">${escapeHtml(tempUnit || "F")}</span></span>
        </div>
        <div class="qv-readout">
          <span class="qv-label">Wind</span>
          <span class="qv-value-line"><span class="qv-val">${escapeHtml(windVal)}</span><span class="qv-unit">${escapeHtml(windDir || "--")}</span></span>
        </div>
        <div class="qv-readout">
          <span class="qv-label">Humidity</span>
          <span class="qv-value-line"><span class="qv-val">${escapeHtml(humidityVal)}</span><span class="qv-unit">%</span></span>
        </div>
        <div class="qv-readout">
          <span class="qv-label">Pressure</span>
          <span class="qv-value-line"><span class="qv-val">${escapeHtml(pressureVal)}</span><span class="qv-unit">inHg</span></span>
        </div>
      </div>
    </div>
  </div>`;

  // Periods
  const upcoming = today ? getUpcomingSolunarPeriods(today) : [];
  let periodsHtml;
  if (upcoming.length) {
    periodsHtml = upcoming.map((p) => `<div class="qv-period qv-period--${p.type}">
      <span class="qv-period-name">${escapeHtml(p.label)}</span>
      <span class="qv-period-range">${escapeHtml(p.range)}</span>
      <span class="qv-period-cd">${escapeHtml(p.countdown)}</span>
    </div>`).join("");
  } else {
    let hint = "";
    if (solunar && solunar.days[1]) {
      const tomorrow = solunar.days[1];
      const tomorrowFirst = parsePeriodStartTime(tomorrow.major1, tomorrow.dateYmd);
      if (tomorrowFirst) {
        hint = ` — tomorrow Maj 1 at ${formatUsHour(tomorrowFirst)}`;
      }
    }
    periodsHtml = `<p class="qv-done">Done for today${escapeHtml(hint)}</p>`;
  }

  const periodsSection = `<div class="qv-periods">
    <p class="qv-next-label">moon windows</p>
    ${periodsHtml}
  </div>`;

  // Footer
  const sunTimes = today ? `${escapeHtml(today.sunrise)} – ${escapeHtml(today.sunset)}` : "--";
  const freshnessStatus = aep && aep.stale
    ? `<span class="summary-status is-stale">Stale</span>`
    : "";
  const footer = `<div class="qv-footer">
    <span class="qv-sun"><span class="qv-sun-label">☀ sunrise – sunset</span><span class="qv-sun-times">${sunTimes}</span></span>
    ${freshnessStatus}
  </div>`;

  setHtml(el.qvContent, currentConditions + periodsSection + footer);
}

function updateLocationLabels() {
  el.locationSummary.textContent = `${LOCATION.city}, ${LOCATION.state}`;
  el.weatherMeta.textContent = `${LOCATION.city} | Now + 8h ET`;
  el.solunarMeta.textContent = `7 days | ET`;
}

function renderFlowGraph(aep) {
  const pts = aep.forecastCheckpoints;
  if (!pts || pts.length < 1) return "";

  const W = 480, H = 160;
  const padL = 14, padR = 14, padT = 28, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;

  const n = pts.length;
  const gap = 8;
  const barW = (plotW - gap * (n - 1)) / n;

  const maxF = Math.max(...pts.map((p) => p.flowCfs));

  const barsHtml = pts.map((p, i) => {
    const barH = (p.flowCfs / maxF) * plotH;
    const x = (padL + i * (barW + gap)).toFixed(1);
    const y = (baseY - barH).toFixed(1);
    const isNow = p.label === "Now";
    const valueLabelY = (baseY - barH - 5).toFixed(1);
    return (
      `<rect x="${x}" y="${y}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" class="${isNow ? "flow-bar flow-bar-now" : "flow-bar"}"/>` +
      `<text x="${(padL + i * (barW + gap) + barW / 2).toFixed(1)}" y="${valueLabelY}" text-anchor="middle" class="graph-value">${p.flowCfs.toLocaleString()}</text>` +
      `<text x="${(padL + i * (barW + gap) + barW / 2).toFixed(1)}" y="${(baseY + 16).toFixed(1)}" text-anchor="middle" class="graph-axis">${escapeHtml(p.label)}</text>`
    );
  }).join("");

  const baselineHtml = `<line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" class="graph-grid"/>`;

  return `<div class="flow-graph">
  <p class="section-label">Flow Forecast <span class="graph-unit">cfs</span></p>
  <svg viewBox="0 0 ${W} ${H}" class="forecast-chart" role="img" aria-label="River flow forecast">
    ${baselineHtml}
    ${barsHtml}
  </svg>
</div>`;
}

function renderWeather(weather, observation = null) {
  if (!weather.periods.length) {
    renderState(el.weatherContent, "No hourly weather periods were returned.");
    return;
  }

  let obsHtml = "";
  if (observation) {
    const wind = observation.windSpeed != null
      ? `${observation.windSpeed} mph ${observation.windDirection || ""}${observation.windGust ? ` · Gusts ${observation.windGust} mph` : ""}`
      : null;
    const details = [
      wind,
      observation.barometricPressure ? `${observation.barometricPressure} inHg` : null,
      observation.visibility ? `${observation.visibility} mi visibility` : null,
      observation.relativeHumidity != null ? `${observation.relativeHumidity}% humidity` : null,
      observation.precipitationLastHour && parseFloat(observation.precipitationLastHour) > 0
        ? `${observation.precipitationLastHour}" last hr` : null,
    ].filter(Boolean);

    obsHtml = `<div class="obs-block">
      <div class="obs-main">
        ${observation.textDescription ? `<p class="obs-description">${escapeHtml(observation.textDescription)}</p>` : ""}
        ${observation.temperature != null ? `<p class="obs-temp">${escapeHtml(String(observation.temperature))}°F</p>` : ""}
      </div>
      ${details.length ? `<p class="obs-details">${details.map(escapeHtml).join(" · ")}</p>` : ""}
    </div>`;
  }

  const rows = weather.periods
    .map((period) => {
      const time = formatUsHour(new Date(period.startTime), EASTERN_TIMEZONE);
      const rain = period.rainChance === null || period.rainChance === undefined
        ? "N/A"
        : `${period.rainChance}%`;

      const gust = period.windGust ? ` · Gusts ${escapeHtml(period.windGust)}` : "";
      const forecast = period.shortForecast
        ? `<p class="table-forecast">${escapeHtml(period.shortForecast)}</p>`
        : "";

      return `<li class="table-row-rich">
        <div class="table-time-block">
          <span class="table-time">${escapeHtml(time)}</span>
        </div>
        <div class="table-detail-block">
          <p class="table-main-value">${escapeHtml(String(period.temperature))}${escapeHtml(period.temperatureUnit)}</p>
          <p class="table-subdetail">Rain ${escapeHtml(rain)} · Wind ${escapeHtml(period.windSpeed)} ${escapeHtml(period.windDirection)}${gust}</p>
          ${forecast}
        </div>
      </li>`;
    })
    .join("");

  el.weatherUpdated.textContent = weather.updated
    ? `Updated ${formatUsDateTime(new Date(weather.updated), EASTERN_TIMEZONE)} ET`
    : "";
  setHtml(el.weatherContent, obsHtml + `<ul class="table-list table-list-rich">${rows}</ul>`);
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
  const flowGraph = aep.forecastCheckpoints.length
    ? renderFlowGraph(aep)
    : `<p class="state">Forecast unavailable.</p>`;

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
    ${flowGraph}
    <p class="card-meta">Source: <a href="${aep.sourceUrl}" target="_blank" rel="noreferrer">AEP Whitethorne Launch</a>${generatedAt ? ` | Synced ${escapeHtml(generatedAt)} ET` : ""}${currentAsOf ? ` | As of ${escapeHtml(currentAsOf)} ET` : ""}${aep.stale ? " | Data may be stale" : ""}</p>`
  );
}

function renderUsgs(usgs) {
  const flow = usgs.flow?.value !== null && usgs.flow?.value !== undefined
    ? `${usgs.flow.value.toLocaleString()} cfs`
    : "N/A";
  const level = usgs.gaugeHeight?.value !== null && usgs.gaugeHeight?.value !== undefined
    ? `${usgs.gaugeHeight.value} ft`
    : "N/A";
  const latest = usgs.flow?.dateTime || usgs.gaugeHeight?.dateTime
    ? formatUsDateTime(new Date(usgs.flow?.dateTime || usgs.gaugeHeight?.dateTime), EASTERN_TIMEZONE)
    : null;

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
    <p class="card-meta">${latest ? `Latest ${escapeHtml(latest)} ET` : ""}</p>`
  );
}

function getTodaySolunar(solunar) {
  if (!solunar) {
    return null;
  }
  return solunar.days.find((day) => day.dateYmd === solunar.startDate) ?? null;
}

function renderSolunarTimingCard(title, timings, emphasis) {
  return `<section class="solunar-timing ${emphasis ? `solunar-timing-${emphasis}` : ""}">
    <p class="section-label">${escapeHtml(title)}</p>
    ${renderDataRows(timings)}
  </section>`;
}

function renderTodaySolunarCard(today, todayHighlight) {
  const phaseFraction = getDisplayMoonPhaseFraction(today);
  const timingHtml = today.isMissing
    ? `<p class="state error">Solunar timing unavailable for this date.</p>`
    : `<div class="solunar-today-grid">
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
    </div>`;

  return `<section class="solunar-today ${todayHighlight.className}">
    <div class="solunar-today-header">
      <div>
        <h3>${escapeHtml(formatDateLabel(today.dateYmd))}</h3>
        <div class="solunar-phase-row">
          ${renderMoonIconSm(phaseFraction)}
          <p class="solunar-phase-inline">${escapeHtml(today.moonPhase)}</p>
        </div>
      </div>
      ${renderHighlightPill(todayHighlight)}
    </div>
    <div class="solunar-meta-grid solunar-meta-grid-wide">
      <div class="meta-chip">
        <p class="section-label">Sun</p>
        <p class="meta-chip-value">${escapeHtml(today.sunrise)} to ${escapeHtml(today.sunset)}</p>
      </div>
      <div class="meta-chip">
        <p class="section-label">Moon</p>
        <p class="meta-chip-value">${escapeHtml(today.moonrise)} to ${escapeHtml(today.moonset)}</p>
      </div>
    </div>
    ${timingHtml}
  </section>`;
}

function renderFutureSolunarItem(day, index, highlight) {
  const isOpen = state.expandedFutureIndex === index;
  const panelId = `solunar-day-panel-${index}`;
  const phaseFraction = getDisplayMoonPhaseFraction(day);
  const bodyHtml = day.isMissing
    ? `<p class="state error">Solunar timing unavailable for this date.</p>`
    : `${renderDataRows([
        { label: "Major 1", value: day.major1, emphasis: "major" },
        { label: "Major 2", value: day.major2, emphasis: "major" },
        { label: "Minor 1", value: day.minor1, emphasis: "minor" },
        { label: "Minor 2", value: day.minor2, emphasis: "minor" },
      ])}
      <div class="solunar-day-meta">
        <p>Sun ${escapeHtml(day.sunrise)} to ${escapeHtml(day.sunset)}</p>
        <p>Moon ${escapeHtml(day.moonrise)} to ${escapeHtml(day.moonset)}</p>
      </div>`;

  return `<article class="solunar-day-card ${highlight.className} ${isOpen ? "is-open" : ""}">
    <button
      type="button"
      class="solunar-day-trigger"
      data-solunar-toggle="${index}"
      aria-expanded="${isOpen}"
      aria-controls="${panelId}"
    >
      <div class="solunar-day-heading">
        <h4>${escapeHtml(formatDateLabel(day.dateYmd))}</h4>
        <div class="solunar-phase-row">
          ${renderMoonIconSm(phaseFraction)}
          <p class="solunar-phase-inline">${escapeHtml(day.moonPhase)}</p>
        </div>
      </div>
      <div class="solunar-day-trigger-meta">
        ${renderSolunarTriggerPill(highlight)}
        <span class="solunar-chevron" aria-hidden="true">${isOpen ? "−" : "+"}</span>
      </div>
    </button>
    <div id="${panelId}" class="solunar-day-body" ${isOpen ? "" : "hidden"}>
      ${bodyHtml}
    </div>
  </article>`;
}

function renderSolunar(solunar) {
  const today = getTodaySolunar(solunar);
  const futureDays = solunar.days.filter((day) => day.dateYmd !== solunar.startDate);

  if (!today && !futureDays.length) {
    renderState(el.solunarContent, "No solunar days were returned.", true);
    return;
  }

  const highlightMap = getSolunarHighlightMap(solunar.days);
  const todayIndex = solunar.days.findIndex((day) => day.dateYmd === solunar.startDate);
  const todayHighlight = getSolunarHighlightMeta(highlightMap.get(todayIndex));
  const missingToday = solunar.missingDates.includes(solunar.startDate);
  const futureMissingCount = solunar.missingDates.filter((dateYmd) => dateYmd !== solunar.startDate).length;
  const todayHtml = today
    ? renderTodaySolunarCard(today, todayHighlight)
    : `<section class="solunar-today">
        <h3>${escapeHtml(formatDateLabel(solunar.startDate))}</h3>
        <p class="state error">Today's solunar data is unavailable.</p>
      </section>`;

  const futureHtml = futureDays
    .map((day, futureIndex) => {
      const currentIndex = solunar.days.findIndex((item) => item.dateYmd === day.dateYmd);
      const highlight = getSolunarHighlightMeta(highlightMap.get(currentIndex));
      return renderFutureSolunarItem(day, futureIndex, highlight);
    })
    .join("");

  setHtml(
    el.solunarContent,
    `<div class="solunar-layout">
      ${todayHtml}
      <section class="solunar-week">
        <div class="solunar-week-header">
          <div>
            <p class="section-label">Next 6 Days</p>
          </div>
          ${
            missingToday || futureMissingCount
              ? `<p class="solunar-note">Unavailable: ${missingToday ? "today" : ""}${missingToday && futureMissingCount ? " + " : ""}${futureMissingCount ? `${futureMissingCount} future day${futureMissingCount === 1 ? "" : "s"}` : ""}</p>`
              : `<p class="solunar-note">All times Eastern</p>`
          }
        </div>
        <div class="solunar-accordion">${futureHtml || `<p class="state">No future days available.</p>`}</div>
      </section>
    </div>`
  );
}

async function getCachedResource(key, loader) {
  const entry = cache[key];
  const now = Date.now();
  if (entry.value && now - entry.fetchedAt < STATIC_TTL_MS) {
    return entry.value;
  }

  if (entry.promise) {
    return entry.promise;
  }

  entry.promise = loader()
    .then((value) => {
      entry.value = value;
      entry.fetchedAt = Date.now();
      return value;
    })
    .catch((error) => {
      if (entry.value) {
        return entry.value;
      }
      throw error;
    })
    .finally(() => {
      entry.promise = null;
    });

  return entry.promise;
}

function renderInitialLoadingState() {
  renderState(el.qvContent, "Loading...");
  renderState(el.weatherContent, "Loading...");
  renderState(el.solunarContent, "Loading...");
  renderState(el.aepContent, "Loading...");
  renderState(el.usgsContent, "Loading...");
  el.weatherUpdated.textContent = "";
  el.aepUpdated.textContent = "";
}

async function loadDashboard() {
  const loadId = ++state.activeLoadId;
  state.expandedFutureIndex = null;
  state.solunar = null;
  state.weather = null;
  state.observation = null;
  renderInitialLoadingState();
  updateLocationLabels();

  const [staticResults, weatherResult, solunarResult, observationResult] = await Promise.all([
    Promise.allSettled([
      getCachedResource("aep", getAepCurrent),
      getCachedResource("usgs", getUsgsRadfordLatest),
    ]),
    getHourlyWeather(LOCATION.lat, LOCATION.lon, 8).then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason })
    ),
    getSolunarRange(LOCATION.lat, LOCATION.lon, null, 7).then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason })
    ),
    getCurrentObservation(LOCATION.lat, LOCATION.lon).then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason })
    ),
  ]);

  if (!isActiveRequest(loadId)) {
    return;
  }

  const [aepResult, usgsResult] = staticResults;

  if (aepResult.status === "fulfilled") {
    state.aep = aepResult.value;
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
    state.usgs = usgsResult.value;
    renderUsgs(usgsResult.value);
  } else {
    renderState(el.usgsContent, `USGS error: ${usgsResult.reason.message}`, true);
  }

  if (observationResult.status === "fulfilled") {
    state.observation = observationResult.value;
  }

  if (weatherResult.status === "fulfilled") {
    state.weather = weatherResult.value;
    renderWeather(weatherResult.value, state.observation);
  } else {
    renderState(el.weatherContent, `Weather error: ${weatherResult.reason.message}`, true);
  }

  if (solunarResult.status === "fulfilled") {
    state.solunar = solunarResult.value;
    renderSolunar(solunarResult.value);
  } else {
    renderState(el.solunarContent, `Solunar error: ${solunarResult.reason.message}`, true);
  }

  renderQuickView(state.aep, state.weather, state.solunar, state.observation);

  setInterval(() => {
    if (state.solunar) renderQuickView(state.aep, state.weather, state.solunar, state.observation);
  }, 60000);
}

function onSolunarToggle(event) {
  const button = event.target.closest("[data-solunar-toggle]");
  if (!button || !state.solunar) {
    return;
  }

  const index = Number(button.dataset.solunarToggle);
  if (!Number.isInteger(index)) {
    return;
  }

  state.expandedFutureIndex = state.expandedFutureIndex === index ? null : index;
  renderSolunar(state.solunar);
}

el.solunarContent.addEventListener("click", onSolunarToggle);
loadDashboard();
