// New River access points below Claytor Dam that AEP publishes flow forecasts for.
// Ordered upstream (closest to the dam) to downstream. `id` must match the file
// names written by scripts/update_aep.py and the LOCATIONS list there.

export const RADFORD_GAUGE = {
  id: "USGS-03171000",
  name: "Radford Gauge",
  description: "Closest USGS gauge to Claytor Dam",
};

export const GLEN_LYN_GAUGE = {
  id: "USGS-03176500",
  name: "Glen Lyn Gauge",
  description: "USGS New River at Glen Lyn",
};

// Solunar times barely change across this ~40 mile stretch, so they are
// computed once from a central point rather than per access.
export const SOLUNAR_POINT = { lat: 37.29, lon: -80.63 };

export const LOCATIONS = [
  {
    id: "peppers-ferry",
    name: "Pepper's Ferry Rd",
    aepSlug: "PeppersFerryRd",
    aepUrl: "https://www.aep.com/recreation/hydro/peppersferryrd/",
    weatherLabel: "Radford",
    lat: 37.152,
    lon: -80.558,
    nearestGauge: RADFORD_GAUGE,
  },
  {
    id: "whitethorne",
    name: "Whitethorne",
    aepSlug: "WhitethorneLaunch",
    aepUrl: "https://www.aep.com/recreation/hydro/whitethornelaunch/",
    weatherLabel: "Whitethorne",
    lat: 37.1997,
    lon: -80.5644,
    nearestGauge: RADFORD_GAUGE,
  },
  {
    id: "mccoy-falls",
    name: "McCoy Falls",
    aepSlug: "McCoyFalls",
    aepUrl: "https://www.aep.com/recreation/hydro/mccoyfalls/",
    weatherLabel: "McCoy",
    lat: 37.2171,
    lon: -80.5978,
    nearestGauge: RADFORD_GAUGE,
  },
  {
    id: "eggleston",
    name: "Eggleston",
    aepSlug: "Eggleston",
    aepUrl: "https://www.aep.com/recreation/hydro/eggleston/",
    weatherLabel: "Eggleston",
    lat: 37.2868,
    lon: -80.625,
    nearestGauge: RADFORD_GAUGE,
  },
  {
    id: "pembroke",
    name: "Pembroke",
    aepSlug: "Pembroke",
    aepUrl: "https://www.aep.com/recreation/hydro/pembroke/",
    weatherLabel: "Pembroke",
    lat: 37.3196,
    lon: -80.6391,
    nearestGauge: RADFORD_GAUGE,
  },
  {
    id: "narrows",
    name: "Narrows",
    aepSlug: "Narrows",
    aepUrl: "https://www.aep.com/recreation/hydro/narrows/",
    weatherLabel: "Narrows",
    lat: 37.3315,
    lon: -80.8112,
    nearestGauge: GLEN_LYN_GAUGE,
  },
  {
    id: "glen-lyn",
    name: "Glen Lyn",
    aepSlug: "GlenLyn",
    aepUrl: "https://www.aep.com/recreation/hydro/glenlyn/",
    weatherLabel: "Glen Lyn",
    lat: 37.3682,
    lon: -80.8642,
    nearestGauge: GLEN_LYN_GAUGE,
  },
];

export const DEFAULT_LOCATION_ID = "whitethorne";

export function getLocationById(id) {
  return LOCATIONS.find((location) => location.id === id) || null;
}
