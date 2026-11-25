import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** Fishing-effort raster. The token stays on the server. */
export async function GET(req: Request) {
  const token = process.env.GFW_API_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const url = new URL(req.url);
  const z = Number(url.searchParams.get('z'));
  const x = Number(url.searchParams.get('x'));
  const y = Number(url.searchParams.get('y'));
  if (![z, x, y].every(n => Number.isInteger(n) && n >= 0) || z > 10) {
    return NextResponse.json({ error: 'bad tile' }, { status: 400 });
  }
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const upstream = `https://gateway.api.globalfishingwatch.org/v3/4wings/tile/heatmap/${z}/${x}/${y}?format=PNG&interval=${start},${end}&datasets[0]=public-global-fishing-effort:latest`;
  try {
    const res = await fetch(upstream, {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OSIRIS-public-dashboard/1.0' },
    });
    if (!res.ok) return new NextResponse(null, { status: res.status });
    const bytes = await res.arrayBuffer();
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/png',
        'Cache-Control': 'public, s-maxage=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
