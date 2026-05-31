# REC101 Camp Hub

Family-facing college football camp database for the 2026 camp season.

**Live:** https://fbrec101.github.io/camp-hub/

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell — map + grid views, filters |
| `camps_raw.json` | Original camp records (do not edit after normalize) |
| `camps_master.json` | Normalized output for the app |
| `manual_camps.json` | Hand-added / gap-fill entries (e.g. missing dates) |
| `school_overrides.json` | Division, state, conference corrections |
| `school_coords.json` | Lat/lng for map pins |
| `scripts/normalize-camps.mjs` | Season prep — merge dupes, add states, format 2026 dates |

## Updating camp data

1. Edit `camps_raw.json`, `manual_camps.json`, or `school_overrides.json`
2. Run normalization before deploy:

```bash
node scripts/normalize-camps.mjs
```

Set season context if needed:

```bash
CAMP_SEASON_AS_OF=2026-06-15 CAMP_YEAR=2026 node scripts/normalize-camps.mjs
```

3. Push to GitHub — Pages auto-deploys from `main`

## Local preview

`fetch()` requires a web server (not `file://`):

```bash
npx --yes serve .
```
