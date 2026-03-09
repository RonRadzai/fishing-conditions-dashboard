import { buildSolunarDates } from "../utils.js";

function parseClockTime(date, timeText) {
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

  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function fmtTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function fmtRange(start, end) {
  return `${fmtTime(start)} - ${fmtTime(end)}`;
}

function computePeriods(baseDate, moonRiseText, moonSetText) {
  const moonRise = parseClockTime(baseDate, moonRiseText);
  const moonSetRaw = parseClockTime(baseDate, moonSetText);
  if (!moonRise || !moonSetRaw) {
    return {
      major1: "N/A",
      major2: "N/A",
      minor1: "N/A",
      minor2: "N/A",
    };
  }

  const moonSet = new Date(moonSetRaw);
  if (moonSet <= moonRise) {
    moonSet.setDate(moonSet.getDate() + 1);
  }

  // Major center #1: midpoint between moonrise and moonset.
  const majorCenter1 = new Date((moonRise.getTime() + moonSet.getTime()) / 2);
  // Major center #2: midpoint between moonset and next moonrise (underfoot window).
  const nextMoonRise = new Date(moonRise);
  nextMoonRise.setDate(nextMoonRise.getDate() + 1);
  const majorCenter2 = new Date((moonSet.getTime() + nextMoonRise.getTime()) / 2);

  const major1Start = new Date(majorCenter1.getTime() - 60 * 60000);
  const major1End = new Date(majorCenter1.getTime() + 60 * 60000);
  const major2Start = new Date(majorCenter2.getTime() - 60 * 60000);
  const major2End = new Date(majorCenter2.getTime() + 60 * 60000);

  const minor1Start = new Date(moonRise.getTime() - 30 * 60000);
  const minor1End = new Date(moonRise.getTime() + 30 * 60000);
  const minor2Start = new Date(moonSet.getTime() - 30 * 60000);
  const minor2End = new Date(moonSet.getTime() + 30 * 60000);

  return {
    major1: fmtRange(major1Start, major1End),
    major2: fmtRange(major2Start, major2End),
    minor1: fmtRange(minor1Start, minor1End),
    minor2: fmtRange(minor2Start, minor2End),
  };
}

function pickRange(startText, stopText, baseDate) {
  const start = parseClockTime(baseDate, startText);
  const stop = parseClockTime(baseDate, stopText);
  if (!start || !stop) {
    return null;
  }
  return fmtRange(start, stop);
}

function normalizeSolunar(raw, yyyymmdd) {
  const year = yyyymmdd.slice(0, 4);
  const month = yyyymmdd.slice(4, 6);
  const day = yyyymmdd.slice(6, 8);
  const iso = `${year}-${month}-${day}T00:00:00`;
  const baseDate = new Date(iso);
  const moonrise = raw.moonRise ?? "N/A";
  const moonset = raw.moonSet ?? "N/A";
  const computed = computePeriods(baseDate, moonrise, moonset);
  const major1Range = pickRange(raw.major1Start, raw.major1Stop, baseDate);
  const major2Range = pickRange(raw.major2Start, raw.major2Stop, baseDate);
  const minor1Range = pickRange(raw.minor1Start, raw.minor1Stop, baseDate);
  const minor2Range = pickRange(raw.minor2Start, raw.minor2Stop, baseDate);

  return {
    date: baseDate,
    sunrise: raw.sunRise ?? "N/A",
    sunset: raw.sunSet ?? "N/A",
    moonrise,
    moonset,
    moonPhase: raw.moonPhase ?? "N/A",
    major1: major1Range ?? computed.major1,
    major2: major2Range ?? computed.major2,
    minor1: minor1Range ?? computed.minor1,
    minor2: minor2Range ?? computed.minor2,
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
