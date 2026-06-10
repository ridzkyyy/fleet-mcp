/**
 * End-to-end: a real MCP client talking to the server over an in-memory
 * transport — the same code path Claude Desktop or MCP Lab exercises.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/tools.js';

let client: Client;

const callJson = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text: string }[];
  return { json: JSON.parse(content[0].text), isError: res.isError === true };
};

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildServer().connect(serverTransport);
  client = new Client({ name: 'fleet-mcp-tests', version: '0.0.0' });
  await client.connect(clientTransport);
});

describe('tool registry', () => {
  test('exposes all 8 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'find_nearest_vehicle',
      'get_fleet_summary',
      'get_geofence_events',
      'get_trip_history',
      'get_vehicle_position',
      'list_geofences',
      'list_vehicles',
      'parse_nmea',
    ]);
  });
});

describe('fleet tools', () => {
  test('list_vehicles returns the full roster with live status', async () => {
    const { json } = await callJson('list_vehicles');
    expect(json).toHaveLength(6);
    expect(json[0]).toMatchObject({ id: 'v1', plate: 'B 9114 TRK' });
    expect(json.some((v: { status: string }) => v.status === 'offline')).toBe(true);
  });

  test('get_vehicle_position works by plate and rejects unknown ids', async () => {
    const ok = await callJson('get_vehicle_position', { vehicle_id: 'B 9114 TRK' });
    expect(ok.json.vehicle_id).toBe('v1');
    expect(typeof ok.json.lat).toBe('number');

    const bad = await callJson('get_vehicle_position', { vehicle_id: 'ghost' });
    expect(bad.isError).toBe(true);
    expect(bad.json.error).toContain('not found');
  });

  test('get_trip_history returns stats plus a track', async () => {
    const { json } = await callJson('get_trip_history', {
      vehicle_id: 'v1',
      hours: 4,
      sample_minutes: 5,
    });
    expect(json.stats.distance_km).toBeGreaterThan(0);
    expect(json.track.length).toBeGreaterThan(40);
  });

  test('get_geofence_events filters by geofence and validates ids', async () => {
    const ok = await callJson('get_geofence_events', {
      hours: 24,
      geofence_id: 'wh-cakung',
    });
    expect(ok.json.events.every((e: { geofence_id: string }) => e.geofence_id === 'wh-cakung')).toBe(true);

    const bad = await callJson('get_geofence_events', { geofence_id: 'nope' });
    expect(bad.isError).toBe(true);
  });

  test('get_fleet_summary counts add up', async () => {
    const { json } = await callJson('get_fleet_summary');
    expect(json.moving + json.stopped + json.offline).toBe(json.total);
    expect(json.total).toBe(6);
  });

  test('find_nearest_vehicle excludes offline vehicles and sorts by distance', async () => {
    const { json } = await callJson('find_nearest_vehicle', {
      lat: -6.1837,
      lon: 106.9522,
      limit: 5,
    });
    const dists = json.nearest.map((n: { distance_km: number }) => n.distance_km);
    expect([...dists].sort((a, b) => a - b)).toEqual(dists);
    expect(json.nearest.some((n: { plate: string }) => n.plate === 'B 9211 TRH')).toBe(false);
  });

  test('parse_nmea round-trips a valid RMC sentence', async () => {
    const { json } = await callJson('parse_nmea', {
      raw: '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A',
    });
    expect(json.fixes).toHaveLength(1);
    expect(json.fixes[0].lat).toBeCloseTo(48.1173, 3);
  });
});
