/**
 * Country totals from RansomLook's public API.
 * The payload the browser receives is counts only. Victim names are never copied out.
 */

export type CountryName = { iso: string; name: string };

const ALIAS: Record<string, string> = {
  'united states': 'US', usa: 'US', america: 'US',
  'united kingdom': 'GB', uk: 'GB', britain: 'GB', england: 'GB',
  russia: 'RU', 'russian federation': 'RU',
  'south korea': 'KR', 'north korea': 'KP',
  palestine: 'PS',
  iran: 'IR', syria: 'SY', vietnam: 'VN',
  taiwan: 'TW',
};

function namesOf(countries: CountryName[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of countries) {
    map.set(c.name.toLowerCase(), c.iso);
    const alias = ALIAS[c.name.toLowerCase()];
    if (alias) map.set(c.name.toLowerCase(), alias);
  }
  for (const [alias, iso] of Object.entries(ALIAS)) map.set(alias, iso);
  return map;
}

/**
 * Count posts whose description names a country. `post_title` is the victim
 * and is not read, so a company named after a place cannot inflate a total.
 */
export function countryCounts(
  posts: { description?: unknown }[],
  countries: CountryName[],
): { iso: string; count: number }[] {
  const names = [...namesOf(countries).entries()].sort((a, b) => b[0].length - a[0].length);
  const counts = new Map<string, number>();
  for (const post of posts) {
    const text = typeof post.description === 'string' ? post.description.toLowerCase() : '';
    if (!text) continue;
    const hit = new Set<string>();
    for (const [name, iso] of names) {
      if (name.length < 4) continue;
      const re = new RegExp(`(?:^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z]|$)`);
      if (re.test(text)) hit.add(iso);
    }
    for (const iso of hit) counts.set(iso, (counts.get(iso) || 0) + 1);
  }
  return [...counts.entries()].map(([iso, count]) => ({ iso, count })).sort((a, b) => b.count - a.count);
}
