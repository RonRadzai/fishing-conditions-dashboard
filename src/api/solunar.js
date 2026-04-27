import {
  buildSolunarDates,
  getApproximateMoonPhaseName,
  getEasternTzInteger,
  getMoonPhaseTypeFromText,
  getTrackedMoonPhaseForDate,
} from "../utils.js";

const MINUTES_PER_DAY = 24 * 60;

function parseClockTimeToMinutes(timeText) {
  if (!timeText || timeText === "N/A") {
    return null;
  }

  const match = String(timeText)
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3] ? match[3].toUpperCase() : null;

  if (meridiem) {
    hour %= 12;
    if (meridiem === "PM") {
      hour += 12;
    }
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function formatClockMinutes(minutes) {
  const normalized = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function formatClockText(timeText) {
  const minutes = parseClockTimeToMinutes(timeText);
  return minutes === null ? "N/A" : formatClockMinutes(minutes);
}

function fmtRange(startMinutes, endMinutes) {
  return `${formatClockMinutes(startMinutes)} - ${formatClockMinutes(endMinutes)}`;
}

function computePeriods(moonRiseText, moonSetText) {
  const moonRise = parseClockTimeToMinutes(moonRiseText);
  const moonSetRaw = parseClockTimeToMinutes(moonSetText);
  if (moonRise === null || moonSetRaw === null) {
    return {
      major1: "N/A",
      major2: "N/A",
      minor1: "N/A",
      minor2: "N/A",
    };
  }

  const moonSet = moonSetRaw <= moonRise ? moonSetRaw + MINUTES_PER_DAY : moonSetRaw;
  const nextMoonRise = moonRise + MINUTES_PER_DAY;

  const majorCenter1 = (moonRise + moonSet) / 2;
  const majorCenter2 = (moonSet + nextMoonRise) / 2;

  return {
    major1: fmtRange(majorCenter1 - 60, majorCenter1 + 60),
    major2: fmtRange(majorCenter2 - 60, majorCenter2 + 60),
    minor1: fmtRange(moonRise - 30, moonRise + 30),
    minor2: fmtRange(moonSet - 30, moonSet + 30),
  };
}

function pickRange(startText, stopText) {
  const start = parseClockTimeToMinutes(startText);
  const stop = parseClockTimeToMinutes(stopText);
  if (start === null || stop === null) {
    return null;
  }
  return fmtRange(start, stop);
}

function getMoonPhaseFields(rawPhase, yyyymmdd) {
  const trackedPhase = getTrackedMoonPhaseForDate(yyyymmdd);
  const phaseText = rawPhase ?? "N/A";

  return {
    moonPhase: trackedPhase?.label ?? phaseText,
    moonPhaseType: trackedPhase?.type ?? getMoonPhaseTypeFromText(phaseText),
    moonPhaseEventTime: trackedPhase ? trackedPhase.date.toISOString() : null,
  };
}

function normalizeSolunar(raw, yyyymmdd) {
  const moonrise = raw.moonRise ?? "N/A";
  const moonset = raw.moonSet ?? "N/A";
  const computed = computePeriods(moonrise, moonset);
  const major1Range = pickRange(raw.major1Start, raw.major1Stop);
  const major2Range = pickRange(raw.major2Start, raw.major2Stop);
  const minor1Range = pickRange(raw.minor1Start, raw.minor1Stop);
  const minor2Range = pickRange(raw.minor2Start, raw.minor2Stop);
  const moonPhase = getMoonPhaseFields(raw.moonPhase, yyyymmdd);

  return {
    dateYmd: yyyymmdd,
    sunrise: formatClockText(raw.sunRise),
    sunset: formatClockText(raw.sunSet),
    moonrise: formatClockText(moonrise),
    moonset: formatClockText(moonset),
    ...moonPhase,
    major1: major1Range ?? computed.major1,
    major2: major2Range ?? computed.major2,
    minor1: minor1Range ?? computed.minor1,
    minor2: minor2Range ?? computed.minor2,
    isMissing: false,
  };
}

function createMissingSolunarDay(yyyymmdd) {
  const trackedPhase = getTrackedMoonPhaseForDate(yyyymmdd);

  return {
    dateYmd: yyyymmdd,
    sunrise: "N/A",
    sunset: "N/A",
    moonrise: "N/A",
    moonset: "N/A",
    moonPhase: trackedPhase?.label ?? getApproximateMoonPhaseName(yyyymmdd),
    moonPhaseType: trackedPhase?.type ?? null,
    moonPhaseEventTime: trackedPhase ? trackedPhase.date.toISOString() : null,
    major1: "N/A",
    major2: "N/A",
    minor1: "N/A",
    minor2: "N/A",
    isMissing: true,
  };
}

function createDateFromYmd(yyyymmdd) {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
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

export async function getSolunarRange(lat, lon, _tz, days = 7) {
  const dates = buildSolunarDates(days);
  const results = await Promise.allSettled(
    dates.map((date) => getSolunarForDate(lat, lon, date, getEasternTzInteger(createDateFromYmd(date))))
  );

  return {
    startDate: dates[0],
    days: results
      .map((result, index) => (
        result.status === "fulfilled" ? result.value : createMissingSolunarDay(dates[index])
      )),
    missingDates: results
      .map((result, index) => (result.status === "rejected" ? dates[index] : null))
      .filter(Boolean),
  };
}
