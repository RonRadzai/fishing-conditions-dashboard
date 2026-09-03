# New River Conditions

**[Open Dashboard](https://ronradzai.github.io/fishing-conditions-dashboard/)**

Fishing conditions dashboard for the New River below Claytor Dam, VA. Pick an access
point at the top and the flow, gauge, and weather panels switch to that spot.

Access points (upstream to downstream): Pepper's Ferry Rd, Whitethorne, McCoy Falls,
Eggleston, Pembroke, Narrows, Glen Lyn. These are the locations AEP publishes
downstream flow forecasts for.

Shows:
- Quick-view: current flow, weather, upcoming solunar periods with countdowns
- Hourly weather (now + 8h) for the selected access point
- AEP downstream flow forecast for the selected access point
- USGS Radford gauge readings (closest gauge to Claytor Dam), always shown
- USGS Glen Lyn gauge readings when the selected access is Narrows or Glen Lyn
- Solunar major/minor periods for today + next 6 days (shared across all access points)

The selected access point is saved in the browser and mirrored in the URL hash
(for example `#pembroke`), so links open on a specific spot.

## Data sources

- Solunar: local sun/moon calculations in the browser
- AEP flow: `src/data/aep/<access>.json`, one file per access point (auto-updated by GitHub Actions)
- USGS: `api.waterdata.usgs.gov`
- Weather: `api.weather.gov`

Access point definitions (coordinates, AEP slugs, nearest gauge) live in `src/locations.js`.
The list of AEP locations the sync script fetches lives in `scripts/update_aep.py`; keep
the two in sync when adding an access point.

## Run locally

Static site — any server works.

```bash
python -m http.server 5500
```

Or use VS Code Live Server on `index.html`.

## Notes

- AEP data is refreshed on a schedule by `.github/workflows/update-aep.yml`
- If AEP looks stale, check the latest `Update AEP Data` run in GitHub Actions
- The AEP API does not allow browser requests (no CORS), which is why data is synced through Actions
- If weather fails, NWS occasionally has temporary errors — just reload
