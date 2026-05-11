import {
  buildSolunarDates,
  getApproximateMoonPhaseName,
  getEasternTzInteger,
  getTrackedMoonPhaseForDate,
} from "../utils.js";

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const RAD = Math.PI / 180;
const J1970 = 2440588;
const J2000 = 2451545;
const SOLAR_ALTITUDE = -0.833 * RAD;
const MOON_ALTITUDE = 0.133 * RAD;
const ECLIPTIC_OBLIQUITY = 23.4397 * RAD;

const sin = Math.sin;
const cos = Math.cos;
const tan = Math.tan;
const asin = Math.asin;
const atan2 = Math.atan2;
const acos = Math.acos;

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

function formatClockDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "N/A";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  return `${hour}:${minute} ${dayPeriod}`.trim();
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

function getMoonPhaseFields(yyyymmdd) {
  const trackedPhase = getTrackedMoonPhaseForDate(yyyymmdd);

  return {
    moonPhase: trackedPhase?.label ?? getApproximateMoonPhaseName(yyyymmdd),
    moonPhaseType: trackedPhase?.type ?? null,
    moonPhaseEventTime: trackedPhase ? trackedPhase.date.toISOString() : null,
  };
}

function toJulian(date) {
  return date.valueOf() / MS_PER_DAY - 0.5 + J1970;
}

function fromJulian(julianDay) {
  return new Date((julianDay + 0.5 - J1970) * MS_PER_DAY);
}

function toDays(date) {
  return toJulian(date) - J2000;
}

function rightAscension(longitude, latitude) {
  return atan2(
    sin(longitude) * cos(ECLIPTIC_OBLIQUITY) - tan(latitude) * sin(ECLIPTIC_OBLIQUITY),
    cos(longitude)
  );
}

function declination(longitude, latitude) {
  return asin(
    sin(latitude) * cos(ECLIPTIC_OBLIQUITY)
      + cos(latitude) * sin(ECLIPTIC_OBLIQUITY) * sin(longitude)
  );
}

function altitude(hourAngle, latitude, declinationValue) {
  return asin(
    sin(latitude) * sin(declinationValue)
      + cos(latitude) * cos(declinationValue) * cos(hourAngle)
  );
}

function siderealTime(days, longitudeWest) {
  return RAD * (280.16 + 360.9856235 * days) - longitudeWest;
}

function solarMeanAnomaly(days) {
  return RAD * (357.5291 + 0.98560028 * days);
}

function eclipticLongitude(meanAnomaly) {
  const center = RAD * (
    1.9148 * sin(meanAnomaly)
      + 0.02 * sin(2 * meanAnomaly)
      + 0.0003 * sin(3 * meanAnomaly)
  );
  const perihelion = RAD * 102.9372;
  return meanAnomaly + center + perihelion + Math.PI;
}

function sunCoords(days) {
  const meanAnomaly = solarMeanAnomaly(days);
  const longitude = eclipticLongitude(meanAnomaly);

  return {
    dec: declination(longitude, 0),
    ra: rightAscension(longitude, 0),
    meanAnomaly,
    longitude,
  };
}

function moonCoords(days) {
  const longitude = RAD * (218.316 + 13.176396 * days);
  const meanAnomaly = RAD * (134.963 + 13.064993 * days);
  const meanDistance = RAD * (93.272 + 13.229350 * days);
  const eclipticLong = longitude + RAD * 6.289 * sin(meanAnomaly);
  const eclipticLat = RAD * 5.128 * sin(meanDistance);

  return {
    dec: declination(eclipticLong, eclipticLat),
    ra: rightAscension(eclipticLong, eclipticLat),
  };
}

function getMoonAltitude(date, lat, lon) {
  const longitudeWest = RAD * -lon;
  const latitude = RAD * lat;
  const days = toDays(date);
  const coords = moonCoords(days);
  const hourAngle = siderealTime(days, longitudeWest) - coords.ra;
  let height = altitude(hourAngle, latitude, coords.dec);
  height += RAD * 0.017 / tan(height + RAD * 10.26 / (height / RAD + 5.10));
  return height;
}

function hoursLater(date, hours) {
  return new Date(date.valueOf() + hours * MS_PER_HOUR);
}

function getMoonTimes(localMidnightUtc, lat, lon) {
  let rise = null;
  let set = null;
  let hour = 1;
  let h0 = getMoonAltitude(localMidnightUtc, lat, lon) - MOON_ALTITUDE;
  let ye = h0;

  for (; hour <= 24; hour += 2) {
    const h1 = getMoonAltitude(hoursLater(localMidnightUtc, hour), lat, lon) - MOON_ALTITUDE;
    const h2 = getMoonAltitude(hoursLater(localMidnightUtc, hour + 1), lat, lon) - MOON_ALTITUDE;
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;
    const xe = -b / (2 * a);
    ye = (a * xe + b) * xe + h1;
    const discriminant = b * b - 4 * a * h1;
    let roots = 0;
    let x1 = null;
    let x2 = null;

    if (discriminant >= 0) {
      const dx = Math.sqrt(discriminant) / (Math.abs(a) * 2);
      x1 = xe - dx;
      x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots += 1;
      if (Math.abs(x2) <= 1) roots += 1;
      if (x1 < -1) x1 = x2;
    }

    if (roots === 1) {
      if (h0 < 0) {
        rise = hour + x1;
      } else {
        set = hour + x1;
      }
    } else if (roots === 2) {
      rise = hour + (ye < 0 ? x2 : x1);
      set = hour + (ye < 0 ? x1 : x2);
    }

    if (rise !== null && set !== null) {
      break;
    }

    h0 = h2;
  }

  return {
    rise: rise === null ? null : hoursLater(localMidnightUtc, rise),
    set: set === null ? null : hoursLater(localMidnightUtc, set),
    alwaysUp: rise === null && set === null && ye > 0,
    alwaysDown: rise === null && set === null && ye <= 0,
  };
}

function julianCycle(days, longitudeWest) {
  return Math.round(days - 0.0009 - longitudeWest / (2 * Math.PI));
}

function approxTransit(hourAngle, longitudeWest, cycle) {
  return 0.0009 + (hourAngle + longitudeWest) / (2 * Math.PI) + cycle;
}

function solarTransitJulian(approxTransitValue, meanAnomaly, longitude) {
  return J2000 + approxTransitValue + 0.0053 * sin(meanAnomaly) - 0.0069 * sin(2 * longitude);
}

function hourAngle(height, latitude, declinationValue) {
  return acos(
    (sin(height) - sin(latitude) * sin(declinationValue))
      / (cos(latitude) * cos(declinationValue))
  );
}

function getSetJulian(height, longitudeWest, latitude, declinationValue, cycle, meanAnomaly, longitude) {
  const angle = hourAngle(height, latitude, declinationValue);
  const transit = approxTransit(angle, longitudeWest, cycle);
  return solarTransitJulian(transit, meanAnomaly, longitude);
}

function getSunTimes(localNoonUtc, lat, lon) {
  const longitudeWest = RAD * -lon;
  const latitude = RAD * lat;
  const days = toDays(localNoonUtc);
  const cycle = julianCycle(days, longitudeWest);
  const approxNoon = approxTransit(0, longitudeWest, cycle);
  const coords = sunCoords(days);
  const solarNoon = solarTransitJulian(approxNoon, coords.meanAnomaly, coords.longitude);
  const setJulian = getSetJulian(
    SOLAR_ALTITUDE,
    longitudeWest,
    latitude,
    coords.dec,
    cycle,
    coords.meanAnomaly,
    coords.longitude
  );
  const riseJulian = solarNoon - (setJulian - solarNoon);

  return {
    sunrise: fromJulian(riseJulian),
    sunset: fromJulian(setJulian),
  };
}

function getLocalDateBase(yyyymmdd) {
  const tz = getEasternTzInteger(createDateFromYmd(yyyymmdd));
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const midnight = new Date(Date.UTC(year, month - 1, day, -tz, 0, 0));
  const noon = new Date(Date.UTC(year, month - 1, day, 12 - tz, 0, 0));
  return { midnight, noon };
}

function calculateSolunar(lat, lon, yyyymmdd) {
  const { midnight, noon } = getLocalDateBase(yyyymmdd);
  const sun = getSunTimes(noon, lat, lon);
  const moon = getMoonTimes(midnight, lat, lon);
  const moonrise = moon.rise ? formatClockDate(moon.rise) : "N/A";
  const moonset = moon.set ? formatClockDate(moon.set) : "N/A";
  const computed = computePeriods(moonrise, moonset);
  const moonPhase = getMoonPhaseFields(yyyymmdd);

  return {
    dateYmd: yyyymmdd,
    sunrise: formatClockDate(sun.sunrise),
    sunset: formatClockDate(sun.sunset),
    moonrise,
    moonset,
    ...moonPhase,
    major1: computed.major1,
    major2: computed.major2,
    minor1: computed.minor1,
    minor2: computed.minor2,
    isMissing: false,
  };
}

function createDateFromYmd(yyyymmdd) {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

export async function getSolunarForDate(lat, lon, yyyymmdd, tz) {
  return calculateSolunar(lat, lon, yyyymmdd, tz);
}

export async function getSolunarRange(lat, lon, _tz, days = 7) {
  const dates = buildSolunarDates(days);
  const results = await Promise.all(dates.map((date) => getSolunarForDate(
    lat,
    lon,
    date,
    getEasternTzInteger(createDateFromYmd(date))
  )));

  return {
    startDate: dates[0],
    days: results,
    missingDates: [],
  };
}
