/** Overpass queries for the current view. OSM data is ODbL. */

export type OverpassKind = 'military' | 'airports' | 'nuclear' | 'ports';

const FILTERS: Record<OverpassKind, string[]> = {
  military: ['node["military"]', 'way["military"]'],
  airports: ['node["aeroway"="aerodrome"]', 'way["aeroway"="aerodrome"]'],
  nuclear: ['node["plant:source"="nuclear"]', 'way["plant:source"="nuclear"]', 'node["generator:source"="nuclear"]'],
  ports: ['node["landuse"="port"]', 'way["landuse"="port"]', 'node["harbour"="yes"]', 'way["industrial"="port"]'],
};

export type Bbox = { south: number; west: number; north: number; east: number };

/** Reject a view so wide it would dump a continent onto the public Overpass server. */
export function bboxOk(b: Bbox): boolean {
  const lat = Math.abs(b.north - b.south);
  let lng = b.east - b.west;
  if (lng < 0) lng += 360;
  return lat > 0.02 && lng > 0.02 && lat <= 4 && lng <= 6
    && b.south >= -90 && b.north <= 90 && b.west >= -180 && b.east <= 180;
}

export function overpassQuery(kind: OverpassKind, b: Bbox): string {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  const body = FILTERS[kind].map(f => `  ${f}(${box});`).join('\n');
  return `[out:json][timeout:18];\n(\n${body}\n);\nout center tags 80;`;
}
