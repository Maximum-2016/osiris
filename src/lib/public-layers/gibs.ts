/** NASA GIBS WMTS, EPSG:3857. Imagery is NASA public domain. */

export type GibsProduct = 'true' | 'night' | 'smoke' | 'snow';

export const GIBS: Record<GibsProduct, { layer: string; matrix: string; ext: 'jpg' | 'png'; label: string }> = {
  true: {
    layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    matrix: 'GoogleMapsCompatible_Level9',
    ext: 'jpg',
    label: 'MODIS Terra true color',
  },
  night: {
    layer: 'VIIRS_SNPP_DayNightBand',
    matrix: 'GoogleMapsCompatible_Level7',
    ext: 'png',
    label: 'VIIRS day/night band (city lights)',
  },
  /* GIBS publishes no layer whose name is Smoke. Aerosol optical depth is the
     daily product Worldview uses to see smoke and dust. HMS polygons are separate. */
  smoke: {
    layer: 'MODIS_Terra_Aerosol',
    matrix: 'GoogleMapsCompatible_Level6',
    ext: 'png',
    label: 'MODIS Terra aerosol (smoke and dust)',
  },
  snow: {
    layer: 'MODIS_Terra_NDSI_Snow_Cover',
    matrix: 'GoogleMapsCompatible_Level8',
    ext: 'png',
    label: 'MODIS Terra snow cover',
  },
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function gibsTileUrl(product: GibsProduct, date: string): string {
  const g = GIBS[product];
  const day = DAY.test(date) ? date : new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${g.layer}/default/${day}/${g.matrix}/{z}/{y}/{x}.${g.ext}`;
}

export const GIBS_ATTRIBUTION = 'Imagery: NASA GIBS, public domain';
