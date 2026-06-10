/**
 * Deterministic fleet simulator. A vehicle's position is a pure function of
 * wall-clock time: each route is a fixed cycle of dwells and drives, and the
 * vehicle's phase within that cycle is derived from (now - EPOCH + offset).
 * This gives consistent positions, replayable history, and geofence events
 * without any background process or storage.
 */
import {
  bearingDeg,
  haversineMeters,
  interpolate,
  pointInCircle,
  pointInPolygon,
  type LatLon,
} from './geo.js';
import {
  GEOFENCES,
  ROUTES,
  VEHICLES,
  type GeofenceDef,
  type RouteDef,
  type VehicleDef,
} from './demo-fleet.js';

export const EPOCH = Date.parse('2026-01-01T00:00:00Z');

export interface Fix {
  vehicle_id: string;
  timestamp: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  heading_deg: number;
  ignition: boolean;
  status: 'moving' | 'stopped' | 'offline';
  near?: string;
}

export interface GeofenceEvent {
  vehicle_id: string;
  plate: string;
  geofence_id: string;
  geofence_name: string;
  event: 'enter' | 'exit';
  timestamp: string;
}

interface Segment {
  kind: 'dwell' | 'drive';
  durationS: number;
  from: LatLon & { name: string };
  to: LatLon & { name: string };
  distanceM: number;
}

function buildCycle(route: RouteDef): { segments: Segment[]; totalS: number } {
  const segments: Segment[] = [];
  const n = route.stops.length;
  for (let i = 0; i < n; i++) {
    const from = route.stops[i];
    const to = route.stops[(i + 1) % n];
    segments.push({
      kind: 'dwell',
      durationS: from.dwellMin * 60,
      from,
      to: from,
      distanceM: 0,
    });
    const distanceM = haversineMeters(from, to);
    segments.push({
      kind: 'drive',
      durationS: (distanceM / 1000 / route.speedKmh) * 3600,
      from,
      to,
      distanceM,
    });
  }
  return { segments, totalS: segments.reduce((s, x) => s + x.durationS, 0) };
}

const cycles = new Map(ROUTES.map((r) => [r.id, buildCycle(r)]));

export function getVehicle(id: string): VehicleDef | undefined {
  return VEHICLES.find((v) => v.id === id || v.plate === id);
}

export function listVehicleDefs(): VehicleDef[] {
  return VEHICLES;
}

export function listGeofenceDefs(): GeofenceDef[] {
  return GEOFENCES;
}

/** Smooth deterministic speed jitter so traces look like traffic, not rails. */
function jitter(tMs: number, vehicleId: string): number {
  const seed = vehicleId.charCodeAt(1) * 13.7;
  return 0.82 + 0.18 * Math.sin(tMs / 47_000 + seed);
}

export function positionAt(vehicle: VehicleDef, tMs: number): Fix {
  const offline =
    vehicle.offlineSinceMin !== undefined
      ? tMs - vehicle.offlineSinceMin * 60_000
      : undefined;
  const effectiveT = offline ?? tMs;

  const route = ROUTES.find((r) => r.id === vehicle.routeId)!;
  const { segments, totalS } = cycles.get(route.id)!;
  let phaseS =
    (((effectiveT - EPOCH) / 1000 + vehicle.phaseOffsetMin * 60) % totalS +
      totalS) %
    totalS;

  for (const seg of segments) {
    if (phaseS > seg.durationS) {
      phaseS -= seg.durationS;
      continue;
    }
    const base: Omit<Fix, 'lat' | 'lon' | 'speed_kmh' | 'heading_deg'> = {
      vehicle_id: vehicle.id,
      timestamp: new Date(effectiveT).toISOString(),
      ignition: seg.kind === 'drive' || seg.from.name !== seg.to.name,
      status: offline !== undefined ? 'offline' : seg.kind === 'dwell' ? 'stopped' : 'moving',
    };
    if (seg.kind === 'dwell') {
      return {
        ...base,
        lat: seg.from.lat,
        lon: seg.from.lon,
        speed_kmh: 0,
        heading_deg: 0,
        ignition: false,
        near: seg.from.name,
      };
    }
    const f = phaseS / seg.durationS;
    const p = interpolate(seg.from, seg.to, f);
    const speed =
      offline !== undefined
        ? 0
        : Number((route.speedKmh * jitter(effectiveT, vehicle.id)).toFixed(1));
    return {
      ...base,
      lat: Number(p.lat.toFixed(6)),
      lon: Number(p.lon.toFixed(6)),
      speed_kmh: offline !== undefined ? 0 : speed,
      heading_deg: Number(bearingDeg(seg.from, seg.to).toFixed(1)),
      status: offline !== undefined ? 'offline' : 'moving',
      near: f < 0.15 ? seg.from.name : f > 0.85 ? seg.to.name : undefined,
    };
  }
  // Unreachable: phase is always inside the cycle.
  throw new Error(`phase out of cycle for ${vehicle.id}`);
}

export function history(
  vehicle: VehicleDef,
  fromMs: number,
  toMs: number,
  stepS = 60,
): Fix[] {
  const fixes: Fix[] = [];
  for (let t = fromMs; t <= toMs; t += stepS * 1000) {
    fixes.push(positionAt(vehicle, t));
  }
  return fixes;
}

export interface TripStats {
  distance_km: number;
  moving_minutes: number;
  stopped_minutes: number;
  avg_moving_speed_kmh: number;
  max_speed_kmh: number;
}

export function tripStats(fixes: Fix[], stepS = 60): TripStats {
  let distanceM = 0;
  let movingS = 0;
  let stoppedS = 0;
  let speedSum = 0;
  let maxSpeed = 0;
  for (let i = 1; i < fixes.length; i++) {
    distanceM += haversineMeters(fixes[i - 1], fixes[i]);
  }
  for (const f of fixes) {
    if (f.speed_kmh > 3) {
      movingS += stepS;
      speedSum += f.speed_kmh;
      maxSpeed = Math.max(maxSpeed, f.speed_kmh);
    } else {
      stoppedS += stepS;
    }
  }
  const movingCount = movingS / stepS;
  return {
    distance_km: Number((distanceM / 1000).toFixed(2)),
    moving_minutes: Math.round(movingS / 60),
    stopped_minutes: Math.round(stoppedS / 60),
    avg_moving_speed_kmh: movingCount
      ? Number((speedSum / movingCount).toFixed(1))
      : 0,
    max_speed_kmh: Number(maxSpeed.toFixed(1)),
  };
}

export function insideGeofence(p: LatLon, g: GeofenceDef): boolean {
  if (g.type === 'circle') return pointInCircle(p, g.center!, g.radiusM!);
  return pointInPolygon(p, g.vertices!);
}

export function geofenceEvents(
  vehicles: VehicleDef[],
  fromMs: number,
  toMs: number,
  geofences: GeofenceDef[] = GEOFENCES,
  stepS = 30,
): GeofenceEvent[] {
  const events: GeofenceEvent[] = [];
  for (const v of vehicles) {
    const inside = new Map<string, boolean>();
    for (let t = fromMs; t <= toMs; t += stepS * 1000) {
      const fix = positionAt(v, t);
      for (const g of geofences) {
        const now = insideGeofence(fix, g);
        const prev = inside.get(g.id);
        if (prev !== undefined && prev !== now) {
          events.push({
            vehicle_id: v.id,
            plate: v.plate,
            geofence_id: g.id,
            geofence_name: g.name,
            event: now ? 'enter' : 'exit',
            timestamp: new Date(t).toISOString(),
          });
        }
        inside.set(g.id, now);
      }
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
