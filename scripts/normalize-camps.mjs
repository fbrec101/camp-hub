#!/usr/bin/env node
/**
 * Normalize camp data for the current season:
 * - Merge duplicate school entries
 * - Drop past dates (relative to CAMP_SEASON_AS_OF)
 * - Attach state from school_coords.json
 * - Normalize registration URLs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAMPS_FILE = path.join(ROOT, 'camps_master.json');
const COORDS_FILE = path.join(ROOT, 'school_coords.json');

const AS_OF = process.env.CAMP_SEASON_AS_OF || '2026-05-31';
const CAMP_YEAR = Number(process.env.CAMP_YEAR || 2026);

const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
  april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
  august: 7, aug: 7, september: 8, sep: 8, october: 9, nov: 10, december: 11,
};

const STATE_BBOX = [
  ['AL', 30.2, 35.0, -88.5, -84.9], ['AK', 51.0, 71.5, -179.0, -129.0],
  ['AZ', 31.3, 37.0, -114.8, -109.0], ['AR', 33.0, 36.5, -94.6, -89.6],
  ['CA', 32.5, 42.0, -124.5, -114.1], ['CO', 37.0, 41.0, -109.1, -102.0],
  ['CT', 41.0, 42.1, -73.7, -71.8], ['DE', 38.4, 39.8, -75.8, -75.0],
  ['FL', 24.5, 31.0, -87.6, -80.0], ['GA', 30.4, 35.0, -85.6, -80.8],
  ['HI', 18.9, 22.3, -160.3, -154.8], ['ID', 42.0, 49.0, -117.2, -111.0],
  ['IL', 37.0, 42.5, -91.5, -87.5], ['IN', 37.8, 41.8, -88.1, -84.8],
  ['IA', 40.4, 43.5, -96.6, -90.1], ['KS', 37.0, 40.0, -102.1, -94.6],
  ['KY', 36.5, 39.2, -89.6, -81.9], ['LA', 29.0, 33.0, -94.0, -88.8],
  ['ME', 43.0, 47.5, -71.1, -66.9], ['MD', 37.9, 39.7, -79.5, -75.0],
  ['MA', 41.2, 42.9, -73.5, -69.9], ['MI', 41.7, 48.3, -90.4, -82.4],
  ['MN', 43.5, 49.4, -97.2, -89.5], ['MS', 30.2, 35.0, -91.7, -88.1],
  ['MO', 36.0, 40.6, -95.8, -89.1], ['MT', 45.0, 49.0, -116.1, -104.0],
  ['NE', 40.0, 43.0, -104.1, -95.3], ['NV', 35.0, 42.0, -120.0, -114.0],
  ['NH', 42.7, 45.3, -72.6, -70.6], ['NJ', 38.9, 41.4, -75.6, -73.9],
  ['NM', 31.3, 37.0, -109.1, -103.0], ['NY', 40.5, 45.0, -79.8, -71.9],
  ['NC', 33.8, 36.6, -84.3, -75.5], ['ND', 45.9, 49.0, -104.1, -96.6],
  ['OH', 38.4, 42.0, -84.8, -80.5], ['OK', 33.6, 37.0, -103.0, -94.4],
  ['OR', 42.0, 46.3, -124.6, -116.5], ['PA', 39.7, 42.3, -80.5, -74.7],
  ['RI', 41.1, 42.0, -71.9, -71.1], ['SC', 32.0, 35.2, -83.4, -78.5],
  ['SD', 42.5, 45.9, -104.1, -96.4], ['TN', 35.0, 36.7, -90.3, -81.6],
  ['TX', 25.8, 36.5, -106.7, -93.5], ['UT', 37.0, 42.0, -114.1, -109.0],
  ['VT', 42.7, 45.0, -73.4, -71.5], ['VA', 36.5, 39.5, -83.7, -75.2],
  ['WA', 45.5, 49.0, -124.8, -116.9], ['WV', 37.2, 40.6, -82.6, -77.7],
  ['WI', 42.5, 47.1, -92.9, -86.8], ['WY', 41.0, 45.0, -111.1, -104.0],
  ['DC', 38.8, 39.0, -77.1, -76.9],
];

function stateFromCoords(lat, lng) {
  for (const [code, minLat, maxLat, minLng, maxLng] of STATE_BBOX) {
    if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) return code;
  }
  return null;
}

function parseDateStr(raw) {
  let s = String(raw).trim();
  let year = CAMP_YEAR;
  const ym = s.match(/\b(20\d{2})\b/);
  if (ym) {
    year = parseInt(ym[1], 10);
    s = s.replace(/,?\s*20\d{2}/, '').trim();
  }
  const range = s.match(/^([A-Za-z]+)\s+(\d+)\s*[-–]\s*(\d+)$/);
  if (range) {
    const m = MONTHS[range[1].toLowerCase()];
    if (m == null) return null;
    return { start: new Date(year, m, parseInt(range[2], 10)), end: new Date(year, m, parseInt(range[3], 10)), raw };
  }
  const parts = s.split(/\s+/);
  const m = MONTHS[(parts[0] || '').toLowerCase()];
  const day = parseInt(parts[1], 10);
  if (m == null || Number.isNaN(day)) return null;
  const d = new Date(year, m, day);
  return { start: d, end: d, raw };
}

function formatDate(parsed) {
  const d = parsed.start;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const base = `${months[d.getMonth()]} ${d.getDate()}`;
  if (parsed.end.getTime() !== parsed.start.getTime()) {
    return `${base}–${parsed.end.getDate()}, ${d.getFullYear()}`;
  }
  return `${base}, ${d.getFullYear()}`;
}

function normalizeUrl(u) {
  if (!u) return null;
  u = String(u).trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function mergeSchools(data) {
  const m = new Map();
  for (const e of data) {
    const k = e.school_name;
    if (m.has(k)) {
      const x = m.get(k);
      x.camp_types = [...new Set([...x.camp_types, ...e.camp_types])];
      x.dates = [...new Set([...x.dates, ...e.dates])];
      if (!x.registration_url && e.registration_url) x.registration_url = e.registration_url;
      if (!x.twitter_handle && e.twitter_handle) x.twitter_handle = e.twitter_handle;
      if (!x.city && e.city) x.city = e.city;
    } else {
      m.set(k, {
        ...e,
        camp_types: [...e.camp_types],
        dates: [...e.dates],
      });
    }
  }
  return [...m.values()];
}

const asOfDate = new Date(AS_OF + 'T12:00:00');
const coords = JSON.parse(fs.readFileSync(COORDS_FILE, 'utf8'));
const raw = JSON.parse(fs.readFileSync(CAMPS_FILE, 'utf8'));
const merged = mergeSchools(raw);

const out = [];

for (const school of merged) {
  const c = coords[school.school_name];
  const state = c ? stateFromCoords(c[0], c[1]) : null;

  const allParsed = [];
  for (const dt of school.dates || []) {
    const p = parseDateStr(dt);
    if (!p) continue;
    allParsed.push({ ...p, display: formatDate(p) });
  }
  allParsed.sort((a, b) => a.start - b.start);
  if (!allParsed.length) continue;

  const upcoming = allParsed.filter((d) => d.end >= asOfDate);
  const displayDates = (upcoming.length ? upcoming : allParsed).map((d) => d.display);
  const nextSort = (upcoming[0] || allParsed[allParsed.length - 1]).start.toISOString().slice(0, 10);

  out.push({
    school_name: school.school_name,
    division: school.division,
    conference: school.conference,
    state,
    camp_types: [...new Set(school.camp_types)].sort(),
    dates: displayDates,
    date_sort: nextSort,
    registration_url: normalizeUrl(school.registration_url),
    twitter_handle: school.twitter_handle || null,
    status: upcoming.length ? 'upcoming' : 'completed',
  });
}

out.sort((a, b) => {
  if (a.status !== b.status) return a.status === 'upcoming' ? -1 : 1;
  return a.date_sort.localeCompare(b.date_sort);
});

fs.writeFileSync(CAMPS_FILE, JSON.stringify(out, null, 2));
console.log(`Normalized ${out.length} schools (${out.filter(s => s.status === 'upcoming').length} upcoming, ${out.filter(s => s.status === 'completed').length} completed)`);
console.log(`June camps: ${out.filter(s => s.dates.some(d => d.startsWith('June'))).length} schools`);
