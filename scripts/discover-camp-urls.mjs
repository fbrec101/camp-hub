#!/usr/bin/env node
/**
 * Probe common camp URL patterns for schools missing registration_url.
 * Writes/merges camp_url_overrides.json (verified hits only).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'camps_raw.json');
const MANUAL = path.join(ROOT, 'manual_camps.json');
const OVERRIDES = path.join(ROOT, 'camp_url_overrides.json');
const OUT_REPORT = path.join(ROOT, 'camp_url_discovery_report.json');

const LIMIT = Number(process.env.DISCOVER_LIMIT || 0);
const DIVISION_FILTER = process.env.DISCOVER_DIVISION || '';

function slugVariants(name) {
  const base = name.replace(/\([^)]*\)/g, '').trim();
  const out = new Set();
  const parts = base.toLowerCase().split(/\s+/);
  const compact = parts.join('').replace(/[^a-z0-9]/g, '');
  out.add(compact);
  if (parts[parts.length - 1] === 'state') {
    out.add(parts.slice(0, -1).join('').replace(/[^a-z0-9]/g, ''));
  }
  const noUni = base.replace(/\b(university|college)\b/gi, '').trim();
  out.add(noUni.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return [...out].filter((s) => s.length >= 4);
}

function urlMatchesSchool(url, name) {
  const u = url.toLowerCase();
  if (/\.edu|sports|athletics|sidearm|totalcamps|activekids|thegoodgame/.test(u)) return true;
  const slugs = slugVariants(name).sort((a, b) => b.length - a.length);
  const host = u.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  const primary = slugs[0];
  if (primary.length >= 6 && (host.includes(primary) || u.includes(primary))) return true;
  // Avoid "Alabama State" matching alabamafootballcamp.com via short "alabama" slug
  if (/\bstate\b/i.test(name) && primary.endsWith('state')) {
    return host.includes(primary) || u.includes(primary);
  }
  return slugs.some((slug) => slug.length >= 8 && (host.includes(slug) || u.includes(slug)));
}

function candidates(name) {
  const slugs = slugVariants(name);
  const urls = new Set();
  for (const s of slugs) {
    urls.add(`https://www.${s}footballcamps.com/`);
    urls.add(`https://${s}footballcamps.com/`);
    urls.add(`https://www.${s}footballcamp.com/`);
    urls.add(`https://${s}footballcamp.com/`);
    urls.add(`https://${s}footballcamps.totalcamps.com/`);
    urls.add(`https://${s}football.totalcamps.com/`);
    urls.add(`https://www.${s}football.totalcamps.com/`);
  }
  if (name === 'BYU') urls.add('https://www.byusportscamps.com/');
  return [...urls];
}

async function probe(url, schoolName) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'REC101-CampHub/1.0 (gap-fill)' },
    });
    clearTimeout(t);
    if (res.status >= 400) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    const text = (await res.text()).slice(0, 12000).toLowerCase();
    const hit =
      /register|registration|camp|football|2026|enroll/.test(text) &&
      !/404|not found|domain for sale|parked|coming soon/.test(text.slice(0, 500));
    const final = res.url || url;
    return hit && urlMatchesSchool(final, schoolName) ? final : null;
  } catch {
    return null;
  }
}

function mergeSchools(data) {
  const m = new Map();
  for (const e of data) {
    const k = e.school_name;
    if (m.has(k)) {
      const x = m.get(k);
      if (!x.registration_url && e.registration_url) x.registration_url = e.registration_url;
    } else {
      m.set(k, { ...e });
    }
  }
  return [...m.values()];
}

const existing = fs.existsSync(OVERRIDES)
  ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'))
  : {};
const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const manual = fs.existsSync(MANUAL) ? JSON.parse(fs.readFileSync(MANUAL, 'utf8')) : [];
const merged = mergeSchools([...raw, ...manual]);

let missing = merged.filter((s) => !s.registration_url && !existing[s.school_name]);
if (DIVISION_FILTER) missing = missing.filter((s) => s.division === DIVISION_FILTER);
missing.sort((a, b) => {
  const rank = { FBS: 0, FCS: 1, D2: 2, D3: 3, NAIA: 4 };
  return (rank[a.division] ?? 9) - (rank[b.division] ?? 9);
});
if (LIMIT > 0) missing = missing.slice(0, LIMIT);

console.log(`Probing ${missing.length} schools (${DIVISION_FILTER || 'all divisions'})…`);

const report = [];
let found = 0;

for (const school of missing) {
  process.stdout.write(`  ${school.school_name} (${school.division})… `);
  let hit = null;
  for (const url of candidates(school.school_name)) {
    hit = await probe(url, school.school_name);
    if (hit) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  if (hit) {
    existing[school.school_name] = hit;
    found++;
    console.log(`✓ ${hit}`);
    report.push({ school: school.school_name, division: school.division, url: hit, method: 'probe' });
  } else {
    console.log('—');
    report.push({ school: school.school_name, division: school.division, url: null });
  }
}

fs.writeFileSync(OVERRIDES, JSON.stringify(existing, null, 2));
fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));
console.log(`\nFound ${found} new URLs → ${OVERRIDES} (${Object.keys(existing).length} total overrides)`);
