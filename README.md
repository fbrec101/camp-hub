# REC101 Camp Hub

Family-facing college football camp database for the 2026 camp season.

**Live:** https://fbrec101.github.io/camp-hub/

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell — map + grid views, filters |
| `camps_master.json` | Camp records (source of truth) |
| `school_coords.json` | Lat/lng for map pins |
| `scripts/normalize-camps.mjs` | Season prep — merge dupes, add states, format 2026 dates |

## Updating camp data

1. Edit `camps_master.json` (or restore raw export, then normalize)
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
