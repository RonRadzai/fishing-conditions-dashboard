from __future__ import annotations

import json
import math
import pathlib
import sys
import urllib.request
from datetime import UTC, datetime


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "src" / "data" / "aep-whitethorne.json"
SOURCE_URL = "https://www.aep.com/recreation/hydro/whitethornelaunch/"
SOURCE_ENDPOINT = "https://aepcom-api.aep.com/api/hydro/forecast?location=WhitethorneLaunch"
USER_AGENT = "Mozilla/5.0 (compatible; FishingConditionsDashboard/1.0)"


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def require_number(value: object, field_name: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field_name} must be a finite number.")
    return float(value)


def normalize_forecast(payload: dict) -> tuple[list[tuple[int, int]], int, str, str]:
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

    released_hours = int(require_number(payload.get("waterReleasedHoursOffset"), "waterReleasedHoursOffset"))
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


def build_output(payload: dict) -> dict:
    forecast, current_date_time, last_updated, released_hours = normalize_forecast(payload)
    current_flow = interpolate_current_flow(current_date_time, forecast)

    checkpoints = [
        {
            "label": "Now",
            "timestamp": current_date_time,
            "flowCfs": current_flow,
        },
        build_checkpoint("+1h", current_date_time + 60 * 60 * 1000, forecast),
        build_checkpoint("+2h", current_date_time + 2 * 60 * 60 * 1000, forecast),
        build_checkpoint("+4h", current_date_time + 4 * 60 * 60 * 1000, forecast),
        build_checkpoint("+8h", current_date_time + 8 * 60 * 60 * 1000, forecast),
    ]

    generated_at = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    return {
        "location": "WhitethorneLaunch",
        "sourceUrl": SOURCE_URL,
        "sourceEndpoint": SOURCE_ENDPOINT,
        "generatedAt": generated_at,
        "lastUpdated": last_updated,
        "currentDateTime": current_date_time,
        "waterReleasedHoursOffset": released_hours,
        "currentFlowCfs": current_flow,
        "forecastCheckpoints": checkpoints,
        "forecastPoints": [{"timestamp": timestamp, "flowCfs": flow} for timestamp, flow in forecast],
    }


def write_output(data: dict) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    try:
        payload = fetch_json(SOURCE_ENDPOINT)
        output = build_output(payload)
        write_output(output)
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to update AEP Whitethorne data: {exc}", file=sys.stderr)
        return 1

    print(f"Wrote {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
