#!/usr/bin/env node
/**
 * Probe NAIA camp URLs via totalcamps slug patterns.
 * Merges verified hits into camp_url_overrides.json.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OVERRIDES = path.join(ROOT, 'camp_url_overrides.json');
const MASTER = path.join(ROOT, 'camps_master.json');
const REPORT = path.join(ROOT, 'naia_url_discovery_report.json');

const SLUG_ALIASES = {
  'Ave Maria University': ['avemaria', 'amugyrenes'],
  'Baker University': ['baker'],
  'Campbellsville University': ['campbellsville'],
  'Carroll College': ['carrollcollege', 'carrollmt'],
  'Dakota State University': ['dakotastate', 'dsu'],
  'Georgetown College': ['georgetowncollege', 'georgetownky'],
  'Graceland University': ['graceland'],
  'Keiser University': ['keiser'],
  'Lindsey Wilson College': ['lindseywilson', 'lwc'],
  'Missouri Baptist University': ['missouribaptist', 'mobap'],
  'Missouri Valley College': ['missourivalley', 'mvc'],
  'Montana Tech': ['montanatech', 'mttech'],
  'Northwestern College': ['northwesterncollege', 'nwcraiders'],
  'Olivet Nazarene University': ['olivetnazarene', 'onu'],
  'Reinhardt University': ['reinhardt'],
  'St. Thomas University': ['stthomas', 'stthomasu'],
  'Union Commonwealth University': ['unioncommonwealth', 'unionky'],
  'University of Jamestown': ['jamestown', 'ujamestown'],
  'University of Pikeville': ['pikeville', 'upike'],
  'University of Rio Grande': ['riogrande', 'rio'],
  'Valley City State University': ['valleycitystate', 'vcsu'],
};

function baseSlugs(name) {
  const base = name.replace(/\([^)]*\)/g, '').trim();
  const parts = base.toLowerCase().split(/\s+/);
  const compact = parts.join('').replace(/[^a-z0-9]/g, '');
  const out = new Set([compact]);
  const noUni = base.replace(/\b(university|college)\b/gi, '').trim();
  out.add(noUni.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const a of SLUG_ALIASES[name] || []) out.add(a.replace(/[^a-z0-9]/g, ''));
  return [...out].filter((s) => s.length >= 3);
}

function candidates(name) {
  const urls = new Set();
  for (const s of baseSlugs(name)) {
    urls.add(`https://${s}footballcamps.totalcamps.com/`);
    urls.add(`https://${s}football.totalcamps.com/`);
    urls.add(`https://www.${s}footballcamps.com/`);
    urls.add(`https://${s}footballcamps.com/`);
  }
  return [...urls];
}

async function probe(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 REC101-CampHub/1.0' },
    });
    if (res.status >= 400) return null;
    const final = res.url || url;
    if (final.includes('totalcamps.com')) return final;
    const text = (await res.text()).slice(0, 8000).toLowerCase();
    if (/404 not found|404-1\.aspx|page not found/.test(text.slice(0, 1000))) return null;
    if (!/football|camp|register/.test(text)) return null;
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
  .filter((s) => s.division === 'NAIA' && !s.registration_url && !overrides[s.school_name])
  .map((s) => s.school_name);

console.log(`Probing ${missing.length} NAIA schools…\n`);
const report = [];
let found = 0;

for (const name of missing) {
  process.stdout.write(`  ${name}… `);
  let hit = null;
  for (const url of candidates(name)) {
    hit = await probe(url);
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
console.log(`\nFound ${found} NAIA URLs (${Object.keys(overrides).length} total overrides)`);
