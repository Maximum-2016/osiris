/** Wikidata SPARQL for UFO sightings. Items and coordinates are CC0. */

export const UFO_QUERY = `
SELECT ?item ?itemLabel ?coord ?date ?article WHERE {
  ?item wdt:P31/wdt:P279* wd:Q40728071 .
  ?item wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P585 ?date . }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 400
`.trim();

export function parseWikidataPoint(wkt: string): { lng: number; lat: number } | null {
  const m = /Point\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)/i.exec(wkt || '');
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}
