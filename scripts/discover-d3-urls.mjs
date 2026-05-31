#!/usr/bin/env node
/**
 * Probe D3 camp URLs via totalcamps slug patterns + athletics Sidearm pages.
 * Merges verified hits into camp_url_overrides.json.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OVERRIDES = path.join(ROOT, 'camp_url_overrides.json');
const MASTER = path.join(ROOT, 'camps_master.json');
const REPORT = path.join(ROOT, 'd3_url_discovery_report.json');

const ATHLETICS = {
  'John Carroll University': 'jcuathletics.com',
  'Case Western Reserve University': 'athletics.case.edu',
  'University of Chicago': 'athletics.uchicago.edu',
  'Middlebury College': 'middlebury.edu',
  'Denison University': 'denisonbigred.com',
  'Hope College': 'hope.edu',
  'Wheaton College (IL)': 'athletics.wheaton.edu',
};

const SLUG_ALIASES = {
  'Claremont-Mudd-Scripps': ['claremontmudscripps', 'cmsathletics', 'cms'],
  'Franklin & Marshall College': ['franklinandmarshall', 'fandm', 'fandmdiplomats'],
  'Washington & Jefferson College': ['washingtonandjefferson', 'wj', 'wjathletics'],
  'Washington & Lee University': ['washingtonandlee', 'wlu', 'wlugenerals'],
  'Washington University in St. Louis': ['washingtonuniversityinstlouis', 'washu', 'bearings'],
  'University of Wisconsin-Eau Claire': ['uwec', 'wisconsineauclaire', 'uwegauclaire'],
  'University of Wisconsin-Oshkosh': ['uwosh', 'wisconsinoshkosh'],
  'University of Wisconsin-Platteville': ['uwplatteville', 'wisconsinplatteville'],
  'University of Wisconsin-River Falls': ['uwrf', 'wisconsinriverfalls'],
  'University of Wisconsin-Stevens Point': ['uwsp', 'wisconsinstevenspoint'],
  'University of Wisconsin-Whitewater': ['uww', 'wisconsinwhitewater'],
  'University of Minnesota Morris': ['minnesotamorris', 'ummorris'],
  'University of New England': ['unewengland', 'une'],
  'University of La Verne': ['laverne', 'ulv'],
  'University of Dubuque': ['dubuque', 'udubuque'],
  'University of Chicago': ['uchicago', 'chicago'],
  'Massachusetts Maritime Academy': ['massachusettsmaritime', 'massmaritime'],
  'Rose-Hulman Institute of Technology': ['rosehulman', 'rosehulmaninstituteoftechnology'],
  'Texas Lutheran University': ['texaslutheran', 'tlu'],
  'Wisconsin Lutheran College': ['wisconsinlutheran', 'wlc'],
  'Nebraska Wesleyan University': ['nebraskawesleyan', 'nwu'],
  'Howard Payne University': ['howardpayne', 'hputx'],
  'Mount St. Joseph University': ['mountstjoseph', 'msj'],
  "King's College": ['kingscollege', 'kings'],
  'Lebanon Valley College': ['lebanonvalley', 'lvc'],
  'Trinity University': ['trinity', 'trinitytx'],
  'Union College': ['union', 'unioncollege'],
  'Wheaton College (IL)': ['wheaton', 'wheatoncollege'],
  'Case Western Reserve University': ['casewesternreserve', 'cwru'],
  'John Carroll University': ['johncarroll', 'jcu'],
  'MIT': ['mit'],
  'WPI': ['wpi'],
  'Amherst College': ['amherst'],
  'Bowdoin College': ['bowdoin'],
  'Middlebury College': ['middlebury'],
  'Wesleyan University': ['wesleyan'],
  'Hamilton College': ['hamilton'],
  'Bates College': ['bates'],
  'Whittier College': ['whittier'],
  'Millsaps College': ['millsaps'],
  'Lyon College': ['lyon'],
  'Crown College': ['crowncollege', 'crown'],
};

function baseSlugs(name) {
  const base = name.replace(/\([^)]*\)/g, '').trim();
  const parts = base.toLowerCase().split(/\s+/);
  const compact = parts.join('').replace(/[^a-z0-9]/g, '');
  const out = new Set([compact]);
  const noUni = base.replace(/\b(university|college|institute of technology)\b/gi, '').trim();
  out.add(noUni.toLowerCase().replace(/[^a-z0-9]/g, ''));
  out.add(
    base
      .replace(/\b(university|college)\b/gi, '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase(),
  );
  for (const a of SLUG_ALIASES[name] || []) out.add(a.replace(/[^a-z0-9]/g, ''));
  return [...out].filter((s) => s.length >= 3);
}

const SIDEARM = [
  '/sports/2020/5/29/football-camps',
  '/sports/2023/4/20/2026-summer-camps',
  '/sports/football/camps',
];

function candidates(name) {
  const urls = new Set();
  for (const s of baseSlugs(name)) {
    urls.add(`https://${s}footballcamps.totalcamps.com/`);
    urls.add(`https://${s}football.totalcamps.com/`);
    urls.add(`https://www.${s}footballcamps.com/`);
    urls.add(`https://${s}footballcamps.com/`);
  }
  const host = ATHLETICS[name];
  if (host) {
    for (const p of SIDEARM) urls.add(`https://${host}${p}`);
  }
  return [...urls];
}

async function probe(url, athleticsHost) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 REC101-CampHub/1.0' },
    });
    if (res.status >= 400) return null;
    const final = res.url || url;
    if (final.includes('totalcamps.com')) return final;
    if (!athleticsHost) return null;
    const host = new URL(final).hostname.replace(/^www\./, '');
    if (!host.includes(athleticsHost.split('.')[0])) return null;
    const text = (await res.text()).slice(0, 12000).toLowerCase();
    if (/404 not found|404-1\.aspx|page not found/.test(text.slice(0, 1200))) return null;
    if (!/football/.test(text)) return null;
    return final;
  } catch {
    return null;
  }
}

const overrides = fs.existsSync(OVERRIDES)
  ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'))
  : {};
const master = JSON.parse(fs.readFileSync(MASTER, 'utf8'));
const missing = master
  .filter((s) => s.division === 'D3' && !s.registration_url && !overrides[s.school_name])
  .map((s) => s.school_name);

console.log(`Probing ${missing.length} D3 schools…\n`);
const report = [];
let found = 0;

for (const name of missing) {
  process.stdout.write(`  ${name}… `);
  let hit = null;
  for (const url of candidates(name)) {
    hit = await probe(url, ATHLETICS[name] || null);
    if (hit) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  if (hit) {
    overrides[name] = hit;
    found++;
    console.log(`✓ ${hit}`);
    report.push({ school: name, url: hit, ok: true });
  } else {
    console.log('—');
    report.push({ school: name, url: null, ok: false });
  }
}

fs.writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2));
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`\nFound ${found} D3 URLs (${Object.keys(overrides).length} total overrides)`);
