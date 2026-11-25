import { DOMParser } from '@xmldom/xmldom';
import { kml } from '@tmcw/togeojson';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fc, getJson, getText, memo, type FC } from './cache';
import { countryCounts } from './ransom';
import { parseWikidataPoint, UFO_QUERY } from './ufo';
import { bboxOk, overpassQuery, type Bbox, type OverpassKind } from './overpass';

const CC0 = 'CC0';
const ODBL = 'Open Database License (ODbL)';
const PD = 'Public domain';

function point(lng: number, lat: number, properties: Record<string, unknown>) {
  return { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] }, properties };
}

let countryCache: { iso: string; iso3: string; name: string; lng: number; lat: number }[] | null = null;

export async function countryIndex(): Promise<{ iso: string; iso3: string; name: string; lng: number; lat: number }[]> {
  if (countryCache) return countryCache;
  const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ join(process.cwd(), 'public/data/countries-110m.geojson'), 'utf8'));
  const rows = (raw.features || []).map((f: any) => {
    const c = centroid(f.geometry);
    return { iso: f.properties?.iso || '', iso3: f.properties?.iso3 || '', name: f.properties?.name || '', lng: c[0], lat: c[1] };
  }).filter((c: { iso: string }) => c.iso);
  countryCache = rows;
  return rows;
}

function centroid(geometry: any): [number, number] {
  const coords: number[][] = [];
  const walk = (g: any) => {
    if (!g) return;
    if (typeof g[0] === 'number') coords.push(g as number[]);
    else if (Array.isArray(g)) g.forEach(walk);
  };
  walk(geometry?.coordinates);
  if (!coords.length) return [0, 0];
  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [lng, lat];
}

const nhcCache = memo<FC>(10 * 60_000);
export function loadNhc() {
  return nhcCache(async () => {
    const attr = 'Cones, tracks and warnings: NOAA National Hurricane Center';
    try {
      const data = await getJson<any>('https://www.nhc.noaa.gov/CurrentStorms.json');
      const storms: any[] = Array.isArray(data?.activeStorms) ? data.activeStorms : [];
      const features: any[] = [];
      for (const storm of storms) {
        const lat = Number(storm.latitudeNumeric ?? storm.lat);
        const lng = Number(storm.longitudeNumeric ?? storm.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          features.push(point(lng, lat, {
            kind: 'center', name: storm.name || storm.id, class: storm.classification, intensity: storm.intensity,
          }));
        }
        for (const zip of gisZips(storm)) {
          try {
            const res = await fetch(zip.url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'OSIRIS-public-dashboard/1.0' } });
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            const shp = (await import('shpjs')).default;
            const parsed = await shp(buf);
            for (const collection of collections(parsed)) {
              for (const feature of collection.features || []) {
                features.push({ ...feature, properties: { ...(feature.properties || {}), kind: zip.kind, name: storm.name || storm.id } });
              }
            }
          } catch { /* one product missing is not a failed storm */ }
        }
      }
      return fc(features, attr, PD);
    } catch (e) {
      return fc([], attr, PD, e instanceof Error ? e.message : 'NHC unavailable');
    }
  });
}

function gisZips(storm: any): { url: string; kind: string }[] {
  const out: { url: string; kind: string }[] = [];
  const walk = (node: any, key: string) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.zipFile === 'string') out.push({ url: node.zipFile, kind: kindOf(key) });
    for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, k);
  };
  walk(storm, '');
  return out;
}

export function kindOf(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('cone') || k.includes('pgn')) return 'cone';
  if (k.includes('warn') || k.includes('watch')) return 'warning';
  if (k.includes('track') || k.includes('lin') || k.includes('pts')) return 'track';
  return 'storm';
}

function collections(parsed: any): { features: any[] }[] {
  if (!parsed) return [];
  if (parsed.type === 'FeatureCollection') return [parsed];
  if (Array.isArray(parsed)) return parsed.filter(p => p?.type === 'FeatureCollection');
  return Object.values(parsed).filter((p: any) => p?.type === 'FeatureCollection') as { features: any[] }[];
}

const peerCache = memo<FC>(24 * 60 * 60_000);
export function loadPeeringDb() {
  return peerCache(async () => {
    const attr = 'IXPs and facilities: PeeringDB';
    const license = 'PeeringDB database terms; attribute PeeringDB';
    try {
      const facs = await pdb('fac');
      const ix = await pdb('ix');
      const links = await pdb('ixfac');
      const byFac = new Map<number, any>();
      const features: any[] = [];
      for (const f of facs) {
        const lat = Number(f.latitude);
        const lng = Number(f.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        byFac.set(f.id, f);
        features.push(point(lng, lat, { kind: 'facility', name: f.name, city: f.city, country: f.country }));
      }
      const ixPoints = new Map<number, { name: string; lng: number; lat: number; n: number }>();
      for (const link of links) {
        const fac = byFac.get(link.fac_id);
        if (!fac) continue;
        const cur = ixPoints.get(link.ix_id) || { name: '', lng: 0, lat: 0, n: 0 };
        cur.lng += Number(fac.longitude);
        cur.lat += Number(fac.latitude);
        cur.n += 1;
        ixPoints.set(link.ix_id, cur);
      }
      for (const row of ix) {
        const acc = ixPoints.get(row.id);
        if (!acc?.n) continue;
        features.push(point(acc.lng / acc.n, acc.lat / acc.n, { kind: 'ix', name: row.name, city: row.city, country: row.country, nets: row.net_count }));
      }
      return fc(features, attr, license);
    } catch (e) {
      return fc([], attr, license, e instanceof Error ? e.message : 'PeeringDB unavailable');
    }
  });
}

async function pdb(path: string): Promise<any[]> {
  const rows: any[] = [];
  for (let skip = 0; skip < 8000; skip += 1000) {
    const data = await getJson<any>(`https://www.peeringdb.com/api/${path}?limit=1000&skip=${skip}&depth=0`);
    const batch = Array.isArray(data?.data) ? data.data : [];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

const launchCache = memo<FC>(2 * 60 * 60_000);
export function loadLaunches() {
  return launchCache(async () => {
    const attr = 'Launches: The Space Devs, Launch Library 2';
    try {
      const data = await getJson<any>('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=15');
      const features = (data.results || []).flatMap((row: any) => {
        const lat = Number(row.pad?.latitude);
        const lng = Number(row.pad?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
        return [point(lng, lat, {
          name: row.name, when: row.net, status: row.status?.name, pad: row.pad?.name,
          mission: row.mission?.name, url: row.url,
        })];
      });
      return fc(features, attr, 'Launch Library 2 API, free with attribution');
    } catch (e) {
      return fc([], attr, 'Launch Library 2 API, free with attribution', e instanceof Error ? e.message : 'Launch Library unavailable');
    }
  });
}

const ooniCache = memo<any>(6 * 60 * 60_000);
export function loadOoni() {
  return ooniCache(async () => {
    const attr = 'Censorship measurements: OONI';
    const license = 'OONI data, CC BY-SA 4.0';
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const until = new Date().toISOString().slice(0, 10);
      const agg = await getJson<any>(`https://api.ooni.org/api/v1/aggregation?axis_x=probe_cc&test_name=web_connectivity&since=${since}&until=${until}`);
      const rates = (agg.result || []).map((row: any) => ({
        iso: String(row.probe_cc || ''),
        rate: row.measurement_count ? Math.round((1000 * (row.anomaly_count || 0)) / row.measurement_count) / 10 : 0,
        measurements: row.measurement_count || 0,
      })).filter((r: { iso: string }) => r.iso);
      const incidentsRaw = await getJson<any>('https://api.ooni.org/api/v1/incidents/search?limit=30');
      const incidents = (incidentsRaw.incidents || []).map((row: any) => ({
        title: row.title, countries: row.CCs || [], start: row.start_time, url: row.slug ? `https://ooni.org/post/${row.slug}` : 'https://ooni.org',
      }));
      return { rates, incidents, attribution: attr, license };
    } catch (e) {
      return { rates: [], incidents: [], attribution: attr, license, error: e instanceof Error ? e.message : 'OONI unavailable' };
    }
  });
}

const overCache = new Map<string, { at: number; value: FC }>();
export async function loadOverpass(kind: OverpassKind, bbox: Bbox): Promise<FC> {
  const attr = 'Places: OpenStreetMap contributors, via Overpass';
  if (!bboxOk(bbox)) return fc([], attr, ODBL, 'Zoom in. This query only runs on a small view.');
  const key = `${kind}:${bbox.south.toFixed(2)}:${bbox.west.toFixed(2)}:${bbox.north.toFixed(2)}:${bbox.east.toFixed(2)}`;
  const hit = overCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.value;
  try {
    const body = overpassQuery(kind, bbox);
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      signal: AbortSignal.timeout(22_000),
      headers: { 'User-Agent': 'OSIRIS-public-dashboard/1.0 (https://github.com/Maximum-2016/osiris)', 'Content-Type': 'text/plain' },
      body,
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const osm = await res.json();
    const osmtogeojson = (await import('osmtogeojson')).default;
    const converted = osmtogeojson(osm);
    const features = [...(converted.features || [])];
    const seen = new Set(features.map((f: any) => f.id));
    for (const el of osm.elements || []) {
      if (seen.has(el.id) || !el.center) continue;
      features.push(point(el.center.lon, el.center.lat, { name: el.tags?.name, kind }));
    }
    const value = fc(features.slice(0, 200).map((f: any) => ({ ...f, properties: { name: f.properties?.name, kind } })), attr, ODBL);
    overCache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    return fc([], attr, ODBL, e instanceof Error ? e.message : 'Overpass unavailable');
  }
}

const gfwEvents = memo<FC>(60 * 60_000);
export function loadGfwGaps() {
  const token = process.env.GFW_API_TOKEN?.trim();
  const attr = 'AIS gaps: Global Fishing Watch';
  if (!token) return Promise.resolve(fc([], attr, 'GFW API terms', 'not configured'));
  return gfwEvents(async () => {
    try {
      const end = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      const url = `https://gateway.api.globalfishingwatch.org/v3/events?datasets[0]=public-global-gaps-events:latest&limit=200&start-date=${start}&end-date=${end}`;
      const data = await getJson<any>(url, 20_000, { Authorization: `Bearer ${token}` });
      const rows = data.entries || data.data || data.events || [];
      const features = rows.flatMap((row: any) => {
        const lat = Number(row.position?.lat ?? row.latitude ?? row.lat);
        const lng = Number(row.position?.lon ?? row.position?.lng ?? row.longitude ?? row.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
        return [point(lng, lat, { kind: 'gap', start: row.start || row.startDate, end: row.end || row.endDate })];
      });
      return fc(features, attr, 'GFW API terms');
    } catch (e) {
      return fc([], attr, 'GFW API terms', e instanceof Error ? e.message : 'GFW unavailable');
    }
  });
}

const hapiCache = memo<FC>(12 * 60 * 60_000);
export function loadHapi() {
  return hapiCache(async () => {
    const attr = 'Refugees, food security, conflict: HDX HAPI';
    const id = (process.env.HAPI_APP_IDENTIFIER || 'osiris-public-dashboard').trim();
    const headers = { app_identifier: id };
    try {
      const countries = await countryIndex();
      const by3 = new Map(countries.filter(c => c.iso3).map(c => [c.iso3, c]));
      const paths = [
        ['refugee', 'affected-people/refugees-persons-of-concern'],
        ['food', 'food-security-nutrition-poverty/food-security'],
        ['conflict', 'coordination-context/conflict-events'],
      ] as const;
      const features: any[] = [];
      for (const [kind, path] of paths) {
        const url = `https://hapi.humdata.org/api/v2/${path}?output_format=json&limit=1000&app_identifier=${encodeURIComponent(id)}`;
        const data = await getJson<any>(url, 25_000, headers);
        const rows = data.data || data.results || data;
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          const lat = num(row.latitude ?? row.lat);
          const lng = num(row.longitude ?? row.lon);
          const admin = by3.get(String(row.location_code || row.admin1_code || '').toUpperCase());
          const at = Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : admin ? [admin.lng, admin.lat] : null;
          if (!at) continue;
          features.push(point(at[0], at[1], {
            kind, name: row.location_name || admin?.name, value: row.population ?? row.ipc_phase ?? row.events,
          }));
        }
      }
      return fc(features, attr, 'HDX HAPI, Creative Commons BY-IGO');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'HAPI unavailable';
      const hint = message.includes('403') ? 'Set HAPI_APP_IDENTIFIER to an identifier HDX has accepted.' : message;
      return fc([], attr, 'HDX HAPI, Creative Commons BY-IGO', hint);
    }
  });
}

const hmsCache = memo<FC>(6 * 60 * 60_000);
export function loadHms() {
  return hmsCache(async () => {
    const attr = 'Smoke plumes: NOAA HMS';
    try {
      const url = await latestKml();
      if (!url) return fc([], attr, PD, 'No daily HMS KML is published right now');
      const xml = await getText(url);
      const dom = new DOMParser().parseFromString(xml, 'text/xml');
      const geo = kml(dom as unknown as Document);
      return fc(geo.features || [], attr, PD);
    } catch (e) {
      return fc([], attr, PD, e instanceof Error ? e.message : 'HMS unavailable');
    }
  });
}

async function latestKml(): Promise<string | null> {
  /* Files live at KML/<year>/<month>/hms_smokeYYYYMMDD.kml. Try the last week
     before listing the directory, which is a year of month folders. */
  const now = new Date();
  for (let back = 0; back < 8; back++) {
    const day = new Date(now.getTime() - back * 86_400_000);
    const y = day.getUTCFullYear();
    const m = String(day.getUTCMonth() + 1).padStart(2, '0');
    const stamp = day.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/${y}/${m}/hms_smoke${stamp}.kml`;
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': 'OSIRIS-public-dashboard/1.0' } });
    if (res.ok) return url;
  }
  return null;
}

const shakeCache = new Map<string, { at: number; value: FC }>();
export async function loadShake(ids: string[]): Promise<FC> {
  const attr = 'ShakeMap contours: USGS';
  const want = [...new Set(ids.map(s => s.trim()).filter(Boolean))].slice(0, 4);
  if (!want.length) return fc([], attr, PD);
  const key = want.join(',');
  const hit = shakeCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.value;
  const features: any[] = [];
  try {
    for (const id of want) {
      const detail = await getJson<any>(`https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${encodeURIComponent(id)}&format=geojson`);
      const contents = detail?.properties?.products?.shakemap?.[0]?.contents || {};
      const file = Object.values(contents).find((c: any) => /cont_mmi\.json$/i.test(c?.url || '')) as { url?: string } | undefined;
      if (!file?.url) continue;
      const contours = await getJson<any>(file.url);
      for (const feature of contours.features || []) features.push(feature);
    }
    const value = fc(features, attr, PD, features.length ? undefined : 'No ShakeMap contours for these events');
    shakeCache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    return fc([], attr, PD, e instanceof Error ? e.message : 'ShakeMap unavailable');
  }
}

const adviceCache = memo<any>(12 * 60 * 60_000);
export function loadAdvisories() {
  return adviceCache(async () => {
    const attr = 'Travel advice: US Department of State and UK FCDO';
    try {
      const us = await getJson<any[]>('https://cadataapi.state.gov/api/TravelAdvisories');
      const levels: Record<string, { us?: number; uk?: string }> = {};
      for (const row of us || []) {
        const iso = String(row.Category?.[0] || '').toUpperCase();
        const level = Number(/Level\s+(\d)/i.exec(row.Title || '')?.[1]);
        if (iso && Number.isFinite(level)) levels[iso] = { ...(levels[iso] || {}), us: level };
      }
      let ukNote = '';
      try {
        const search = await getJson<any>('https://www.gov.uk/api/search.json?count=400&filter_format=travel_advice&fields=title,description,link');
        const results = search.results || [];
        if (!results.length) ukNote = 'UK FCDO index returned no advice rows.';
        for (const row of results) {
          const text = `${row.title || ''} ${row.description || ''}`;
          const against = /advises against all(?: but essential)? travel/i.test(text);
          const iso = isoFromTitle(row.title || '', await countryIndex());
          if (iso && against) levels[iso] = { ...(levels[iso] || {}), uk: 'against' };
        }
      } catch {
        ukNote = 'UK FCDO search did not answer. US levels are shown.';
      }
      return { levels, attribution: attr, license: 'US government public domain; UK content Open Government Licence', error: ukNote || undefined };
    } catch (e) {
      return { levels: {}, attribution: attr, license: 'US government public domain; UK content Open Government Licence', error: e instanceof Error ? e.message : 'Advisories unavailable' };
    }
  });
}

function isoFromTitle(title: string, countries: { iso: string; name: string }[]): string | null {
  const lower = title.toLowerCase();
  const hit = countries.find(c => c.name && lower.includes(c.name.toLowerCase()));
  return hit?.iso || null;
}

const whoCache = memo<FC>(6 * 60 * 60_000);
export function loadWho() {
  return whoCache(async () => {
    const attr = 'Disease Outbreak News: WHO';
    try {
      const data = await getJson<any>('https://www.who.int/api/news/diseaseoutbreaknews?$orderby=PublicationDateAndTime%20desc&$top=40');
      const countries = await countryIndex();
      const features = (data.value || []).flatMap((row: any) => {
        const title = String(row.Title || '');
        const hit = countries.find(c => c.name && title.toLowerCase().includes(c.name.toLowerCase()));
        if (!hit) return [];
        return [point(hit.lng, hit.lat, {
          name: title, date: row.PublicationDate, url: row.ItemDefaultUrl || `https://www.who.int/emergencies/disease-outbreak-news/item/${row.UrlName || ''}`,
        })];
      });
      return fc(features, attr, 'WHO terms; attribute the World Health Organization');
    } catch (e) {
      return fc([], attr, 'WHO terms; attribute the World Health Organization', e instanceof Error ? e.message : 'WHO unavailable');
    }
  });
}

const fewsCache = memo<FC>(24 * 60 * 60_000);
export function loadFews() {
  return fewsCache(async () => {
    const attr = 'IPC phases: FEWS NET';
    try {
      const data = await getJson<any>('https://fdw.fews.net/api/ipcphase/?format=json&limit=400', 25_000);
      const rows = data.results || data;
      const countries = await countryIndex();
      const byIso = new Map(countries.map(c => [c.iso, c]));
      const features = (Array.isArray(rows) ? rows : []).flatMap((row: any) => {
        const iso = String(row.country_code || row.country || '').toUpperCase();
        const hit = byIso.get(iso.length === 2 ? iso : '') || countries.find(c => c.iso3 === iso);
        const phase = Number(row.ipc_phase ?? row.phase ?? row.value);
        if (!hit || !Number.isFinite(phase)) return [];
        return [point(hit.lng, hit.lat, { name: hit.name, phase, iso: hit.iso })];
      });
      return fc(features, attr, 'FEWS NET terms; attribute FEWS NET');
    } catch (e) {
      return fc([], attr, 'FEWS NET terms; attribute FEWS NET', e instanceof Error ? e.message : 'FEWS NET unavailable');
    }
  });
}

const tfrCache = memo<FC>(10 * 60_000);
export function loadTfr() {
  return tfrCache(async () => {
    const attr = 'Temporary flight restrictions: US FAA';
    try {
      const list = await getJson<any[]>('https://tfr.faa.gov/tfrapi/exportTfrList');
      const features: any[] = [];
      for (const row of (list || []).slice(0, 20)) {
        const id = String(row.notam_id || '');
        const shape = await tfrShape(id);
        if (shape) features.push(...shape.map(f => ({ ...f, properties: { ...(f.properties || {}), name: id, type: row.type, description: row.description } })));
      }
      const error = features.length ? undefined : 'FAA listed TFRs but did not publish a shape this route could read.';
      return fc(features, attr, PD, error);
    } catch (e) {
      return fc([], attr, PD, e instanceof Error ? e.message : 'FAA TFR unavailable');
    }
  });
}

async function tfrShape(notam: string): Promise<any[] | null> {
  const slug = notam.replace('/', '_');
  const urls = [
    `https://tfr.faa.gov/tfrapi/exportTfrGeoJson?notamId=${encodeURIComponent(notam)}`,
    `https://tfr.faa.gov/tfr3/export/geojson/${slug}.geojson`,
    `https://tfr.faa.gov/tfr3/export/kml/${slug}.kml`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': 'OSIRIS-public-dashboard/1.0' } });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        const json = JSON.parse(text);
        if (json.type === 'FeatureCollection') return json.features;
        if (json.type === 'Feature') return [json];
      }
      if (text.includes('<kml') || text.includes('<coordinates')) {
        const dom = new DOMParser().parseFromString(text, 'text/xml');
        return kml(dom as unknown as Document).features || [];
      }
    } catch { /* try the next shape URL */ }
  }
  return null;
}

const portCache = memo<FC>(6 * 60 * 60_000);
export function loadPorts() {
  return portCache(async () => {
    const attr = 'Daily port activity: IMF PortWatch';
    const url = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/PortWatch_ports_database/FeatureServer/0/query?where=1%3D1&outFields=portname,country,ISO3,portid,vessel_count_total,lat,lon&returnGeometry=true&f=geojson&resultRecordCount=3000';
    try {
      const data = await getJson<any>(url, 25_000);
      const features = (data.features || []).map((f: any) => {
        const p = f.properties || {};
        const lng = Number(f.geometry?.coordinates?.[0] ?? p.lon);
        const lat = Number(f.geometry?.coordinates?.[1] ?? p.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return point(lng, lat, { name: p.portname, country: p.country, calls: p.vessel_count_total, portid: p.portid });
      }).filter(Boolean);
      if (features.length) return fc(features, attr, 'IMF PortWatch public ArcGIS layer');
    } catch { /* fall through to the error below */ }
    return fc([], attr, 'IMF PortWatch public ArcGIS layer', 'PortWatch did not return a public feature layer.');
  });
}

const planeCache = memo<any>(24 * 60 * 60_000);
export function loadPlaneAlert() {
  return planeCache(async () => {
    const attr = 'Aircraft of interest: plane-alert-db';
    try {
      const csv = await getText('https://raw.githubusercontent.com/sdr-enthusiasts/plane-alert-db/main/plane-alert-db.csv');
      const lines = csv.split(/\r?\n/).slice(1);
      const tags: Record<string, { category: string; operator: string }> = {};
      for (const line of lines) {
        if (!line) continue;
        const cols = splitCsv(line);
        const hex = (cols[0] || '').replace(/^\$/, '').trim().toLowerCase();
        if (!/^[0-9a-f]{4,6}$/.test(hex)) continue;
        tags[hex] = { category: cols[9] || '', operator: cols[2] || '' };
      }
      return { tags, attribution: attr, license: ODBL };
    } catch (e) {
      return { tags: {}, attribution: attr, license: ODBL, error: e instanceof Error ? e.message : 'plane-alert-db unavailable' };
    }
  });
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const ransomCache = memo<any>(60 * 60_000);
export function loadRansom() {
  return ransomCache(async () => {
    const attr = 'Country totals: RansomLook public API';
    try {
      const posts = await getJson<any[]>('https://www.ransomlook.io/api/recent');
      const countries = await countryIndex();
      const counts = countryCounts(posts || [], countries);
      return { countries: counts, attribution: attr, license: 'RansomLook data, used via its public API' };
    } catch (e) {
      return { countries: [], attribution: attr, license: 'RansomLook data, used via its public API', error: e instanceof Error ? e.message : 'RansomLook unavailable' };
    }
  });
}

const droughtCache = memo<FC>(24 * 60 * 60_000);
export function loadDrought() {
  return droughtCache(async () => {
    const attr = 'Weekly drought: US Drought Monitor';
    try {
      const data = await getJson<any>('https://droughtmonitor.unl.edu/data/json/usdm_current.json');
      const features = Array.isArray(data?.features) ? data.features : [];
      return fc(features, attr, 'US Drought Monitor / NDMC, public data with attribution');
    } catch (e) {
      return fc([], attr, 'US Drought Monitor / NDMC, public data with attribution', e instanceof Error ? e.message : 'Drought Monitor unavailable');
    }
  });
}

const ufoCache = memo<FC>(24 * 60 * 60_000);
export function loadUfo() {
  return ufoCache(async () => {
    const attr = 'UFO sightings: Wikidata (CC0)';
    try {
      const body = new URLSearchParams({ query: UFO_QUERY });
      const res = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        signal: AbortSignal.timeout(40_000),
        headers: {
          'User-Agent': 'OSIRIS-public-dashboard/1.0 (https://github.com/Maximum-2016/osiris)',
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
      const data = await res.json();
      const features = (data.results?.bindings || []).flatMap((row: any) => {
        const at = parseWikidataPoint(row.coord?.value || '');
        if (!at) return [];
        return [point(at.lng, at.lat, {
          name: row.itemLabel?.value || 'UFO sighting',
          date: (row.date?.value || '').slice(0, 10),
          wikipedia: row.article?.value || '',
          wikidata: row.item?.value || '',
        })];
      });
      return fc(features, attr, CC0);
    } catch (e) {
      return fc([], attr, CC0, e instanceof Error ? e.message : 'Wikidata unavailable');
    }
  });
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
