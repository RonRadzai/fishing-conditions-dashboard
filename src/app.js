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
  saveLocalZip,
  setHtml,
} from "./utils.js";

const STATIC_TTL_MS = 10 * 60 * 1000;

const el = {
  locationSummary: document.querySelector("#location-summary"),
  summaryMeta: document.querySelector("#summary-meta"),
  summaryAepUpdated: document.querySelector("#summary-aep-updated"),
  summaryAepContent: document.querySelector("#summary-aep-content"),
  summarySolunarMeta: document.querySelector("#summary-solunar-meta"),
  summarySolunarContent: document.querySelector("#summary-solunar-content"),
  zipForm: document.querySelector("#zip-form"),
  zipInput: document.querySelector("#zip-input"),
  zipMessage: document.querySelector("#zip-message"),
  weatherMeta: document.querySelector("#weather-meta"),
  weatherUpdated: document.querySelector("#weather-updated"),
  weatherContent: document.querySelector("#weather-content"),
  aepUpdated: document.querySelector("#aep-updated"),
  aepContent: document.querySelector("#aep-content"),
  usgsContent: document.querySelector("#usgs-content"),
  solunarMeta: document.querySelector("#solunar-meta"),
  solunarContent: document.querySelector("#solunar-content"),
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
};

const MOON_PHASE_STYLES = [
  { pattern: /^new\b/i, phaseKey: "new" },
  { pattern: /waxing crescent/i, phaseKey: "waxing-crescent" },
  { pattern: /first quarter/i, phaseKey: "first-quarter" },
  { pattern: /waxing gibbous/i, phaseKey: "waxing-gibbous" },
  { pattern: /^full\b/i, phaseKey: "full" },
  { pattern: /waning gibbous/i, phaseKey: "waning-gibbous" },
  { pattern: /last quarter|third quarter/i, phaseKey: "last-quarter" },
  { pattern: /waning crescent/i, phaseKey: "waning-crescent" },
];

const MOON_ICON_PATHS = {
  new: new URL("./assets/moon/new.svg", import.meta.url).href,
  full: new URL("./assets/moon/full.svg", import.meta.url).href,
  "first-quarter": new URL("./assets/moon/first-quarter.svg", import.meta.url).href,
  "last-quarter": new URL("./assets/moon/last-quarter.svg", import.meta.url).href,
  "waxing-crescent": new URL("./assets/moon/waxing-crescent.svg", import.meta.url).href,
  "waning-crescent": new URL("./assets/moon/waning-crescent.svg", import.meta.url).href,
  "waxing-gibbous": new URL("./assets/moon/waxing-gibbous.svg", import.meta.url).href,
  "waning-gibbous": new URL("./assets/moon/waning-gibbous.svg", import.meta.url).href,
  generic: new URL("./assets/moon/generic.svg", import.meta.url).href,
};

function renderState(target, message, isError = false) {
  setHtml(target, `<p class="state ${isError ? "error" : ""}">${escapeHtml(message)}</p>`);
}

function isActiveRequest(loadId) {
  return state.activeLoadId === loadId;
}

function getMoonPhaseDisplay(phase) {
  const match = MOON_PHASE_STYLES.find((item) => item.pattern.test(String(phase)));
  return match ?? { phaseKey: "generic" };
}

function renderMoonIcon(phaseKey) {
  const src = MOON_ICON_PATHS[phaseKey] ?? MOON_ICON_PATHS.generic;
  return `<span class="moon-icon" aria-hidden="true">
    <img class="moon-svg" src="${src}" alt="" loading="lazy" decoding="async" />
  </span>`;
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

function renderHighlightPill(meta) {
  if (!meta.label) {
    return "";
  }

  return `<div class="solunar-highlight-pill ${meta.className}">
    <span>${escapeHtml(meta.label)}</span>
    <span>${escapeHtml(meta.description)}</span>
  </div>`;
}

function updateLocationLabels(location, zip) {
  el.locationSummary.textContent = `${location.city}, ${location.state} | All times Eastern`;
  el.summaryMeta.textContent = `${location.city} (${zip}) | All times Eastern`;
  el.weatherMeta.textContent = `${location.city} | Now + 8h ET`;
  el.solunarMeta.textContent = `${location.city} (${zip}) | Today open, next 6 days expandable | ET`;
}

function renderWeather(weather) {
  if (!weather.periods.length) {
    renderState(el.weatherContent, "No hourly weather periods were returned.");
    return;
  }

  const rows = weather.periods
    .map((period) => {
      const time = formatUsHour(new Date(period.startTime), EASTERN_TIMEZONE);
      const rain = period.rainChance === null || period.rainChance === undefined
        ? "N/A"
        : `${period.rainChance}%`;

      return `<li class="table-row-rich">
        <div class="table-time-block">
          <span class="table-time">${escapeHtml(time)}</span>
        </div>
        <div class="table-detail-block">
          <p class="table-main-value">${escapeHtml(String(period.temperature))}${escapeHtml(
            period.temperatureUnit
          )}</p>
          <p class="table-subdetail">Rain ${escapeHtml(rain)} | Wind ${escapeHtml(
            period.windSpeed
          )} ${escapeHtml(period.windDirection)}</p>
        </div>
      </li>`;
    })
    .join("");

  el.weatherUpdated.textContent = weather.updated
    ? `Updated ${formatUsDateTime(new Date(weather.updated), EASTERN_TIMEZONE)} ET`
    : "";
  setHtml(el.weatherContent, `<ul class="table-list table-list-rich">${rows}</ul>`);
}

function renderSummaryAep(aep) {
  const currentAsOf = aep.currentDateTime
    ? formatUsDateTime(new Date(aep.currentDateTime), EASTERN_TIMEZONE)
    : null;
  const generatedAt = aep.generatedAt
    ? formatUsDateTime(new Date(aep.generatedAt), EASTERN_TIMEZONE)
    : null;
  const freshnessLabel = aep.stale ? "Possibly stale" : "Fresh data";

  el.summaryAepUpdated.textContent = currentAsOf
    ? `Current as of ${currentAsOf} ET`
    : "Current arrival time unavailable";

  setHtml(
    el.summaryAepContent,
    `<div class="summary-stat-grid">
      <div class="summary-stat">
        <p class="stat-label">Current Flow</p>
        <p class="stat-value">${escapeHtml(aep.currentFlowCfs.toLocaleString())} cfs</p>
      </div>
      <div class="summary-stat">
        <p class="stat-label">Release Lag</p>
        <p class="stat-value">${escapeHtml(
          aep.waterReleasedHoursOffset === null ? "Unknown" : `${aep.waterReleasedHoursOffset} hours`
        )}</p>
      </div>
    </div>
    <div class="summary-footer-row">
      <p class="summary-status ${aep.stale ? "is-stale" : "is-fresh"}">${escapeHtml(
        freshnessLabel
      )}</p>
      <p class="summary-caption">${generatedAt ? `Synced ${escapeHtml(generatedAt)} ET` : "Sync time unavailable"}</p>
    </div>`
  );
}

function renderSummaryAepError(message) {
  el.summaryAepUpdated.textContent = "Whitethorne feed unavailable";
  renderState(el.summaryAepContent, message, true);
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
    <p class="card-meta">Reference station: USGS 03171000 (Radford, VA)${latest ? ` | Latest ${escapeHtml(latest)} ET` : ""}</p>`
  );
}

function getTodaySolunar(solunar) {
  if (!solunar) {
    return null;
  }
  return solunar.days.find((day) => day.dateYmd === solunar.startDate) ?? null;
}

function renderSummarySolunar(solunar) {
  const today = getTodaySolunar(solunar);
  if (!today) {
    el.summarySolunarMeta.textContent = "Today unavailable";
    renderState(el.summarySolunarContent, "Today's solunar data is unavailable.", true);
    return;
  }

  const todayIndex = solunar.days.findIndex((day) => day.dateYmd === today.dateYmd);
  const highlight = getSolunarHighlightMeta(getSolunarHighlightMap(solunar.days).get(todayIndex));
  const moon = getMoonPhaseDisplay(today.moonPhase);

  el.summarySolunarMeta.textContent = `${formatDateLabel(today.dateYmd)} | Eastern Time`;

  setHtml(
    el.summarySolunarContent,
    `<div class="summary-moon-head">
      <div class="moon-badge">
        ${renderMoonIcon(moon.phaseKey)}
        <div class="moon-badge-copy">
          <p class="section-label">Moon phase</p>
          <p class="summary-moon-phase">${escapeHtml(today.moonPhase)}</p>
        </div>
      </div>
      ${renderHighlightPill(highlight)}
    </div>
    <div class="summary-period-grid">
      <div class="summary-period-card">
        <p class="section-label">Major 1</p>
        <p class="summary-period-value">${escapeHtml(today.major1)}</p>
      </div>
      <div class="summary-period-card">
        <p class="section-label">Major 2</p>
        <p class="summary-period-value">${escapeHtml(today.major2)}</p>
      </div>
      <div class="summary-period-card">
        <p class="section-label">Minor 1</p>
        <p class="summary-period-value">${escapeHtml(today.minor1)}</p>
      </div>
      <div class="summary-period-card">
        <p class="section-label">Minor 2</p>
        <p class="summary-period-value">${escapeHtml(today.minor2)}</p>
      </div>
    </div>
    <p class="summary-caption">Sun ${escapeHtml(today.sunrise)} to ${escapeHtml(today.sunset)} | Moon ${escapeHtml(
      today.moonrise
    )} to ${escapeHtml(today.moonset)}</p>`
  );
}

function renderSolunarTimingCard(title, timings, emphasis) {
  return `<section class="solunar-timing ${emphasis ? `solunar-timing-${emphasis}` : ""}">
    <p class="section-label">${escapeHtml(title)}</p>
    ${renderDataRows(timings)}
  </section>`;
}

function renderTodaySolunarCard(today, todayHighlight) {
  return `<section class="solunar-today ${todayHighlight.className}">
    <div class="solunar-today-header">
      <div>
        <p class="section-kicker">Detailed view</p>
        <h3>${escapeHtml(formatDateLabel(today.dateYmd))}</h3>
        <p class="solunar-phase-text">${escapeHtml(today.moonPhase)}</p>
      </div>
      ${renderHighlightPill(todayHighlight)}
    </div>
    <div class="solunar-meta-grid solunar-meta-grid-wide">
      <div class="meta-chip">
        <p class="section-label">Sunrise / Sunset</p>
        <p class="meta-chip-value">${escapeHtml(today.sunrise)} to ${escapeHtml(today.sunset)}</p>
      </div>
      <div class="meta-chip">
        <p class="section-label">Moonrise / Moonset</p>
        <p class="meta-chip-value">${escapeHtml(today.moonrise)} to ${escapeHtml(today.moonset)}</p>
      </div>
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
  </section>`;
}

function renderFutureSolunarItem(day, index, highlight) {
  const isOpen = state.expandedFutureIndex === index;
  const panelId = `solunar-day-panel-${index}`;

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
        <p class="solunar-phase-inline">${escapeHtml(day.moonPhase)}</p>
      </div>
      <div class="solunar-day-trigger-meta">
        ${highlight.label ? `<span class="solunar-trigger-pill ${highlight.className}">${escapeHtml(
          highlight.label
        )}</span>` : ""}
        <span class="solunar-chevron" aria-hidden="true">${isOpen ? "−" : "+"}</span>
      </div>
    </button>
    <div id="${panelId}" class="solunar-day-body" ${isOpen ? "" : "hidden"}>
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
        <p class="section-kicker">Detailed view</p>
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
            <p class="section-label">Coming up</p>
            <p class="supporting-copy">Future days stay collapsed until you need the detail.</p>
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
  renderState(el.summaryAepContent, "Loading Whitethorne flow...");
  renderState(el.summarySolunarContent, "Loading today's solunar...");
  renderState(el.weatherContent, "Loading weather...");
  renderState(el.solunarContent, "Loading solunar data...");
  renderState(el.aepContent, "Loading AEP flow...");
  renderState(el.usgsContent, "Loading USGS data...");
  el.summaryAepUpdated.textContent = "";
  el.summarySolunarMeta.textContent = "Today's first read";
  el.weatherUpdated.textContent = "";
  el.aepUpdated.textContent = "";
}

function renderZipErrorState(message) {
  el.locationSummary.textContent = "Location unavailable";
  el.summaryMeta.textContent = "Waiting for a valid ZIP";
  el.weatherMeta.textContent = "Now + 8h ET";
  el.solunarMeta.textContent = "Today open, next 6 days expandable | ET";
  renderState(el.summarySolunarContent, "Waiting for a valid ZIP.", true);
  renderState(el.weatherContent, "Waiting for a valid ZIP.");
  renderState(el.solunarContent, "Waiting for a valid ZIP.");
  el.zipMessage.textContent = message;
  el.zipMessage.className = "message error";
}

async function loadDashboard(zip) {
  const loadId = ++state.activeLoadId;
  state.expandedFutureIndex = null;
  state.solunar = null;
  el.zipInput.value = zip;
  el.zipMessage.textContent = "";
  el.zipMessage.className = "message";
  renderInitialLoadingState();

  const staticTasks = Promise.allSettled([
    getCachedResource("aep", getAepCurrent),
    getCachedResource("usgs", getUsgsRadfordLatest),
  ]);

  try {
    const location = await getCoordinatesFromZip(zip);
    if (!isActiveRequest(loadId)) {
      return;
    }

    updateLocationLabels(location, zip);
    saveLocalZip(zip);

    const [staticResults, weatherResult, solunarResult] = await Promise.all([
      staticTasks,
      getHourlyWeather(location.lat, location.lon, 8).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason })
      ),
      getSolunarRange(location.lat, location.lon, null, 7).then(
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
      renderSummaryAep(aepResult.value);
      renderAep(aepResult.value);
    } else {
      renderSummaryAepError(aepResult.reason.message);
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

    if (weatherResult.status === "fulfilled") {
      renderWeather(weatherResult.value);
    } else {
      renderState(el.weatherContent, `Weather error: ${weatherResult.reason.message}`, true);
    }

    if (solunarResult.status === "fulfilled") {
      state.solunar = solunarResult.value;
      renderSummarySolunar(solunarResult.value);
      renderSolunar(solunarResult.value);
    } else {
      renderState(el.summarySolunarContent, `Solunar error: ${solunarResult.reason.message}`, true);
      renderState(el.solunarContent, `Solunar error: ${solunarResult.reason.message}`, true);
    }
  } catch (error) {
    if (!isActiveRequest(loadId)) {
      return;
    }

    const [aepResult, usgsResult] = await staticTasks;
    if (!isActiveRequest(loadId)) {
      return;
    }

    if (aepResult.status === "fulfilled") {
      state.aep = aepResult.value;
      renderSummaryAep(aepResult.value);
      renderAep(aepResult.value);
    } else {
      renderSummaryAepError(aepResult.reason.message);
    }

    if (usgsResult.status === "fulfilled") {
      state.usgs = usgsResult.value;
      renderUsgs(usgsResult.value);
    }

    renderZipErrorState(error.message);
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

el.zipForm.addEventListener("submit", onZipSubmit);
el.solunarContent.addEventListener("click", onSolunarToggle);
loadDashboard(getLocalZip());
