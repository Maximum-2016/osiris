import { NextResponse } from 'next/server';
import { isRateLimited, getClientIp } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

/**
 * Thin proxy to the OSIRIS Intelligence Layer (osiris-intel).
 *
 * Set INTEL_URL to the service (Docker compose uses http://osiris-intel:4000
 * when this process is not on Vercel). With nothing set on Vercel the route
 * answers 503 — there is no long-running intel container on the platform.
 */

function intelUrl(): string | null {
  const set = (process.env.INTEL_URL || '').trim().replace(/\/+$/, '');
  if (set) return set;
  if (process.env.VERCEL) return null;
  return process.env.NODE_ENV === 'production' ? 'http://osiris-intel:4000' : 'http://localhost:4000';
}

const ALLOWED_TYPES = new Set(['aircraft', 'vessel', 'company', 'person', 'ip', 'country']);

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') || '').toLowerCase().trim();
  const id = (searchParams.get('id') || '').trim();

  if (!type || !ALLOWED_TYPES.has(type)) {
    return NextResponse.json(
      { error: `Invalid type. Allowed: ${[...ALLOWED_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  if (!id || id.length < 2 || id.length > 200) {
    return NextResponse.json({ error: 'Invalid id (2-200 chars)' }, { status: 400 });
  }

  const INTEL_URL = intelUrl();
  if (!INTEL_URL) {
    return NextResponse.json(
      { error: 'Intelligence layer not configured', nodes: [], links: [] },
      { status: 503 },
    );
  }

  try {
    const params = new URLSearchParams({ type, id });
    // Forward extra aircraft properties to the intel brain
    for (const key of ['registration', 'model', 'icao24']) {
      const val = searchParams.get(key);
      if (val) params.set(key, val);
    }
    const res = await fetch(`${INTEL_URL}/resolve?${params}`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'X-Forwarded-For': clientIp },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: body.error || `Intel layer returned ${res.status}`, nodes: [], links: [] },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      // A partial graph (a provider did not answer) must not sit in a shared cache for an hour.
      headers: { 'Cache-Control': data.degraded ? 'no-store' : 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (e) {
    console.error('[OSIRIS] Intel proxy error:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'Intelligence layer unavailable', nodes: [], links: [] },
      { status: 502 },
    );
  }
}
