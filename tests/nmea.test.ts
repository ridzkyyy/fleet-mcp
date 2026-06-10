import { describe, expect, test } from 'vitest';
import { nmeaChecksum, parseNmea } from '../src/nmea.js';

// Classic reference sentence from the NMEA 0183 spec examples.
const RMC = '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A';
const GGA = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';

describe('nmeaChecksum', () => {
  test('matches known checksums', () => {
    expect(nmeaChecksum(RMC.slice(1, RMC.lastIndexOf('*')))).toBe('6A');
    expect(nmeaChecksum(GGA.slice(1, GGA.lastIndexOf('*')))).toBe('47');
  });
});

describe('parseNmea — RMC', () => {
  test('parses position, speed, and course', () => {
    const { fixes, errors } = parseNmea(RMC);
    expect(errors).toHaveLength(0);
    expect(fixes).toHaveLength(1);
    const fix = fixes[0];
    expect(fix.sentence).toBe('RMC');
    expect(fix.talker).toBe('GP');
    expect(fix.valid).toBe(true);
    expect(fix.lat).toBeCloseTo(48.1173, 4);
    expect(fix.lon).toBeCloseTo(11.5167, 4);
    expect(fix.speed_kmh).toBeCloseTo(22.4 * 1.852, 1);
    expect(fix.course_deg).toBeCloseTo(84.4, 1);
    expect(fix.date).toBe('230394');
  });

  test('southern/western hemispheres are negative', () => {
    const body = 'GPRMC,060000,A,0611.022,S,10653.002,E,010.0,180.0,110626,,';
    const sentence = `$${body}*${nmeaChecksum(body)}`;
    const { fixes } = parseNmea(sentence);
    expect(fixes[0].lat).toBeCloseTo(-6.1837, 3);
    expect(fixes[0].lon).toBeCloseTo(106.8834, 3);
  });
});

describe('parseNmea — GGA', () => {
  test('parses fix quality, satellites, hdop, altitude', () => {
    const { fixes } = parseNmea(GGA);
    expect(fixes[0].sentence).toBe('GGA');
    expect(fixes[0].fix_quality).toBe(1);
    expect(fixes[0].satellites).toBe(8);
    expect(fixes[0].hdop).toBeCloseTo(0.9);
    expect(fixes[0].altitude_m).toBeCloseTo(545.4);
  });
});

describe('parseNmea — error handling', () => {
  test('rejects corrupted checksum without throwing', () => {
    const corrupted = RMC.replace('*6A', '*FF');
    const { fixes, errors } = parseNmea(corrupted);
    expect(fixes).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain('checksum mismatch');
  });

  test('reports unsupported sentence types', () => {
    const body = 'GPGSV,3,1,11,03,03,111,00';
    const { errors } = parseNmea(`$${body}*${nmeaChecksum(body)}`);
    expect(errors[0].reason).toContain('unsupported');
  });

  test('handles multi-line input with mixed validity', () => {
    const { fixes, errors } = parseNmea(`${RMC}\n\nnot-nmea\n${GGA}`);
    expect(fixes).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  test('empty input yields empty result', () => {
    const { fixes, errors } = parseNmea('');
    expect(fixes).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
