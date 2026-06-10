/**
 * Demo fleet: a small Jakarta logistics operation. Six vehicles on three
 * recurring routes between Tanjung Priok port, a Cakung warehouse, and
 * distribution points east of the city. Everything is deterministic — the
 * simulator derives state purely from wall-clock time, so there is no
 * background process and no storage.
 */
import type { LatLon } from './geo.js';

export interface RouteStop extends LatLon {
  name: string;
  /** Minutes the vehicle dwells here each cycle (ignition off when > 2). */
  dwellMin: number;
}

export interface RouteDef {
  id: string;
  name: string;
  speedKmh: number;
  stops: RouteStop[];
}

export interface VehicleDef {
  id: string;
  plate: string;
  name: string;
  driver: string;
  routeId: string;
  /** Phase offset in minutes so vehicles on one route don't overlap. */
  phaseOffsetMin: number;
  /** Minutes ago this vehicle last reported; undefined = reporting live. */
  offlineSinceMin?: number;
}

export interface GeofenceDef {
  id: string;
  name: string;
  type: 'circle' | 'polygon';
  center?: LatLon;
  radiusM?: number;
  vertices?: LatLon[];
}

export const PORT = { lat: -6.1045, lon: 106.8865 };
export const WAREHOUSE = { lat: -6.1837, lon: 106.9522 };
export const KELAPA_GADING = { lat: -6.1602, lon: 106.9054 };
export const SUNTER = { lat: -6.1352, lon: 106.8753 };
export const BEKASI_DC = { lat: -6.2412, lon: 107.0013 };
export const CIKARANG = { lat: -6.2879, lon: 107.1456 };

export const ROUTES: RouteDef[] = [
  {
    id: 'port-shuttle',
    name: 'Port shuttle (Tanjung Priok ⇄ Cakung WH)',
    speedKmh: 38,
    stops: [
      { ...WAREHOUSE, name: 'Cakung Warehouse', dwellMin: 25 },
      { ...PORT, name: 'Tanjung Priok Port', dwellMin: 35 },
    ],
  },
  {
    id: 'city-distribution',
    name: 'City distribution loop',
    speedKmh: 30,
    stops: [
      { ...WAREHOUSE, name: 'Cakung Warehouse', dwellMin: 20 },
      { ...KELAPA_GADING, name: 'Kelapa Gading drop', dwellMin: 12 },
      { ...SUNTER, name: 'Sunter drop', dwellMin: 12 },
    ],
  },
  {
    id: 'bekasi-linehaul',
    name: 'Bekasi–Cikarang linehaul',
    speedKmh: 55,
    stops: [
      { ...WAREHOUSE, name: 'Cakung Warehouse', dwellMin: 30 },
      { ...BEKASI_DC, name: 'Bekasi DC', dwellMin: 20 },
      { ...CIKARANG, name: 'Cikarang plant', dwellMin: 25 },
    ],
  },
];

export const VEHICLES: VehicleDef[] = [
  {
    id: 'v1',
    plate: 'B 9114 TRK',
    name: 'CDD Box 01',
    driver: 'Asep Suhendar',
    routeId: 'port-shuttle',
    phaseOffsetMin: 0,
  },
  {
    id: 'v2',
    plate: 'B 9482 TRK',
    name: 'CDD Box 02',
    driver: 'Joko Prasetyo',
    routeId: 'port-shuttle',
    phaseOffsetMin: 55,
  },
  {
    id: 'v3',
    plate: 'B 1761 VAN',
    name: 'Blind Van 01',
    driver: 'Rina Marlina',
    routeId: 'city-distribution',
    phaseOffsetMin: 10,
  },
  {
    id: 'v4',
    plate: 'B 1903 VAN',
    name: 'Blind Van 02',
    driver: 'Dedi Kurniawan',
    routeId: 'city-distribution',
    phaseOffsetMin: 70,
  },
  {
    id: 'v5',
    plate: 'B 9650 TRH',
    name: 'Tronton 01',
    driver: 'Bambang Sutrisno',
    routeId: 'bekasi-linehaul',
    phaseOffsetMin: 25,
  },
  {
    id: 'v6',
    plate: 'B 9211 TRH',
    name: 'Tronton 02',
    driver: 'Hendra Gunawan',
    routeId: 'bekasi-linehaul',
    phaseOffsetMin: 140,
    offlineSinceMin: 187,
  },
];

export const GEOFENCES: GeofenceDef[] = [
  {
    id: 'wh-cakung',
    name: 'Cakung Warehouse',
    type: 'circle',
    center: WAREHOUSE,
    radiusM: 600,
  },
  {
    id: 'port-priok',
    name: 'Tanjung Priok Port Area',
    type: 'polygon',
    vertices: [
      { lat: -6.0935, lon: 106.8705 },
      { lat: -6.0935, lon: 106.9025 },
      { lat: -6.1165, lon: 106.9025 },
      { lat: -6.1165, lon: 106.8705 },
    ],
  },
  {
    id: 'bekasi-dc',
    name: 'Bekasi DC Yard',
    type: 'circle',
    center: BEKASI_DC,
    radiusM: 450,
  },
];
