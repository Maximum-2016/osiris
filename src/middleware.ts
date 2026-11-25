import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

/**
 * Optional page-view analytics. Off unless both UMAMI_URL (the collector
 * endpoint) and UMAMI_WEBSITE_ID are set. Nothing is sent by default: no
 * hardcoded site id, no visitor IP, and no request to a private Docker host.
 */
export function middleware(request: NextRequest, event: NextFetchEvent) {
  const endpoint = process.env.UMAMI_URL?.trim();
  const website = process.env.UMAMI_WEBSITE_ID?.trim();

  if (endpoint && website) {
    const pageView = fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: {
          hostname: request.nextUrl.hostname,
          language: 'en-US',
          referrer: request.headers.get('referer') || '',
          screen: '1920x1080',
          title: 'OSIRIS',
          url: request.nextUrl.pathname,
          website,
        },
        type: 'event',
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});

    event.waitUntil(pageView);
  }

  return NextResponse.next();
}

/* Assets are excluded, not just pages. MapLibre 6 loads its worker from
   /vendor/maplibre/<version>/ at runtime, and the basemap style from
   /dark-matter-style.json — neither is under _next/static, so both used to
   match here and pay an analytics round trip before the map could start.
   Analytics wants page views; asset fetches are not one. */
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|vendor|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mjs|js|css|json|pbf|mvt|woff|woff2|ico|txt)$).*)',
  ],
}
