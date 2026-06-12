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
  getMoonPhaseFractionForDate,
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
  weather: null,
  observation: null,
};

let quickViewRefreshId = null;

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
  return day?.moonPhaseType === "full" || day?.moonPhaseType === "new";
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
  const highlightMap = new Map(days.map((_, index) => [index, { level: "normal", phase: null }]));

  days.forEach((day, anchorIndex) => {
    if (!isMajorMoonPhaseDay(day)) {
      return;
    }
    for (let offset = -2; offset <= 2; offset += 1) {
      const targetIndex = anchorIndex + offset;
      if (targetIndex < 0 || targetIndex >= days.length) {
        continue;
      }
      if (offset === 0) {
        highlightMap.set(targetIndex, { level: "peak", phase: day.moonPhaseType });
      } else if (highlightMap.get(targetIndex).level !== "peak") {
        highlightMap.set(targetIndex, { level: "window", phase: day.moonPhaseType });
      }
    }
  });

  return highlightMap;
}

function getSolunarHighlightMeta(highlight) {
  const phaseName = highlight?.phase === "new"
    ? "New Moon"
    : highlight?.phase === "full"
      ? "Full Moon"
      : "Full or New Moon";

  if (highlight?.level === "peak") {
    return {
      className: "solunar-highlight-peak",
      label: "Best day",
      description: phaseName,
      isPeak: true,
    };
  }
  if (highlight?.level === "window") {
    return {
      className: "solunar-highlight-window",
      label: "Prime window",
      description: `Within 2 days of ${phaseName}`,
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

function formatCountdown(diffMs) {
  if (diffMs < 60000) return "now";
  if (diffMs < 3600000) return `in ${Math.floor(diffMs / 60000)}m`;
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

function getUpcomingSolunarPeriods(todayData) {
  if (!todayData?.periods?.length) return [];
  const now = Date.now();

  return todayData.periods
    .filter((p) => p.end + 30 * 60000 > now)
    .map((p) => ({
      label: `${p.type === "major" ? "Maj" : "Min"} ${p.index}`,
      type: p.type,
      range: p.range,
      countdown: p.start > now ? formatCountdown(p.start - now) : "active",
    }));
}

function renderQuickView(aep, weather, solunar, observation) {
  const today = getTodaySolunar(solunar);
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
  const upcoming = today && !today.isMissing ? getUpcomingSolunarPeriods(today) : [];
  let periodsHtml;
  if (today?.isMissing) {
    periodsHtml = `<p class="qv-done">Solunar timing unavailable.</p>`;
  } else if (upcoming.length) {
    periodsHtml = upcoming.map((p) => `<div class="qv-period qv-period--${p.type}">
      <span class="qv-period-name">${escapeHtml(p.label)}</span>
      <span class="qv-period-range">${escapeHtml(p.range)}</span>
      <span class="qv-period-cd">${escapeHtml(p.countdown)}</span>
    </div>`).join("");
  } else {
    let hint = "";
    const tomorrowFirstMajor = solunar?.days[1]?.periods?.find((p) => p.type === "major");
    if (tomorrowFirstMajor) {
      hint = ` — tomorrow Maj 1 at ${formatUsHour(new Date(tomorrowFirstMajor.start))}`;
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

function interpolateFlowAt(points, timestamp) {
  if (timestamp <= points[0].timestamp) return points[0].flowCfs;
  const last = points[points.length - 1];
  if (timestamp >= last.timestamp) return last.flowCfs;

  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (timestamp <= right.timestamp) {
      const ratio = (timestamp - left.timestamp) / (right.timestamp - left.timestamp);
      return left.flowCfs + (right.flowCfs - left.flowCfs) * ratio;
    }
  }
  return last.flowCfs;
}

function formatGraphHour(date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: EASTERN_TIMEZONE }).format(date);
}

const FLOW_GRAPH_INITIAL_PAST_MS = 2 * 3600000;
const FLOW_GRAPH_PX_PER_HOUR = 60;

// Line graph of the dam-release pulse train (like aep.com's chart):
// the full series at a fixed hourly scale inside a horizontal scroller,
// past flows light, forecast dark, dashed marker at the current time.
// The y-axis lives in a separate svg so it stays put while scrolling.
function renderFlowGraph(aep) {
  const allPoints = (aep.forecastPoints ?? []).filter(
    (p) => Number.isFinite(p?.timestamp) && Number.isFinite(p?.flowCfs)
  );
  if (allPoints.length < 2) return "";

  const firstTs = allPoints[0].timestamp;
  const lastTs = allPoints[allPoints.length - 1].timestamp;
  if (lastTs <= firstTs) return "";
  const now = Math.min(Math.max(Date.now(), firstTs), lastTs);

  const nowPoint = { timestamp: now, flowCfs: interpolateFlowAt(allPoints, now) };
  const past = allPoints.filter((p) => p.timestamp < now).concat(nowPoint);
  const future = [nowPoint, ...allPoints.filter((p) => p.timestamp > now)];

  const hourMs = 3600000;
  const H = 190;
  const axisW = 30;
  const padL = 4, padR = 10, padT = 18, padB = 22;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;
  const svgW = Math.ceil(padL + ((lastTs - firstTs) / hourMs) * FLOW_GRAPH_PX_PER_HOUR + padR);
  const yMax = Math.max(1000, Math.ceil(Math.max(...allPoints.map((p) => p.flowCfs)) / 1000) * 1000);
  const xOf = (t) => padL + ((t - firstTs) / hourMs) * FLOW_GRAPH_PX_PER_HOUR;
  const yOf = (f) => baseY - (f / yMax) * plotH;
  const lineOf = (pts) =>
    pts.map((p, i) => `${i ? "L" : "M"}${xOf(p.timestamp).toFixed(1)},${yOf(p.flowCfs).toFixed(1)}`).join(" ");
  const areaOf = (pts) =>
    `${lineOf(pts)} L${xOf(pts[pts.length - 1].timestamp).toFixed(1)},${baseY} L${xOf(pts[0].timestamp).toFixed(1)},${baseY} Z`;

  let axisHtml = "";
  let gridHtml = "";
  for (let v = 0; v <= yMax; v += 1000) {
    const y = yOf(v);
    gridHtml += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${svgW - padR}" y2="${y.toFixed(1)}" class="graph-grid"/>`;
    axisHtml += `<text x="${axisW - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="graph-axis">${v === 0 ? "0" : `${v / 1000}k`}</text>`;
  }

  // ET offsets are whole hours, so UTC hour boundaries align with ET clock hours.
  let ticksHtml = "";
  for (let t = Math.ceil(firstTs / hourMs) * hourMs; t <= lastTs; t += hourMs) {
    ticksHtml += `<text x="${xOf(t).toFixed(1)}" y="${(baseY + 14).toFixed(1)}" text-anchor="middle" class="graph-axis">${escapeHtml(formatGraphHour(new Date(t)))}</text>`;
  }

  const pastHtml = past.length > 1
    ? `<path d="${areaOf(past)}" class="flow-area-past"/><path d="${lineOf(past)}" class="flow-line-past"/>`
    : "";
  const dotsHtml = future
    .filter((p) => p.timestamp > now)
    .map((p) => `<circle cx="${xOf(p.timestamp).toFixed(1)}" cy="${yOf(p.flowCfs).toFixed(1)}" r="1.7" class="flow-dot"/>`)
    .join("");
  const futureHtml = future.length > 1
    ? `<path d="${areaOf(future)}" class="flow-area-future"/><path d="${lineOf(future)}" class="flow-line-future"/>${dotsHtml}`
    : "";

  const nowX = xOf(now);
  const nowLabelX = Math.min(Math.max(nowX, padL + 28), svgW - padR - 28);
  const nowHtml = `<line x1="${nowX.toFixed(1)}" y1="${padT}" x2="${nowX.toFixed(1)}" y2="${baseY}" class="flow-now-line"/>`
    + `<text x="${nowLabelX.toFixed(1)}" y="${(padT - 6).toFixed(1)}" text-anchor="middle" class="flow-now-label">${escapeHtml(formatUsHour(new Date(now)))}</text>`;

  const initialScrollX = Math.max(0, Math.round(xOf(now - FLOW_GRAPH_INITIAL_PAST_MS) - padL));

  return `<div class="flow-graph">
  <p class="section-label">Whitethorne Flow <span class="graph-unit">cfs</span></p>
  <div class="flow-graph-body">
    <svg class="flow-yaxis" width="${axisW}" height="${H}" viewBox="0 0 ${axisW} ${H}" aria-hidden="true">${axisHtml}</svg>
    <div class="flow-scroll" data-initial-x="${initialScrollX}">
      <svg width="${svgW}" height="${H}" viewBox="0 0 ${svgW} ${H}" class="forecast-chart" role="img" aria-label="River flow at Whitethorne Launch, past and forecast">
        ${gridHtml}
        ${pastHtml}
        ${futureHtml}
        ${nowHtml}
        ${ticksHtml}
      </svg>
    </div>
  </div>
  <p class="graph-caption">Past flows light blue · forecast dark blue · scroll for earlier and later</p>
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
  const flowGraph = renderFlowGraph(aep) || `<p class="state">Forecast unavailable.</p>`;

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

  const scroller = el.aepContent.querySelector(".flow-scroll");
  if (scroller) {
    scroller.scrollLeft = Number(scroller.dataset.initialX) || 0;
  }
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
  const futureEntries = solunar.days
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => day.dateYmd !== solunar.startDate);

  if (!today && !futureEntries.length) {
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

  const futureHtml = futureEntries
    .map(({ day, index }, futureIndex) =>
      renderFutureSolunarItem(day, futureIndex, getSolunarHighlightMeta(highlightMap.get(index))))
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

async function settle(promise) {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function renderQuickViewFromState() {
  renderQuickView(state.aep, state.weather, state.solunar, state.observation);
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

  const staticTask = Promise.allSettled([
    getCachedResource("aep", getAepCurrent),
    getCachedResource("usgs", getUsgsRadfordLatest),
  ]).then((staticResults) => {
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
      renderUsgs(usgsResult.value);
    } else {
      renderState(el.usgsContent, `USGS error: ${usgsResult.reason.message}`, true);
    }

    renderQuickViewFromState();
  });

  const observationTask = settle(getCurrentObservation(LOCATION.lat, LOCATION.lon)).then((result) => {
    if (!isActiveRequest(loadId)) {
      return;
    }

    if (result.status === "fulfilled") {
      state.observation = result.value;
      if (state.weather) {
        renderWeather(state.weather, state.observation);
      }
      renderQuickViewFromState();
    }
  });

  const weatherTask = settle(getHourlyWeather(LOCATION.lat, LOCATION.lon, 8)).then((result) => {
    if (!isActiveRequest(loadId)) {
      return;
    }

    if (result.status === "fulfilled") {
      state.weather = result.value;
      renderWeather(result.value, state.observation);
    } else {
      renderState(el.weatherContent, `Weather error: ${result.reason.message}`, true);
    }

    renderQuickViewFromState();
  });

  const solunarTask = settle(getSolunarRange(LOCATION.lat, LOCATION.lon, 7)).then((result) => {
    if (!isActiveRequest(loadId)) {
      return;
    }

    if (result.status === "fulfilled") {
      state.solunar = result.value;
      renderSolunar(result.value);
    } else {
      renderState(el.solunarContent, `Solunar error: ${result.reason.message}`, true);
    }

    renderQuickViewFromState();
  });

  await Promise.allSettled([staticTask, observationTask, weatherTask, solunarTask]);

  if (isActiveRequest(loadId) && !quickViewRefreshId) {
    quickViewRefreshId = setInterval(renderQuickViewFromState, 60000);
  }
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
