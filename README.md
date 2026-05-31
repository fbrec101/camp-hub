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
| `school_meta.json` | Mascot, colors, city, logo (generated) |
| `school_meta_overrides.json` | Manual fixes for NAIA / renamed schools |
| `school_city_cache.json` | Reverse-geocode cache (generated) |
| `school_coords.json` | Lat/lng for map pins |
| `scripts/normalize-camps.mjs` | Season prep — merge dupes, add states, format 2026 dates |
| `scripts/enrich-school-meta.mjs` | Pull mascot/colors/logos + geocode cities |

## Updating camp data

1. Edit `camps_raw.json`, `manual_camps.json`, or `school_overrides.json`
2. Refresh school metadata (mascot, colors, city, logos):

```bash
node scripts/enrich-school-meta.mjs
```

Uses [sportsdataverse team colors/logos](https://github.com/sportsdataverse/cfbfastR-data) by default. Optional: set `CFBD_API_KEY` for fresher NCAA data. Edit `school_meta_overrides.json` for NAIA or renamed schools.

3. Run normalization before deploy:

```bash
node scripts/normalize-camps.mjs
```

Set `CAMP_SEASON_AS_OF=2026-06-15` when re-running mid-season to drop past dates.

Gap-fill schools without published 2026 camps are omitted (e.g. Albany, Alcorn, Butler, Hampton, Merrimack, UT Martin).

4. Push to GitHub — Pages auto-deploys from `main`

## Local preview

`fetch()` requires a web server (not `file://`):

```bash
npx --yes serve .
```
