import { describe, expect, it } from 'vitest';
import { gibsTileUrl } from './gibs';
import { bboxOk, overpassQuery } from './overpass';
import { countryCounts } from './ransom';
import { parseWikidataPoint, UFO_QUERY } from './ufo';
import { kindOf } from './feeds';

describe('public layers', () => {
  it('builds a NASA GIBS tile template for a real date', () => {
    expect(gibsTileUrl('true', '2026-11-20')).toContain('MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-11-20/');
    expect(gibsTileUrl('snow', 'nope')).toMatch(/\/\d{4}-\d{2}-\d{2}\//);
  });

  it('refuses an Overpass query that covers a continent', () => {
    expect(bboxOk({ south: 10, west: 10, north: 11, east: 11 })).toBe(true);
    expect(bboxOk({ south: -40, west: -20, north: 40, east: 50 })).toBe(false);
    expect(overpassQuery('airports', { south: 1, west: 2, north: 3, east: 4 })).toContain('aeroway');
  });

  it('counts ransom posts by country and never reads the victim title', () => {
    const posts = [
      { post_title: 'Jordan Aerospace Ltd', description: 'Pumps and elevators · Jordan' },
      { post_title: 'France National Bank', description: 'A company in the finance sector' },
    ];
    const counts = countryCounts(posts as any, [{ iso: 'JO', name: 'Jordan' }, { iso: 'FR', name: 'France' }]);
    expect(counts).toEqual([{ iso: 'JO', count: 1 }]);
    expect(JSON.stringify(counts)).not.toContain('Aerospace');
    expect(JSON.stringify(counts)).not.toContain('France');
  });

  it('asks Wikidata for UFO sightings that have coordinates', () => {
    expect(UFO_QUERY).toContain('wd:Q40728071');
    expect(UFO_QUERY).toContain('wdt:P625');
    expect(UFO_QUERY.toLowerCase()).not.toContain('nuforc');
    expect(parseWikidataPoint('Point(-1.5 51.2)')).toEqual({ lng: -1.5, lat: 51.2 });
    expect(parseWikidataPoint('not a point')).toBeNull();
  });

  it('classifies hurricane GIS products', () => {
    expect(kindOf('forecastConeGIS')).toBe('cone');
    expect(kindOf('trackGIS')).toBe('track');
    expect(kindOf('windWatchWarningGIS')).toBe('warning');
  });
});
