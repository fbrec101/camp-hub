#!/usr/bin/env node
/**
 * Build school_meta.json for Camp Hub.
 * Sources (in priority order per field):
 *   1. school_meta_overrides.json — manual NAIA / alias fixes
 *   2. CFBD /teams API — when CFBD_API_KEY is set (city from stadium location)
 *   3. sportsdataverse cfbfastR-data teams_colors_logos.csv — mascot, colors, logos
 *   4. Nominatim reverse geocode — city from school_coords.json (cached)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAMPS_FILE = path.join(ROOT, 'camps_master.json');
const COORDS_FILE = path.join(ROOT, 'school_coords.json');
const OVERRIDES_FILE = path.join(ROOT, 'school_meta_overrides.json');
const META_FILE = path.join(ROOT, 'school_meta.json');
const GEO_CACHE_FILE = path.join(ROOT, 'school_city_cache.json');

const SDV_CSV_URL =
  'https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/teams/teams_colors_logos.csv';
const CFBD_YEAR = Number(process.env.CFBD_YEAR || 2025);
const SKIP_GEO = process.env.SKIP_GEOCODE === '1';
const GEO_DELAY_MS = Number(process.env.GEO_DELAY_MS || 350);

/** Camp Hub name → sportsdataverse / CFBD school name */
const NAME_ALIASES = {
  'App State': 'Appalachian State',
  'Central Connecticut': 'Central Connecticut State',
  'East Texas A&M': 'Texas A&M-Commerce',
  'Houston Christian': 'Houston Baptist',
  'Louisiana-Lafayette': 'Louisiana',
  'McNeese State': 'McNeese',
  'Miami (Ohio)': 'Miami (OH)',
  'Nicholls State': 'Nicholls',
  'Prairie View A&M': 'Prairie View',
  'San José State': 'San Jose State',
  'Southern': 'Southern',
  'UIW': 'Incarnate Word',
  'Utah Tech': 'Dixie State',
  'Albany State': 'Albany State (GA)',
  'Anderson University': 'Anderson (IN)',
  'Augustana College': 'Augustana (IL)',
  'Augustana University': 'Augustana (SD)',
  'Baker University': 'Baker',
  'Benedictine College': 'Benedictine College',
  'Campbellsville University': 'Campbellsville',
  'Carroll University': 'Carroll (WI)',
  'Catawba College': 'Catawba',
  'Central Missouri': 'Central Missouri State',
  'Colorado School of Mines': 'Colorado Mines',
  'Fairleigh Dickinson University-Florham': 'FDU-Florham',
  'Fort Lewis College': 'Fort Lewis',
  'Georgetown College': 'Georgetown (Kentucky)',
  'Graceland University': 'Graceland',
  'Indiana University of Pennsylvania': 'Indiana (PA)',
  'Indiana Wesleyan University': 'Indiana Wesleyan',
  'Keiser University': 'Keiser',
  'Long Island': 'LIU Post',
  'Lindsey Wilson College': 'Lindsey Wilson',
  'Massachusetts Maritime Academy': 'Mass Maritime',
  'Minnesota State - Mankato': 'Mankato State',
  'Minnesota State - Moorhead': 'Minnesota St-Moorhead',
  'Missouri Baptist University': 'Missouri Baptist',
  'Missouri Western State': 'Missouri Western',
  'Missouri Valley College': 'Missouri Valley',
  'Marian University': 'Marian',
  'Northwestern College': 'Northwestern College (IA)',
  'Oklahoma Panhandle State University': 'OK Panhandle St',
  'Olivet Nazarene University': 'Olivet Nazarene',
  'PennWest Clarion': 'Clarion',
  'PennWest Edinboro': 'Edinboro',
  'Reinhardt University': 'Reinhardt',
  'Rose-Hulman Institute of Technology': 'Rose-Hulman',
  'Saint Anselm': 'St. Anselm',
  'Saint Vincent College': 'St. Vincent',
  "King's College": "King's College (PA)",
  'Maryville College': 'Maryville TN',
  'Southeastern Oklahoma State': 'Southeastern Oklahoma State',
  'St. Thomas University': 'St. Thomas (FL)',
  'Texas Wesleyan University': 'Texas Wesleyan',
  'Trinity University': 'Trinity (TX)',
  'University of Charleston': 'Charleston (WV)',
  'University of Chicago': 'Chicago',
  'University of Jamestown': 'Jamestown',
  'University of Pikeville': 'Pikeville',
  'University of Rio Grande': 'Rio Grande',
  'University of St. Thomas': 'St. Thomas (MN)',
  'University of Wisconsin-Oshkosh': 'Wisconsin-Oshkosh',
  'University of Wisconsin-River Falls': 'Wisconsin-River Falls',
  'University of Wisconsin-Stout': 'Wisconsin-Stout',
  'University of Wisconsin-Whitewater': 'Wisconsin-Whitewater',
  'Valley City State University': 'Valley City State',
  'Warner University': 'Warner',
  'Washington University in St. Louis': 'Washington (MO)',
  'Wayne State College': 'Wayne State (NE)',
  'Wayne State University': 'Wayne State (MI)',
  'West Virginia State': 'West Virginia State',
  'Wheaton College (IL)': 'Wheaton College (Ill)',
  'Ave Maria University': 'Ave Maria',
  'Dakota State University': 'Dakota State',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && n === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] || ''])));
}

function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]/g, '');
}

function stripSuffixes(s) {
  return String(s || '')
    .replace(/\b(the\s+)?(university|college|institute)\s+of\b/gi, '')
    .replace(/\b(university|college)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLookup(teams) {
  const byNorm = new Map();
  const add = (key, team) => {
    const k = normKey(key);
    if (!k) return;
    if (!byNorm.has(k)) byNorm.set(k, team);
  };
  for (const t of teams) {
    add(t.school, t);
    add(stripSuffixes(t.school), t);
    for (const a of ['alt_name1', 'alt_name2', 'alt_name3', 'abbreviation']) {
      if (t[a]) add(t[a], t);
    }
  }
  return byNorm;
}

/** Single-word stripSuffixes hits that map to the wrong program */
const STRIP_COLLISIONS = new Set([
  'northwestern', 'georgetown', 'miami', 'washington', 'carroll', 'union', 'marian',
  'southern', 'central', 'eastern', 'western', 'northern', 'southeastern',
]);

function findTeam(lookup, campName) {
  const alias = NAME_ALIASES[campName];
  const candidates = [campName, alias, alias ? stripSuffixes(alias) : null].filter(Boolean);
  const stripped = stripSuffixes(campName);
  if (stripped && stripped !== campName) {
    const key = normKey(stripped.split(/\s+/)[0]);
    if (!STRIP_COLLISIONS.has(key)) candidates.push(stripped);
  }
  for (const c of candidates) {
    const hit = lookup.get(normKey(c));
    if (hit) return hit;
  }
  return null;
}

function cleanColor(c) {
  if (!c) return null;
  c = String(c).trim();
  if (!c || c === '#000000' && false) return null;
  if (!c.startsWith('#')) c = '#' + c.replace(/^#/, '');
  if (c.length === 4) {
    c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null;
}

function isUsableColor(c) {
  if (!c) return false;
  const x = c.toLowerCase();
  return x !== '#000000' && x !== '#000' && x !== '#ffffff' && x !== '#fff';
}

function rowToMeta(row, source) {
  if (!row) return null;
  const primary = cleanColor(row.color || row.primary_color);
  const secondary = cleanColor(row.alt_color || row.alternateColor || row.secondary_color);
  return {
    mascot: row.mascot || null,
    primary_color: isUsableColor(primary) ? primary : null,
    secondary_color: isUsableColor(secondary) ? secondary : null,
    logo_url: row.logo || row.logo_url || (Array.isArray(row.logos) ? row.logos[0] : null) || null,
    city: row.city || null,
    source,
  };
}

async function fetchSdvTeams() {
  const res = await fetch(SDV_CSV_URL);
  if (!res.ok) throw new Error(`SDV CSV fetch failed: ${res.status}`);
  return parseCsv(await res.text());
}

async function fetchCfbdTeams(classification) {
  const key = process.env.CFBD_API_KEY;
  if (!key) return [];
  const url = new URL('https://api.collegefootballdata.com/teams');
  url.searchParams.set('year', String(CFBD_YEAR));
  if (classification) url.searchParams.set('classification', classification);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.warn(`CFBD ${classification || 'all'} failed: ${res.status}`);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function cfbdToMeta(t) {
  const loc = t.location || {};
  return rowToMeta(
    {
      mascot: t.mascot,
      color: t.color,
      alt_color: t.alternateColor,
      logos: t.logos,
      city: loc.city || null,
    },
    'cfbd',
  );
}

async function reverseGeocodeCity(lat, lng, cache) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache[key]) return cache[key];
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const city = data.city || data.locality || null;
  cache[key] = city;
  return city;
}

async function main() {
  const camps = JSON.parse(fs.readFileSync(CAMPS_FILE, 'utf8'));
  const coords = JSON.parse(fs.readFileSync(COORDS_FILE, 'utf8'));
  const overrides = fs.existsSync(OVERRIDES_FILE)
    ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'))
    : {};
  const geoCache = fs.existsSync(GEO_CACHE_FILE)
    ? JSON.parse(fs.readFileSync(GEO_CACHE_FILE, 'utf8'))
    : {};

  console.log('Fetching sportsdataverse team colors/logos…');
  const sdvTeams = await fetchSdvTeams();
  const sdvLookup = buildLookup(sdvTeams);

  const cfbdAll = [];
  if (process.env.CFBD_API_KEY) {
    console.log('Fetching CFBD teams (fbs, fcs, ii, iii)…');
    for (const cls of ['fbs', 'fcs', 'ii', 'iii']) {
      cfbdAll.push(...(await fetchCfbdTeams(cls)));
      await sleep(200);
    }
  } else {
    console.log('CFBD_API_KEY not set — using sportsdataverse CSV only for mascot/colors/logos');
  }
  const cfbdLookup = buildLookup(
    cfbdAll.map((t) => ({
      school: t.school,
      mascot: t.mascot,
      color: t.color,
      alt_color: t.alternateColor,
      logo: Array.isArray(t.logos) ? t.logos[0] : null,
      city: t.location?.city || null,
      alt_name1: t.abbreviation,
      alternateNames: t.alternateNames,
    })),
  );

  const meta = {};
  const stats = { mascot: 0, primary: 0, city: 0, logo: 0, override: 0, unmatched: [] };

  for (const camp of camps) {
    const name = camp.school_name;
    const o = overrides[name] || {};
    let m = {};

    const cfbdTeam = findTeam(cfbdLookup, o.cfbd_name || name);
    const sdvTeam = findTeam(sdvLookup, o.sdv_name || o.cfbd_name || name);

    if (cfbdTeam) Object.assign(m, cfbdToMeta(cfbdTeam) || {});
    if (sdvTeam) {
      const s = rowToMeta(sdvTeam, 'sdv');
      if (!m.mascot && s.mascot) m.mascot = s.mascot;
      if (!m.primary_color && s.primary_color) m.primary_color = s.primary_color;
      if (!m.secondary_color && s.secondary_color) m.secondary_color = s.secondary_color;
      if (!m.logo_url && s.logo_url) m.logo_url = s.logo_url;
      if (!m.city && s.city) m.city = s.city;
      if (!m.source) m.source = s.source;
    }

    if (o.mascot) m.mascot = o.mascot;
    if (o.primary_color) m.primary_color = cleanColor(o.primary_color) || o.primary_color;
    if (o.secondary_color) m.secondary_color = cleanColor(o.secondary_color) || o.secondary_color;
    if (o.logo_url) m.logo_url = o.logo_url;
    if (o.city) m.city = o.city;
    if (Object.keys(o).length) {
      m.source = 'override';
      stats.override++;
    }

    if (!m.logo_url) {
      const slug = name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      m.logo_url = `https://ncaa-api.henrygd.me/logo/${slug}.svg`;
      m.logo_fallback = true;
    }

    if (!m.city && coords[name]) {
      const [lat, lng] = coords[name];
      const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      if (geoCache[cacheKey]) {
        m.city = geoCache[cacheKey];
        m.city_source = 'geocode-cache';
      } else if (!SKIP_GEO) {
        const city = await reverseGeocodeCity(lat, lng, geoCache);
        if (city) {
          m.city = city;
          m.city_source = 'geocode';
        }
        await sleep(GEO_DELAY_MS);
      }
    }

    if (m.mascot) stats.mascot++;
    if (m.primary_color) stats.primary++;
    if (m.city) stats.city++;
    if (m.logo_url && !m.logo_fallback) stats.logo++;

    if (!m.mascot && !m.primary_color) stats.unmatched.push(`${name} (${camp.division})`);

    meta[name] = {
      city: m.city || null,
      mascot: m.mascot || null,
      primary_color: m.primary_color || null,
      secondary_color: m.secondary_color || null,
      logo_url: m.logo_url || null,
    };
  }

  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  fs.writeFileSync(GEO_CACHE_FILE, JSON.stringify(geoCache, null, 2));

  console.log(`\nWrote ${Object.keys(meta).length} entries → school_meta.json`);
  console.log(`  Mascot:        ${stats.mascot}/${camps.length}`);
  console.log(`  Primary color: ${stats.primary}/${camps.length}`);
  console.log(`  City:          ${stats.city}/${camps.length}`);
  console.log(`  Logo (non-fallback): ${stats.logo}/${camps.length}`);
  console.log(`  Manual overrides: ${stats.override}`);
  if (stats.unmatched.length) {
    console.log(`  Still missing mascot+color: ${stats.unmatched.length}`);
    stats.unmatched.slice(0, 15).forEach((s) => console.log(`    - ${s}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
