# Whitethorne

**[Open Dashboard](https://ronradzai.github.io/fishing-conditions-dashboard/)**

Fishing conditions dashboard for Whitethorne Launch on the New River. Hardcoded to Blacksburg, VA (ZIP 24060).

Shows:
- Quick-view: current flow, weather, upcoming solunar periods with countdowns
- Solunar major/minor periods for today + next 6 days
- AEP Whitethorne downstream flow forecast
- USGS Radford gauge readings
- Hourly weather (now + 8h)

## Data sources

- Solunar: `api.solunar.org`
- AEP flow: `src/data/aep-whitethorne.json` (auto-updated by GitHub Actions)
- USGS: `api.waterdata.usgs.gov`
- Weather: `api.weather.gov`

## Run locally

Static site — any server works.

```bash
python -m http.server 5500
```

Or use VS Code Live Server on `index.html`.

## Notes

- AEP data is refreshed on a schedule by `.github/workflows/update-aep-whitethorne.yml`
- If AEP looks stale, check the latest `Update AEP Whitethorne Data` run in GitHub Actions
- If weather fails, NWS occasionally has temporary errors — just reload
