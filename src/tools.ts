import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { haversineMeters } from './geo.js';
import { parseNmea } from './nmea.js';
import {
  geofenceEvents,
  getVehicle,
  history,
  insideGeofence,
  listGeofenceDefs,
  listVehicleDefs,
  positionAt,
  tripStats,
} from './simulator.js';

const HOURS_MAX = 48;

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

const errorResult = (message: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  isError: true,
});

const vehicleNotFound = (id: string) =>
  errorResult(
    `vehicle "${id}" not found — use list_vehicles to see ids and plates`,
  );

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'fleet-mcp', version: '0.1.0' });

  server.registerTool(
    'list_vehicles',
    {
      title: 'List vehicles',
      description:
        'List every vehicle in the fleet with its current status, position, driver, and route.',
      inputSchema: {},
    },
    async () => {
      const now = Date.now();
      return json(
        listVehicleDefs().map((v) => {
          const fix = positionAt(v, now);
          return {
            id: v.id,
            plate: v.plate,
            name: v.name,
            driver: v.driver,
            route: v.routeId,
            status: fix.status,
            lat: fix.lat,
            lon: fix.lon,
            speed_kmh: fix.speed_kmh,
            near: fix.near,
            last_seen: fix.timestamp,
          };
        }),
      );
    },
  );

  server.registerTool(
    'get_vehicle_position',
    {
      title: 'Get vehicle position',
      description:
        'Latest GPS fix for one vehicle: coordinates, speed, heading, ignition, and status. Accepts vehicle id or plate.',
      inputSchema: { vehicle_id: z.string().describe('Vehicle id (e.g. "v1") or plate') },
    },
    async ({ vehicle_id }) => {
      const v = getVehicle(vehicle_id);
      if (!v) return vehicleNotFound(vehicle_id);
      return json(positionAt(v, Date.now()));
    },
  );

  server.registerTool(
    'get_trip_history',
    {
      title: 'Get trip history',
      description:
        'Sampled GPS track for a vehicle over the past N hours, with distance, moving/stopped time, and speed stats.',
      inputSchema: {
        vehicle_id: z.string().describe('Vehicle id or plate'),
        hours: z.number().min(0.25).max(HOURS_MAX).default(4)
          .describe(`Lookback window in hours (max ${HOURS_MAX})`),
        sample_minutes: z.number().min(1).max(30).default(5)
          .describe('Minutes between track points'),
      },
    },
    async ({ vehicle_id, hours, sample_minutes }) => {
      const v = getVehicle(vehicle_id);
      if (!v) return vehicleNotFound(vehicle_id);
      const now = Date.now();
      const stepS = sample_minutes * 60;
      const fixes = history(v, now - hours * 3_600_000, now, stepS);
      return json({
        vehicle_id: v.id,
        plate: v.plate,
        window_hours: hours,
        stats: tripStats(fixes, stepS),
        track: fixes.map((f) => ({
          t: f.timestamp,
          lat: f.lat,
          lon: f.lon,
          speed_kmh: f.speed_kmh,
          status: f.status,
        })),
      });
    },
  );

  server.registerTool(
    'list_geofences',
    {
      title: 'List geofences',
      description:
        'List defined geofences (circles and polygons) and which vehicles are currently inside each.',
      inputSchema: {},
    },
    async () => {
      const now = Date.now();
      return json(
        listGeofenceDefs().map((g) => ({
          id: g.id,
          name: g.name,
          type: g.type,
          ...(g.type === 'circle'
            ? { center: g.center, radius_m: g.radiusM }
            : { vertices: g.vertices }),
          vehicles_inside: listVehicleDefs()
            .filter((v) => insideGeofence(positionAt(v, now), g))
            .map((v) => v.plate),
        })),
      );
    },
  );

  server.registerTool(
    'get_geofence_events',
    {
      title: 'Get geofence events',
      description:
        'Enter/exit events for geofences over the past N hours, optionally filtered by vehicle or geofence.',
      inputSchema: {
        hours: z.number().min(0.25).max(HOURS_MAX).default(6)
          .describe(`Lookback window in hours (max ${HOURS_MAX})`),
        vehicle_id: z.string().optional().describe('Filter: vehicle id or plate'),
        geofence_id: z.string().optional().describe('Filter: geofence id'),
      },
    },
    async ({ hours, vehicle_id, geofence_id }) => {
      let vehicles = listVehicleDefs();
      if (vehicle_id) {
        const v = getVehicle(vehicle_id);
        if (!v) return vehicleNotFound(vehicle_id);
        vehicles = [v];
      }
      let geofences = listGeofenceDefs();
      if (geofence_id) {
        geofences = geofences.filter((g) => g.id === geofence_id);
        if (geofences.length === 0) {
          return errorResult(
            `geofence "${geofence_id}" not found — use list_geofences`,
          );
        }
      }
      const now = Date.now();
      const events = geofenceEvents(
        vehicles,
        now - hours * 3_600_000,
        now,
        geofences,
      );
      return json({ window_hours: hours, count: events.length, events });
    },
  );

  server.registerTool(
    'get_fleet_summary',
    {
      title: 'Get fleet summary',
      description:
        'Operational snapshot: vehicles moving / stopped / offline, and distance covered by each vehicle in the past 24 h.',
      inputSchema: {},
    },
    async () => {
      const now = Date.now();
      const rows = listVehicleDefs().map((v) => {
        const fix = positionAt(v, now);
        const fixes = history(v, now - 24 * 3_600_000, now, 300);
        return {
          plate: v.plate,
          status: fix.status,
          distance_24h_km: tripStats(fixes, 300).distance_km,
        };
      });
      return json({
        generated_at: new Date(now).toISOString(),
        total: rows.length,
        moving: rows.filter((r) => r.status === 'moving').length,
        stopped: rows.filter((r) => r.status === 'stopped').length,
        offline: rows.filter((r) => r.status === 'offline').length,
        vehicles: rows,
      });
    },
  );

  server.registerTool(
    'find_nearest_vehicle',
    {
      title: 'Find nearest vehicle',
      description:
        'Find the closest reporting vehicles to a coordinate — for dispatch decisions. Returns distance as the crow flies.',
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        limit: z.number().min(1).max(10).default(3),
      },
    },
    async ({ lat, lon, limit }) => {
      const now = Date.now();
      const ranked = listVehicleDefs()
        .map((v) => ({ v, fix: positionAt(v, now) }))
        .filter(({ fix }) => fix.status !== 'offline')
        .map(({ v, fix }) => ({
          id: v.id,
          plate: v.plate,
          driver: v.driver,
          status: fix.status,
          distance_km: Number(
            (haversineMeters({ lat, lon }, fix) / 1000).toFixed(2),
          ),
        }))
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, limit);
      return json({ query: { lat, lon }, nearest: ranked });
    },
  );

  server.registerTool(
    'parse_nmea',
    {
      title: 'Parse NMEA sentences',
      description:
        'Parse raw NMEA 0183 sentences (RMC, GGA, VTG) into structured fixes with decimal coordinates and km/h speeds. Validates checksums; invalid sentences are reported, not dropped silently.',
      inputSchema: {
        raw: z.string().describe('One or more newline-separated NMEA sentences'),
      },
    },
    async ({ raw }) => json(parseNmea(raw)),
  );

  return server;
}
