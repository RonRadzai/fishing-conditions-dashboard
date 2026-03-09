# Fishing Conditions Dashboard

A beginner-friendly fishing dashboard that combines:

- Solunar data (sun/moon + major/minor periods)
- AEP Whitethorne hourly flow window (`now - 2h` to `now + 8h`, Eastern Time)
- USGS Radford reference readings
- Same-day weather (`now + next 8h`)

Default ZIP for v1: `24060` (editable in the app).

## APIs used

- Solunar: `https://api.solunar.org/solunar/{lat},{lon},{yyyymmdd},{tz}`
- ZIP lookup: `https://api.zippopotam.us/us/{zip}`
- AEP forecast: `https://aepcom-api.aep.com/api/hydro/forecast?location=WhitethorneLaunch`
- USGS OGC: `https://api.waterdata.usgs.gov/ogcapi/v0`
- NWS Weather API: `https://api.weather.gov`

## Run locally

This is a static site, so use any static server.

### Option A: VS Code Live Server

1. Install the Live Server extension.
2. Right-click `index.html`.
3. Click **Open with Live Server**.

### Option B: Python

```bash
python -m http.server 5500
```

Then open `http://localhost:5500`.

## App behavior

- ZIP is stored in localStorage key: `fishing_dashboard_zip`.
- On load, the app gets coordinates from ZIP, then fetches all cards in parallel.
- If one API fails, only that card shows an error; the rest still render.
- AEP card:
  - Uses `WhitethorneLaunch` forecast endpoint
  - Converts points into hourly ET buckets
  - Uses latest 15-minute value per hour
  - Shows list + mini chart

## Deploy to GitHub Pages

1. Initialize git (if needed):
   - `git init`
2. Add your GitHub repo as remote:
   - `git remote add origin https://github.com/RonRadzai/fishing-conditions-dashboard.git`
3. Commit:
   - `git add .`
   - `git commit -m "Initial fishing conditions dashboard"`
4. Push:
   - `git branch -M main`
   - `git push -u origin main`
5. In GitHub:
   - Go to **Settings > Pages**
   - Source: **Deploy from a branch**
   - Branch: `main`, folder: `/ (root)`

Your dashboard URL will be shown by GitHub Pages after publish.

## Troubleshooting

- If weather fails: NWS can occasionally throttle or return temporary errors.
- If AEP values are missing for some hours: that hour had no point in the response; it displays `N/A`.
- If ZIP fails: ensure it is a valid US 5-digit ZIP.
