#!/usr/bin/env node
/**
 * Probe FCS athletics domains + totalcamps patterns for missing camp URLs.
 * Merges hits into camp_url_overrides.json.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OVERRIDES = path.join(ROOT, 'camp_url_overrides.json');
const MASTER = path.join(ROOT, 'camps_master.json');
const REPORT = path.join(ROOT, 'fcs_url_discovery_report.json');

/** Known Sidearm / athletics host per FCS program */
const ATHLETICS = {
  'Alabama State': 'bamastatebulls.com',
  'Arkansas-Pine Bluff': 'uapblions.com',
  'Brown': 'brownbears.com',
  'Bryant': 'bryantbulldogs.com',
  'Cal Poly': 'gopoly.com',
  'Campbell': 'gocamels.com',
  'Central Connecticut State': 'ccsubluedevils.com',
  'Charleston Southern': 'csusports.com',
  'Chattanooga': 'gomocs.com',
  'Colgate': 'gocolgate.com',
  'Cornell': 'cornellbigred.com',
  'Dayton': 'daytonflyers.com',
  'Eastern Illinois': 'eiupanthers.com',
  'Eastern Washington': 'goeags.com',
  'Elon': 'elonphoenix.com',
  'FAMU': 'famuathletics.com',
  'Grambling State': 'gsutigers.com',
  'Idaho': 'govandals.com',
  'Jackson State': 'gojsutigers.com',
  'Lafayette': 'goleopards.com',
  'Marist': 'goredfoxes.com',
  'Morgan State': 'morganstatebears.com',
  'New Haven': 'newhavenchargers.com',
  'Nicholls State': 'nichollsgovikes.com',
  'Penn': 'pennathletics.com',
  'Prairie View A&M': 'pvpanthers.com',
  'Rhode Island': 'gorhody.com',
  'Robert Morris': 'rmucolonials.com',
  'Sacred Heart': 'sacredheartpioneers.com',
  'San Diego': 'usdtoreros.com',
  'South Carolina State': 'scsuathletics.com',
  'South Dakota': 'goyotes.com',
  'South Dakota State': 'gojacks.com',
  'Southeast Missouri State': 'semoredhawks.com',
  'Stony Brook': 'stonybrookathletics.com',
  'Tennessee Tech': 'tntechsports.com',
  'The Citadel': 'citadelsports.com',
  'Towson': 'towsontigers.com',
  'UC Davis': 'ucdavisaggies.com',
  'UIW': 'uiwcardinals.com',
  'University of St. Thomas': 'tommiesports.com',
  'Utah Tech': 'utahtechtrailblazers.com',
  'Weber State': 'weberstatesports.com',
  'Western Carolina': 'catamountsports.com',
  'Western Illinois': 'goleathernecks.com',
  'William & Mary': 'tribeathletics.com',
  'Wofford': 'woffordterriers.com',
  'Youngstown State': 'ysusports.com',
};

const SIDEARM_PATHS = [
  '/sports/2020/5/29/football-camps',
  '/sports/2023/4/20/2026-summer-camps',
  '/sports/2024/5/31/football-camps',
  '/sports/football/camps',
  '/sports/m-footbl/camps',
  '/sports/m-footbl/camp-html',
  '/sports/2016/6/10/camps-m-footbl-camp-html',
  '/camps',
];

function slugVariants(name) {
  const base = name.replace(/\([^)]*\)/g, '').trim();
  const parts = base.toLowerCase().split(/\s+/);
  const compact = parts.join('').replace(/[^a-z0-9]/g, '');
  const out = new Set([compact]);
  if (parts[parts.length - 1] === 'state') {
    out.add(parts.slice(0, -1).join('').replace(/[^a-z0-9]/g, ''));
  }
  return [...out].filter((s) => s.length >= 4);
}

function extraCandidates(name) {
  const urls = [];
  for (const s of slugVariants(name)) {
    urls.push(`https://${s}footballcamps.totalcamps.com/`);
    urls.push(`https://${s}football.totalcamps.com/`);
    urls.push(`https://www.${s}footballcamps.com/`);
  }
  const extras = {
    'Alabama State': ['https://www.alabamastatefootballcamps.com/'],
    'Arkansas-Pine Bluff': ['https://www.uapblionsfootballcamps.com/'],
    'Chattanooga': ['https://www.gomocsfootballcamps.com/'],
    'Idaho': ['https://www.govandalsfootballcamps.com/'],
    'Jackson State': ['https://www.gojsutigersfootballcamps.com/'],
    'Youngstown State': ['https://www.ysusportsfootballcamps.com/'],
    'Weber State': ['https://www.weberstatefootballcamps.com/'],
    'UC Davis': ['https://www.ucdavisfootballcamps.com/'],
    'The Citadel': ['https://www.citadelsportsfootballcamps.com/'],
    'William & Mary': ['https://www.tribefootballcamps.com/'],
    'Penn': ['https://www.pennfootballcamps.com/'],
    'Cornell': ['https://www.cornellfootballcamps.com/'],
    'Brown': ['https://www.brownfootballcamps.com/'],
  };
  if (extras[name]) urls.push(...extras[name]);
  return urls;
}

function candidatesFor(name) {
  const urls = new Set(extraCandidates(name));
  const host = ATHLETICS[name];
  if (host) {
    for (const p of SIDEARM_PATHS) urls.add(`https://${host}${p}`);
    urls.add(`https://www.${host}/sports/2020/5/29/football-camps`);
  }
  return [...urls];
}

function expectedHost(name) {
  return ATHLETICS[name]?.replace(/^www\./, '') || null;
}

async function probe(url, expectedHost) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 REC101-CampHub/1.0' },
    });
    if (res.status >= 400) return null;
    const final = res.url || url;
    const finalHost = new URL(final).hostname.replace(/^www\./, '');
    if (expectedHost) {
      const root = expectedHost.replace(/^www\./, '').split('.')[0];
      if (!finalHost.includes(root)) return null;
    }
    const text = (await res.text()).slice(0, 20000).toLowerCase();
    const bad =
      /404 not found|page not found|domain for sale|404-1\.aspx|this page could not be found|page you're looking for|error 404|our-menu|hubcoffee/.test(
        text.slice(0, 1500),
      );
    if (bad) return null;
    if (!/football/.test(text)) return null;
    const good = /camp|register|2026|clinic|prospect|totalcamps|sportscamps/.test(text);
    return good ? final : null;
  } catch {
    return null;
  }
}

const overrides = fs.existsSync(OVERRIDES)
  ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'))
  : {};
const master = JSON.parse(fs.readFileSync(MASTER, 'utf8'));
const missing = master
  .filter((s) => s.division === 'FCS' && !s.registration_url && !overrides[s.school_name])
  .map((s) => s.school_name);

console.log(`Probing ${missing.length} FCS schools…\n`);
const report = [];
let found = 0;

for (const name of missing) {
  process.stdout.write(`  ${name}… `);
  let hit = null;
  for (const url of candidatesFor(name)) {
    hit = await probe(url, expectedHost(name));
    if (hit) break;
    await new Promise((r) => setTimeout(r, 80));
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
console.log(`\nFound ${found} FCS URLs (${Object.keys(overrides).length} total overrides)`);
