import { NextResponse } from 'next/server';
import {
  loadAdvisories, loadDrought, loadFews, loadGfwGaps, loadHapi, loadHms, loadLaunches,
  loadNhc, loadOoni, loadOverpass, loadPeeringDb, loadPlaneAlert, loadPorts, loadRansom,
  loadShake, loadTfr, loadUfo, loadWho,
} from '@/lib/public-layers/feeds';
import type { OverpassKind } from '@/lib/public-layers/overpass';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HOUR = 'public, s-maxage=3600, stale-while-revalidate=86400';
const DAY = 'public, s-maxage=86400, stale-while-revalidate=172800';

export async function GET(req: Request, { params }: { params: Promise<{ layer: string }> }) {
  const { layer } = await params;
  const url = new URL(req.url);
  try {
    if (layer === 'gfw' && url.searchParams.get('probe') === '1') {
      return NextResponse.json({ configured: Boolean(process.env.GFW_API_TOKEN?.trim()) });
    }
    const body = await payload(layer, url);
    const cache = body && 'error' in body && body.error ? 'no-store' : cacheFor(layer);
    return NextResponse.json(body, { headers: { 'Cache-Control': cache } });
  } catch (e) {
    return NextResponse.json({ type: 'FeatureCollection', features: [], error: e instanceof Error ? e.message : 'unavailable' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}

function cacheFor(layer: string): string {
  if (layer === 'launches') return 'public, s-maxage=7200, stale-while-revalidate=7200';
  if (layer === 'peeringdb' || layer === 'ufo' || layer === 'drought' || layer === 'plane-alert') return DAY;
  return HOUR;
}

async function payload(layer: string, url: URL) {
  switch (layer) {
    case 'nhc': return loadNhc();
    case 'peeringdb': return loadPeeringDb();
    case 'launches': return loadLaunches();
    case 'ooni': return loadOoni();
    case 'hapi': return loadHapi();
    case 'hms': return loadHms();
    case 'advisories': return loadAdvisories();
    case 'who': return loadWho();
    case 'fews': return loadFews();
    case 'tfr': return loadTfr();
    case 'portwatch': return loadPorts();
    case 'plane-alert': return loadPlaneAlert();
    case 'ransomlook': return loadRansom();
    case 'drought': return loadDrought();
    case 'ufo': return loadUfo();
    case 'gfw': return loadGfwGaps();
    case 'shakemap': return loadShake((url.searchParams.get('ids') || '').split(',').filter(Boolean));
    case 'overpass': {
      const kind = url.searchParams.get('kind') as OverpassKind;
      const bbox = {
        south: Number(url.searchParams.get('south')),
        west: Number(url.searchParams.get('west')),
        north: Number(url.searchParams.get('north')),
        east: Number(url.searchParams.get('east')),
      };
      if (!['military', 'airports', 'nuclear', 'ports'].includes(kind)) {
        return { type: 'FeatureCollection', features: [], error: 'Unknown place kind', attribution: '', license: '' };
      }
      return loadOverpass(kind, bbox);
    }
    default:
      return { error: 'Unknown layer' };
  }
}
