#!/usr/bin/env node
/**
 * Probe D2 camp URLs via totalcamps slug patterns + athletics Sidearm pages.
 * Merges verified hits into camp_url_overrides.json.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OVERRIDES = path.join(ROOT, 'camp_url_overrides.json');
const MASTER = path.join(ROOT, 'camps_master.json');
const REPORT = path.join(ROOT, 'd2_url_discovery_report.json');

/** Sidearm athletics host (when known) */
const ATHLETICS = {
  'Albany State': 'asugoldenrams.com',
  'Arkansas Tech': 'arkansastechsports.com',
  'Bemidji State': 'bsubeavers.com',
  'Central Missouri': 'ucmathletics.com',
  'Central Oklahoma': 'bronchosports.com',
  'Ferris State': 'ferrisstatebulldogs.com',
  'Fort Hays State': 'fhsuathletics.com',
  'Minnesota Duluth': 'umdbulldogs.com',
  'Nebraska-Kearney': 'unkantelope.com',
  'Northwest Missouri State': 'nwmissourisports.com',
  'Shepherd': 'shepherdrams.com',
  'Sioux Falls': 'usfcougars.com',
  'Washburn University': 'wusports.com',
  'West Florida': 'goargos.com',
  'Wayne State University': 'wsuathletics.com',
};

const SLUG_ALIASES = {
  'Nebraska-Kearney': ['nebraskakearney', 'unk'],
  'Missouri Western State': ['missouriwestern', 'missouriwesternstate'],
  'Minnesota State - Moorhead': ['minnesotastatemoorhead', 'msummoorhead', 'msum'],
  'PennWest Edinboro': ['pennwestedinboro', 'edinboro'],
  'UVA Wise': ['uvawise', 'uvawisecavs'],
  'University of Indianapolis': ['uindy', 'indianapolis', 'uindyfootball'],
  'Concordia University, St. Paul': ['concordiastpaul', 'cspbears', 'concordiasaintpaul'],
  'Emory and Henry College': ['emoryandhenry', 'emoryhenry'],
  'American International College': ['americaninternational', 'aic'],
  'Carson-Newman': ['carsonnewman'],
  'Fort Hays State': ['forthaysstate', 'fhsu'],
  'New Mexico Highlands': ['newmexicohighlands', 'nmhu'],
  'Northwest Missouri State': ['northwestmissouri', 'northwestmissouristate', 'nwmissouri'],
  'Southeastern Oklahoma State': ['southeasternoklahoma', 'seosu'],
  'Southern Arkansas': ['southernarkansas', 'mulerider'],
  'West Florida': ['westflorida', 'uwf'],
  'West Liberty': ['westliberty', 'wlutop'],
  'Chadron State College': ['chadronstate'],
  'Central State': ['centralstate', 'maraudersports'],
  'Bloomsburg University': ['bloomsburg', 'bloomsburghuskies'],
  'Kutztown University': ['kutztown'],
  'Michigan Tech': ['michigantech', 'mtuhuskies'],
  'Minnesota Duluth': ['minnesotaduluth', 'umd'],
  'Northwood University': ['northwood'],
  'Southwest Baptist University': ['southwestbaptist', 'sbu'],
  'Thomas More': ['thomasmore'],
  'Tiffin University': ['tiffin'],
  'Tuskegee': ['tuskegee'],
  'Virginia Union': ['virginiaunion', 'vuu'],
  'Walsh University': ['walsh', 'walshcavaliers'],
  'West Virginia State': ['westvirginiastate', 'wvsuyellowjackets'],
  'Western New Mexico': ['westernnewmexico', 'wnmu'],
  'Glenville State': ['glenvillestate', 'gscpioneers'],
  'Kentucky State': ['kentuckystate'],
  'Livingstone College': ['livingstone'],
  'Shorter University': ['shorter'],
  'Anderson University': ['anderson', 'andersonravens'],
  'Allen University': ['allen'],
  'Saint Anselm': ['saintanselm', 'anselm'],
  'Davenport University': ['davenport'],
  'Catawba College': ['catawba'],
  'Arkansas Tech': ['arkansastech'],
  'Albany State': ['albanystate'],
};

function baseSlugs(name) {
  const base = name.replace(/\([^)]*\)/g, '').trim();
  const parts = base.toLowerCase().split(/\s+/);
  const compact = parts.join('').replace(/[^a-z0-9]/g, '');
  const out = new Set([compact]);
  if (parts[parts.length - 1] === 'state') {
    out.add(parts.slice(0, -1).join('').replace(/[^a-z0-9]/g, '') + 'state');
  }
  const noUni = base.replace(/\b(university|college)\b/gi, '').trim();
  out.add(noUni.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const a of SLUG_ALIASES[name] || []) out.add(a.replace(/[^a-z0-9]/g, ''));
  return [...out].filter((s) => s.length >= 4);
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
  .filter((s) => s.division === 'D2' && !s.registration_url && !overrides[s.school_name])
  .map((s) => s.school_name);

console.log(`Probing ${missing.length} D2 schools…\n`);
const report = [];
let found = 0;

for (const name of missing) {
  process.stdout.write(`  ${name}… `);
  let hit = null;
  for (const url of candidates(name)) {
    hit = await probe(url, ATHLETICS[name] || null);
    if (hit) break;
    await new Promise((r) => setTimeout(r, 70));
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
console.log(`\nFound ${found} D2 URLs (${Object.keys(overrides).length} total overrides)`);
