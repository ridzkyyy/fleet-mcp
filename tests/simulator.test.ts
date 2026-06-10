import { describe, expect, test } from 'vitest';
import { haversineMeters } from '../src/geo.js';
import { GEOFENCES, VEHICLES, WAREHOUSE } from '../src/demo-fleet.js';
import {
  geofenceEvents,
  getVehicle,
  history,
  insideGeofence,
  positionAt,
  tripStats,
} from '../src/simulator.js';

// Fixed instant for determinism: 2026-06-11 09:00 WIB.
const T0 = Date.parse('2026-06-11T02:00:00Z');
const DAY = 24 * 3_600_000;

describe('positionAt', () => {
  test('is deterministic: same time, same fix', () => {
    const v = VEHICLES[0];
    expect(positionAt(v, T0)).toEqual(positionAt(v, T0));
  });

  test('every active vehicle stays within greater Jakarta bounds', () => {
    for (const v of VEHICLES) {
      for (let i = 0; i < 24; i++) {
        const fix = positionAt(v, T0 + i * 3_600_000);
        expect(fix.lat).toBeGreaterThan(-6.5);
        expect(fix.lat).toBeLessThan(-5.9);
        expect(fix.lon).toBeGreaterThan(106.7);
        expect(fix.lon).toBeLessThan(107.3);
      }
    }
  });

  test('dwelling vehicle reports zero speed and ignition off', () => {
    const v = VEHICLES[0];
    const dwell = history(v, T0, T0 + DAY, 60).find((f) => f.status === 'stopped');
    expect(dwell).toBeDefined();
    expect(dwell!.speed_kmh).toBe(0);
    expect(dwell!.ignition).toBe(false);
  });

  test('moving vehicle reports plausible road speed', () => {
    const v = VEHICLES[0];
    const moving = history(v, T0, T0 + DAY, 60).find((f) => f.status === 'moving');
    expect(moving).toBeDefined();
    expect(moving!.speed_kmh).toBeGreaterThan(15);
    expect(moving!.speed_kmh).toBeLessThan(80);
  });

  test('offline vehicle is frozen at its last reported fix', () => {
    const offline = VEHICLES.find((v) => v.offlineSinceMin !== undefined)!;
    const a = positionAt(offline, T0);
    const b = positionAt(offline, T0 + 3_600_000);
    expect(a.status).toBe('offline');
    expect(a.speed_kmh).toBe(0);
    // Frozen relative to "minutes ago" — one hour later it has shifted by the
    // same lag, so the reported timestamp must trail wall clock by offlineSinceMin.
    expect(Date.parse(a.timestamp)).toBe(T0 - offline.offlineSinceMin! * 60_000);
    expect(Date.parse(b.timestamp)).toBe(
      T0 + 3_600_000 - offline.offlineSinceMin! * 60_000,
    );
  });

  test('getVehicle resolves by id and by plate', () => {
    expect(getVehicle('v1')?.id).toBe('v1');
    expect(getVehicle('B 9114 TRK')?.id).toBe('v1');
    expect(getVehicle('nope')).toBeUndefined();
  });
});

describe('history & tripStats', () => {
  test('a port-shuttle truck covers real distance in 24h', () => {
    const v = VEHICLES[0];
    const fixes = history(v, T0 - DAY, T0, 300);
    const stats = tripStats(fixes, 300);
    expect(stats.distance_km).toBeGreaterThan(30);
    expect(stats.distance_km).toBeLessThan(400);
    expect(stats.moving_minutes).toBeGreaterThan(60);
    expect(stats.stopped_minutes).toBeGreaterThan(60);
    expect(stats.max_speed_kmh).toBeLessThan(80);
  });
});

describe('geofences', () => {
  test('vehicle dwelling at the warehouse is inside the warehouse fence', () => {
    const v = VEHICLES[0];
    const atWh = history(v, T0, T0 + DAY, 60).find(
      (f) => f.status === 'stopped' && haversineMeters(f, WAREHOUSE) < 50,
    );
    expect(atWh).toBeDefined();
    const fence = GEOFENCES.find((g) => g.id === 'wh-cakung')!;
    expect(insideGeofence(atWh!, fence)).toBe(true);
  });

  test('a 24h window produces both enter and exit events', () => {
    const events = geofenceEvents([VEHICLES[0]], T0 - DAY, T0);
    const kinds = new Set(events.map((e) => e.event));
    expect(events.length).toBeGreaterThan(2);
    expect(kinds.has('enter')).toBe(true);
    expect(kinds.has('exit')).toBe(true);
  });

  test('events alternate enter/exit per vehicle+fence pair', () => {
    const events = geofenceEvents([VEHICLES[0]], T0 - DAY, T0);
    const byFence = new Map<string, string[]>();
    for (const e of events) {
      const key = `${e.vehicle_id}:${e.geofence_id}`;
      byFence.set(key, [...(byFence.get(key) ?? []), e.event]);
    }
    for (const seq of byFence.values()) {
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]).not.toBe(seq[i - 1]);
      }
    }
  });
});
