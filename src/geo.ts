export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance in meters between two WGS84 points. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0-360, clockwise from north) from a to b. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by traveling `distanceM` from `start` on `bearing` degrees. */
export function destinationPoint(
  start: LatLon,
  distanceM: number,
  bearing: number,
): LatLon {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearing);
  const lat1 = toRad(start.lat);
  const lon1 = toRad(start.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) +
      Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Linear interpolation along the segment a→b at fraction f (0..1). */
export function interpolate(a: LatLon, b: LatLon, f: number): LatLon {
  const dist = haversineMeters(a, b);
  if (dist === 0 || f <= 0) return a;
  if (f >= 1) return b;
  return destinationPoint(a, dist * f, bearingDeg(a, b));
}

export function pointInCircle(
  p: LatLon,
  center: LatLon,
  radiusM: number,
): boolean {
  return haversineMeters(p, center) <= radiusM;
}

/** Ray-casting point-in-polygon on lat/lon vertices (sufficient at city scale). */
export function pointInPolygon(p: LatLon, vertices: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    const intersects =
      a.lat > p.lat !== b.lat > p.lat &&
      p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon;
    if (intersects) inside = !inside;
  }
  return inside;
}
