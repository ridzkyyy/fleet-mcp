import { describe, expect, test } from 'vitest';
import {
  bearingDeg,
  destinationPoint,
  haversineMeters,
  interpolate,
  pointInCircle,
  pointInPolygon,
} from '../src/geo.js';

const JAKARTA = { lat: -6.2, lon: 106.8167 };
const SURABAYA = { lat: -7.2575, lon: 112.7521 };

describe('haversineMeters', () => {
  test('returns 0 for identical points', () => {
    expect(haversineMeters(JAKARTA, JAKARTA)).toBe(0);
  });

  test('Jakarta to Surabaya is ~663 km', () => {
    const km = haversineMeters(JAKARTA, SURABAYA) / 1000;
    expect(km).toBeGreaterThan(650);
    expect(km).toBeLessThan(680);
  });

  test('is symmetric', () => {
    expect(haversineMeters(JAKARTA, SURABAYA)).toBeCloseTo(
      haversineMeters(SURABAYA, JAKARTA),
      6,
    );
  });
});

describe('bearingDeg', () => {
  test('due east from equator is 90 degrees', () => {
    const b = bearingDeg({ lat: 0, lon: 100 }, { lat: 0, lon: 101 });
    expect(b).toBeCloseTo(90, 0);
  });

  test('Surabaya is roughly east-southeast of Jakarta', () => {
    const b = bearingDeg(JAKARTA, SURABAYA);
    expect(b).toBeGreaterThan(90);
    expect(b).toBeLessThan(120);
  });
});

describe('destinationPoint', () => {
  test('round-trips with haversine and bearing', () => {
    const dest = destinationPoint(JAKARTA, 5000, 45);
    expect(haversineMeters(JAKARTA, dest)).toBeCloseTo(5000, -1);
    expect(bearingDeg(JAKARTA, dest)).toBeCloseTo(45, 0);
  });
});

describe('interpolate', () => {
  test('f=0 returns start, f=1 returns end', () => {
    expect(interpolate(JAKARTA, SURABAYA, 0)).toEqual(JAKARTA);
    expect(interpolate(JAKARTA, SURABAYA, 1)).toEqual(SURABAYA);
  });

  test('midpoint is equidistant from both ends', () => {
    const mid = interpolate(JAKARTA, SURABAYA, 0.5);
    const dA = haversineMeters(JAKARTA, mid);
    const dB = haversineMeters(mid, SURABAYA);
    expect(Math.abs(dA - dB)).toBeLessThan(1000);
  });
});

describe('pointInCircle', () => {
  test('center is inside, far point is outside', () => {
    expect(pointInCircle(JAKARTA, JAKARTA, 100)).toBe(true);
    expect(pointInCircle(SURABAYA, JAKARTA, 100_000)).toBe(false);
  });

  test('boundary is inclusive', () => {
    const edge = destinationPoint(JAKARTA, 500, 0);
    expect(pointInCircle(edge, JAKARTA, 501)).toBe(true);
  });
});

describe('pointInPolygon', () => {
  const square = [
    { lat: -6.1, lon: 106.8 },
    { lat: -6.1, lon: 106.9 },
    { lat: -6.2, lon: 106.9 },
    { lat: -6.2, lon: 106.8 },
  ];

  test('detects inside and outside', () => {
    expect(pointInPolygon({ lat: -6.15, lon: 106.85 }, square)).toBe(true);
    expect(pointInPolygon({ lat: -6.05, lon: 106.85 }, square)).toBe(false);
    expect(pointInPolygon({ lat: -6.15, lon: 107.0 }, square)).toBe(false);
  });
});
