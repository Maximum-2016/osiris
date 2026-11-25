'use client';

import { useEffect, useState } from 'react';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { GIBS, GIBS_ATTRIBUTION, gibsTileUrl, type GibsProduct } from '@/lib/public-layers/gibs';

type Props = {
  mapRef: { current: MlMap | null };
  activeLayers: Record<string, boolean>;
  mapStyle: string;
  data: any;
};

const EMPTY = { type: 'FeatureCollection', features: [] as any[] };

async function load(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) return { ...EMPTY, error: `HTTP ${res.status}` };
  return res.json();
}

function paintFor(id: string): any {
  if (id === 'nhc-fill') return { 'fill-color': '#E6A817', 'fill-opacity': 0.25 };
  if (id === 'hms-fill') return { 'fill-color': '#C4C4C4', 'fill-opacity': 0.35 };
  if (id === 'drought-fill') return { 'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'DM'], ['get', 'dm'], 0], 0, '#ffffb2', 1, '#fecc5c', 2, '#fd8d3c', 3, '#f03b20', 4, '#bd0026'], 'fill-opacity': 0.55 };
  if (id === 'shake-fill') return { 'fill-color': '#E65100', 'fill-opacity': 0.28 };
  if (id === 'ooni-fill') return { 'fill-color': ['interpolate', ['linear'], ['get', 'rate'], 0, '#1b3a2f', 5, '#c6a15b', 20, '#c4473a'], 'fill-opacity': 0.55 };
  if (id === 'advice-fill') return { 'fill-color': ['interpolate', ['linear'], ['get', 'level'], 1, '#2e7d32', 2, '#f9a825', 3, '#ef6c00', 4, '#c62828'], 'fill-opacity': 0.5 };
  if (id === 'ookla-fill') return { 'fill-color': ['interpolate', ['linear'], ['get', 'mbps'], 5, '#8B1E3F', 25, '#E6A817', 100, '#7DCEA0'], 'fill-opacity': 0.45 };
  return { 'fill-color': '#D4AF37', 'fill-opacity': 0.2 };
}

function ensureGeo(map: MlMap, id: string, data: any, attribution: string, draw: 'fill' | 'line' | 'circle', paint: any, filter?: any) {
  const sourceId = `${id}-src`;
  const layerId = id;
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'geojson', data: data || EMPTY, attribution });
  } else {
    (map.getSource(sourceId) as GeoJSONSource).setData(data || EMPTY);
  }
  if (!map.getLayer(layerId)) {
    map.addLayer({ id: layerId, type: draw, source: sourceId, ...(filter ? { filter } : {}), paint } as any);
  }
}

function remove(map: MlMap, ids: string[]) {
  for (const id of ids) {
    if (map.getLayer(id)) map.removeLayer(id);
    const sourceId = id.endsWith('-src') ? id : `${id}-src`;
    if (!map.getLayer(id) && map.getSource(sourceId) && !map.getStyle().layers.some(l => (l as any).source === sourceId)) {
      map.removeSource(sourceId);
    }
  }
}

export default function PublicLayers({ mapRef, activeLayers, mapStyle, data }: Props) {
  const [date, setDate] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const gibsOn = activeLayers.gibs_true || activeLayers.gibs_night || activeLayers.gibs_smoke || activeLayers.gibs_snow;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const products: GibsProduct[] = [];
    if (activeLayers.gibs_true) products.push('true');
    if (activeLayers.gibs_night) products.push('night');
    if (activeLayers.gibs_smoke) products.push('smoke');
    if (activeLayers.gibs_snow) products.push('snow');
    for (const product of ['true', 'night', 'smoke', 'snow'] as GibsProduct[]) {
      const id = `gibs-${product}`;
      if (!products.includes(product)) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
        continue;
      }
      const tiles = [gibsTileUrl(product, date)];
      if (map.getSource(id)) {
        map.removeLayer(id);
        map.removeSource(id);
      }
      map.addSource(id, { type: 'raster', tiles, tileSize: 256, maxzoom: Number(GIBS[product].matrix.replace(/\D/g, '')) || 8, attribution: GIBS_ATTRIBUTION });
      const before = map.getLayer('day-night-fill') ? 'day-night-fill' : undefined;
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': product === 'true' ? 0.85 : 0.7 } }, before);
    }
  }, [mapRef, activeLayers.gibs_true, activeLayers.gibs_night, activeLayers.gibs_smoke, activeLayers.gibs_snow, date, mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ac = new AbortController();
    let dead = false;
    const notes: string[] = [];

    const geo = async (id: string, on: boolean, url: string, draw: 'fill' | 'line' | 'circle', paint: any, filter?: any) => {
      if (!on) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(`${id}-src`) && !map.getStyle().layers.some(l => (l as any).source === `${id}-src`)) map.removeSource(`${id}-src`);
        return;
      }
      const body = await load(url, ac.signal);
      if (dead) return;
      if (body.error) notes.push(`${id}: ${body.error}`);
      ensureGeo(map, id, body.features ? body : EMPTY, body.attribution || '', draw, paint, filter);
    };

    (async () => {
      await geo('nhc-fill', !!activeLayers.nhc, '/api/open/nhc', 'fill', paintFor('nhc-fill'), ['==', ['geometry-type'], 'Polygon']);
      await geo('nhc-line', !!activeLayers.nhc, '/api/open/nhc', 'line', { 'line-color': '#E6A817', 'line-width': 1.5 }, ['==', ['geometry-type'], 'LineString']);
      await geo('nhc-dot', !!activeLayers.nhc, '/api/open/nhc', 'circle', { 'circle-radius': 5, 'circle-color': '#E6A817', 'circle-stroke-width': 1, 'circle-stroke-color': '#111' }, ['==', ['geometry-type'], 'Point']);
      await geo('peer', !!activeLayers.peeringdb, '/api/open/peeringdb', 'circle', { 'circle-radius': ['match', ['get', 'kind'], 'ix', 5, 3], 'circle-color': ['match', ['get', 'kind'], 'ix', '#D4AF37', '#3DDCFF'], 'circle-stroke-width': 0.5, 'circle-stroke-color': '#111' });
      await geo('launch', !!activeLayers.launches, '/api/open/launches', 'circle', { 'circle-radius': 6, 'circle-color': '#F5F5F5', 'circle-stroke-width': 1, 'circle-stroke-color': '#D4AF37' });
      await geo('hms-fill', !!activeLayers.hms, '/api/open/hms', 'fill', paintFor('hms-fill'));
      await geo('hms-line', !!activeLayers.hms, '/api/open/hms', 'line', { 'line-color': '#ddd', 'line-width': 1 });
      await geo('who', !!activeLayers.who_don, '/api/open/who', 'circle', { 'circle-radius': 5, 'circle-color': '#80CBC4' });
      await geo('fews', !!activeLayers.fews, '/api/open/fews', 'circle', { 'circle-radius': 6, 'circle-color': ['interpolate', ['linear'], ['get', 'phase'], 1, '#c6e6b3', 3, '#f4d35e', 5, '#9b2226'] });
      await geo('tfr', !!activeLayers.tfr, '/api/open/tfr', 'fill', { 'fill-color': '#FF7043', 'fill-opacity': 0.3 });
      await geo('port', !!activeLayers.portwatch, '/api/open/portwatch', 'circle', { 'circle-radius': 4, 'circle-color': '#4FC3F7' });
      await geo('ufo', !!activeLayers.ufo, '/api/open/ufo', 'circle', { 'circle-radius': 4, 'circle-color': '#CE93D8', 'circle-stroke-width': 1, 'circle-stroke-color': '#311' });
      await geo('gap', !!activeLayers.gfw_gaps, '/api/open/gfw', 'circle', { 'circle-radius': 4, 'circle-color': '#FF8A65' });
      await geo('drought-fill', !!activeLayers.drought, '/api/open/drought', 'fill', paintFor('drought-fill'));
      await geo('hapi', !!activeLayers.hapi, '/api/open/hapi', 'circle', { 'circle-radius': 4, 'circle-color': ['match', ['get', 'kind'], 'refugee', '#90CAF9', 'food', '#FFCC80', '#EF9A9A'] });

      if (activeLayers.ooni || activeLayers.advisories) {
        const countries = await load('/data/countries-110m.geojson', ac.signal);
        if (!dead && activeLayers.ooni) {
          const ooni = await load('/api/open/ooni', ac.signal);
          const rate = new Map((ooni.rates || []).map((r: any) => [r.iso, r.rate]));
          const features = (countries.features || []).map((f: any) => ({ ...f, properties: { ...f.properties, rate: rate.get(f.properties?.iso) ?? 0 } }));
          ensureGeo(map, 'ooni-fill', { type: 'FeatureCollection', features }, ooni.attribution || 'OONI', 'fill', paintFor('ooni-fill'));
          if (ooni.error) notes.push(`ooni: ${ooni.error}`);
          const incidents = (ooni.incidents || []).flatMap((row: any) => (row.countries || []).map((iso: string) => {
            const country = (countries.features || []).find((f: any) => f.properties?.iso === iso);
            if (!country) return null;
            const [lng, lat] = centroid(country.geometry);
            return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name: row.title, url: row.url } };
          }).filter(Boolean));
          ensureGeo(map, 'ooni-dot', { type: 'FeatureCollection', features: incidents }, ooni.attribution || 'OONI', 'circle', { 'circle-radius': 5, 'circle-color': '#FFEB3B', 'circle-stroke-width': 1, 'circle-stroke-color': '#111' });
        } else if (!activeLayers.ooni) {
          remove(map, ['ooni-fill', 'ooni-dot']);
        }
        if (!dead && activeLayers.advisories) {
          const advice = await load('/api/open/advisories', ac.signal);
          const levels = advice.levels || {};
          const features = (countries.features || []).map((f: any) => ({ ...f, properties: { ...f.properties, level: levels[f.properties?.iso]?.us || 0 } })).filter((f: any) => f.properties.level);
          ensureGeo(map, 'advice-fill', { type: 'FeatureCollection', features }, advice.attribution || 'Travel advice', 'fill', paintFor('advice-fill'));
          if (advice.error) notes.push(`advice: ${advice.error}`);
        } else if (!activeLayers.advisories) remove(map, ['advice-fill']);
      } else {
        remove(map, ['ooni-fill', 'ooni-dot', 'advice-fill']);
      }

      if (activeLayers.ookla) {
        const grid = await load('/data/ookla-fixed-2deg.json', ac.signal);
        const features = (grid.cells || []).map((c: any) => ({
          type: 'Feature',
          properties: { mbps: c.mbps },
          geometry: { type: 'Polygon', coordinates: [[[c.lon, c.lat], [c.lon + 2, c.lat], [c.lon + 2, c.lat + 2], [c.lon, c.lat + 2], [c.lon, c.lat]]] },
        }));
        if (!dead) ensureGeo(map, 'ookla-fill', { type: 'FeatureCollection', features }, grid.source || 'Ookla', 'fill', paintFor('ookla-fill'));
      } else remove(map, ['ookla-fill']);

      if (activeLayers.gfw_fishing) {
        if (!map.getSource('gfw-fish')) {
          map.addSource('gfw-fish', {
            type: 'raster',
            tiles: ['/api/open/gfw/tile?z={z}&x={x}&y={y}'],
            tileSize: 256,
            maxzoom: 8,
            attribution: 'Fishing effort: Global Fishing Watch',
          });
          map.addLayer({ id: 'gfw-fish', type: 'raster', source: 'gfw-fish', paint: { 'raster-opacity': 0.75 } });
        }
      } else if (map.getLayer('gfw-fish')) {
        map.removeLayer('gfw-fish');
        if (map.getSource('gfw-fish')) map.removeSource('gfw-fish');
      }

      if (!dead) setNote(notes.filter(Boolean).slice(0, 3).join(' · '));
    })().catch(() => { if (!dead) setNote('A public layer did not answer.'); });

    return () => { dead = true; ac.abort(); };
  }, [
    mapRef, mapStyle, activeLayers.nhc, activeLayers.peeringdb, activeLayers.launches, activeLayers.hms,
    activeLayers.who_don, activeLayers.fews, activeLayers.tfr, activeLayers.portwatch, activeLayers.ufo,
    activeLayers.gfw_gaps, activeLayers.gfw_fishing, activeLayers.drought, activeLayers.hapi,
    activeLayers.ooni, activeLayers.advisories, activeLayers.ookla,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const on = activeLayers.overpass_military || activeLayers.overpass_airports || activeLayers.overpass_nuclear || activeLayers.overpass_ports;
    if (!on) {
      remove(map, ['osm-dot']);
      return;
    }
    const ac = new AbortController();
    const run = async () => {
      const b = map.getBounds();
      const q = (kind: string) => `/api/open/overpass?kind=${kind}&south=${b.getSouth()}&west=${b.getWest()}&north=${b.getNorth()}&east=${b.getEast()}`;
      const kinds = [
        activeLayers.overpass_military && 'military',
        activeLayers.overpass_airports && 'airports',
        activeLayers.overpass_nuclear && 'nuclear',
        activeLayers.overpass_ports && 'ports',
      ].filter(Boolean) as string[];
      const parts = await Promise.all(kinds.map(k => load(q(k), ac.signal)));
      const features = parts.flatMap(p => p.features || []);
      const error = parts.map(p => p.error).filter(Boolean)[0];
      ensureGeo(map, 'osm-dot', { type: 'FeatureCollection', features }, '© OpenStreetMap contributors, ODbL', 'circle', {
        'circle-radius': 4,
        'circle-color': ['match', ['get', 'kind'], 'military', '#EF9A9A', 'airports', '#90CAF9', 'nuclear', '#FFD54F', '#A5D6A7'],
      });
      if (error) setNote(String(error));
    };
    run().catch(() => {});
    map.on('moveend', run);
    return () => { ac.abort(); map.off('moveend', run); };
  }, [mapRef, mapStyle, activeLayers.overpass_military, activeLayers.overpass_airports, activeLayers.overpass_nuclear, activeLayers.overpass_ports]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!activeLayers.shakemap) {
      remove(map, ['shake-fill']);
      return;
    }
    const ids = (data?.earthquakes || []).filter((q: any) => Number(q.magnitude) >= 5).slice(0, 4).map((q: any) => q.id).filter(Boolean);
    const ac = new AbortController();
    load(`/api/open/shakemap?ids=${encodeURIComponent(ids.join(','))}`, ac.signal).then(body => {
      ensureGeo(map, 'shake-fill', body.features ? body : EMPTY, body.attribution || 'USGS', 'fill', paintFor('shake-fill'));
      if (body.error) setNote(`shakemap: ${body.error}`);
    }).catch(() => {});
    return () => ac.abort();
  }, [mapRef, mapStyle, activeLayers.shakemap, data?.earthquakes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!activeLayers.plane_alert) {
      remove(map, ['alert-craft']);
      return;
    }
    const ac = new AbortController();
    load('/api/open/plane-alert', ac.signal).then(body => {
      const tags = body.tags || {};
      const flights = [...(data?.commercial_flights || []), ...(data?.private_flights || []), ...(data?.private_jets || []), ...(data?.military_flights || [])];
      const features = flights.flatMap((f: any) => {
        const tag = tags[String(f.icao24 || '').toLowerCase()];
        if (!tag || !Number.isFinite(f.lng) || !Number.isFinite(f.lat)) return [];
        return [{ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] }, properties: { name: f.callsign, category: tag.category, operator: tag.operator } }];
      });
      ensureGeo(map, 'alert-craft', { type: 'FeatureCollection', features }, body.attribution || 'plane-alert-db', 'circle', { 'circle-radius': 7, 'circle-color': '#FFD54F', 'circle-stroke-width': 1, 'circle-stroke-color': '#111' });
    }).catch(() => {});
    return () => ac.abort();
  }, [mapRef, mapStyle, activeLayers.plane_alert, data?.commercial_flights, data?.private_flights, data?.private_jets, data?.military_flights]);

  const any = gibsOn || note;
  if (!any) return null;
  return (
    <div className="absolute left-3 bottom-16 z-[220] pointer-events-auto max-w-sm space-y-1">
      {gibsOn && (
        <label className="flex items-center gap-2 glass-panel px-2 py-1 text-[9px] font-mono text-[var(--text-muted)]">
          <span>GIBS {date}</span>
          <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} className="bg-transparent text-[var(--text-primary)]" />
        </label>
      )}
      {note && <div className="glass-panel px-2 py-1 text-[9px] font-mono text-[var(--text-muted)]">{note}</div>}
    </div>
  );
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
  return [coords.reduce((s, c) => s + c[0], 0) / coords.length, coords.reduce((s, c) => s + c[1], 0) / coords.length];
}
