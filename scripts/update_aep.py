"""Refresh AEP downstream flow forecasts for every New River access below Claytor Dam.

Writes one JSON file per location under src/data/aep/. A failure at one
location does not block the others; the script exits non-zero only when
every location fails.
"""

from __future__ import annotations

import json
import math
import pathlib
import sys
import tempfile
import urllib.request
from datetime import UTC, datetime


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "src" / "data" / "aep"
API_BASE = "https://aepcom-api.aep.com/api/hydro/forecast?location="
PAGE_BASE = "https://www.aep.com/recreation/hydro/"
USER_AGENT = "Mozilla/5.0 (compatible; FishingConditionsDashboard/1.0)"

# Ordered upstream (closest to Claytor Dam) to downstream.
# id: file name and dashboard key; slug: AEP API location; page: AEP page path.
LOCATIONS = [
    {"id": "peppers-ferry", "slug": "PeppersFerryRd", "page": "peppersferryrd"},
    {"id": "whitethorne", "slug": "WhitethorneLaunch", "page": "whitethornelaunch"},
    {"id": "mccoy-falls", "slug": "McCoyFalls", "page": "mccoyfalls"},
    {"id": "eggleston", "slug": "Eggleston", "page": "eggleston"},
    {"id": "pembroke", "slug": "Pembroke", "page": "pembroke"},
    {"id": "narrows", "slug": "Narrows", "page": "narrows"},
    {"id": "glen-lyn", "slug": "GlenLyn", "page": "glenlyn"},
]


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def require_number(value: object, field_name: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field_name} must be a finite number.")
    return float(value)


def compact_number(value: float) -> int | float:
    """Return an int when the value is whole, otherwise the float (e.g. 14.5 hours)."""
    return int(value) if value == int(value) else value


def normalize_forecast(payload: dict) -> tuple[list[tuple[int, int]], int, str, int | float]:
    if not isinstance(payload, dict):
        raise ValueError("AEP payload must be an object.")

    forecast = payload.get("forecast")
    if not isinstance(forecast, list) or len(forecast) < 2:
        raise ValueError("AEP payload did not include a usable forecast.")

    normalized: list[tuple[int, int]] = []
    previous_timestamp = -1
    for index, pair in enumerate(forecast):
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError(f"Forecast point {index} is invalid.")
        timestamp = int(require_number(pair[0], f"forecast[{index}][0]"))
        flow = int(round(require_number(pair[1], f"forecast[{index}][1]")))
        if timestamp <= previous_timestamp:
            raise ValueError("Forecast timestamps must be strictly increasing.")
        normalized.append((timestamp, flow))
        previous_timestamp = timestamp

    current_date_time = int(require_number(payload.get("currentDateTime"), "currentDateTime"))
    last_updated = payload.get("lastUpdated")
    if not isinstance(last_updated, str) or not last_updated:
        raise ValueError("AEP payload did not include lastUpdated.")

    released_hours = compact_number(
        require_number(payload.get("waterReleasedHoursOffset"), "waterReleasedHoursOffset")
    )
    return normalized, current_date_time, last_updated, released_hours


def interpolate_current_flow(current_timestamp: int, forecast: list[tuple[int, int]]) -> int:
    if current_timestamp <= forecast[0][0]:
        return forecast[0][1]
    if current_timestamp >= forecast[-1][0]:
        return forecast[-1][1]

    for left, right in zip(forecast, forecast[1:]):
        left_ts, left_flow = left
        right_ts, right_flow = right
        if current_timestamp == left_ts:
            return left_flow
        if left_ts < current_timestamp <= right_ts:
            span = right_ts - left_ts
            if span <= 0:
                return right_flow
            ratio = (current_timestamp - left_ts) / span
            return int(round(left_flow + (right_flow - left_flow) * ratio))

    return forecast[-1][1]


def build_checkpoint(label: str, target_timestamp: int, forecast: list[tuple[int, int]]) -> dict:
    best_timestamp, best_flow = min(forecast, key=lambda item: abs(item[0] - target_timestamp))
    return {
        "label": label,
        "timestamp": best_timestamp,
        "flowCfs": best_flow,
    }


def build_output(location: dict, payload: dict) -> dict:
    forecast, current_date_time, last_updated, released_hours = normalize_forecast(payload)
    current_flow = interpolate_current_flow(current_date_time, forecast)

    hour_ms = 60 * 60 * 1000
    checkpoints = [
        {"label": "Now", "timestamp": current_date_time, "flowCfs": current_flow},
        build_checkpoint("+1h", current_date_time + hour_ms, forecast),
        build_checkpoint("+2h", current_date_time + 2 * hour_ms, forecast),
        build_checkpoint("+4h", current_date_time + 4 * hour_ms, forecast),
        build_checkpoint("+8h", current_date_time + 8 * hour_ms, forecast),
    ]

    generated_at = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    return {
        "id": location["id"],
        "location": location["slug"],
        "sourceUrl": f"{PAGE_BASE}{location['page']}/",
        "sourceEndpoint": f"{API_BASE}{location['slug']}",
        "generatedAt": generated_at,
        "lastUpdated": last_updated,
        "currentDateTime": current_date_time,
        "waterReleasedHoursOffset": released_hours,
        "currentFlowCfs": current_flow,
        "forecastCheckpoints": checkpoints,
        "forecastPoints": [{"timestamp": timestamp, "flowCfs": flow} for timestamp, flow in forecast],
    }


def write_output(path: pathlib.Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp"
    ) as tmp:
        tmp.write(json.dumps(data, indent=2) + "\n")
        tmp_path = pathlib.Path(tmp.name)
    tmp_path.replace(path)


def update_location(location: dict) -> pathlib.Path:
    payload = fetch_json(f"{API_BASE}{location['slug']}")
    output = build_output(location, payload)
    path = OUTPUT_DIR / f"{location['id']}.json"
    write_output(path, output)
    return path


def main() -> int:
    failures = 0
    for location in LOCATIONS:
        try:
            path = update_location(location)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"Failed to update AEP {location['slug']} data: {exc}", file=sys.stderr)
            continue
        print(f"Wrote {path}")

    if failures == len(LOCATIONS):
        print("All AEP locations failed to update.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
