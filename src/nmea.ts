/**
 * Minimal, dependency-free NMEA 0183 parser for the sentences that matter in
 * fleet tracking: RMC (position + speed + course), GGA (fix quality), and
 * VTG (ground speed). Validates checksums and reports per-sentence errors
 * instead of throwing.
 */

export interface NmeaFix {
  sentence: 'RMC' | 'GGA' | 'VTG';
  talker: string;
  lat?: number;
  lon?: number;
  speed_kmh?: number;
  course_deg?: number;
  time_utc?: string;
  date?: string;
  valid?: boolean;
  fix_quality?: number;
  satellites?: number;
  hdop?: number;
  altitude_m?: number;
}

export interface NmeaParseResult {
  fixes: NmeaFix[];
  errors: { sentence: string; reason: string }[];
}

const KNOTS_TO_KMH = 1.852;

export function nmeaChecksum(body: string): string {
  let sum = 0;
  for (const ch of body) sum ^= ch.charCodeAt(0);
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

/** "4807.038", "N" → 48.1173 ; "01131.000", "E" → 11.516667 */
function parseCoord(value: string, hemi: string): number | undefined {
  if (!value || !hemi) return undefined;
  const dot = value.indexOf('.');
  const degDigits = (dot === -1 ? value.length : dot) - 2;
  if (degDigits < 1) return undefined;
  const deg = Number(value.slice(0, degDigits));
  const min = Number(value.slice(degDigits));
  if (Number.isNaN(deg) || Number.isNaN(min)) return undefined;
  const dec = deg + min / 60;
  return hemi === 'S' || hemi === 'W' ? -dec : dec;
}

function parseRmc(talker: string, f: string[]): NmeaFix {
  return {
    sentence: 'RMC',
    talker,
    time_utc: f[1] || undefined,
    valid: f[2] === 'A',
    lat: parseCoord(f[3], f[4]),
    lon: parseCoord(f[5], f[6]),
    speed_kmh: f[7] ? Number((Number(f[7]) * KNOTS_TO_KMH).toFixed(2)) : undefined,
    course_deg: f[8] ? Number(f[8]) : undefined,
    date: f[9] || undefined,
  };
}

function parseGga(talker: string, f: string[]): NmeaFix {
  return {
    sentence: 'GGA',
    talker,
    time_utc: f[1] || undefined,
    lat: parseCoord(f[2], f[3]),
    lon: parseCoord(f[4], f[5]),
    fix_quality: f[6] ? Number(f[6]) : undefined,
    satellites: f[7] ? Number(f[7]) : undefined,
    hdop: f[8] ? Number(f[8]) : undefined,
    altitude_m: f[9] ? Number(f[9]) : undefined,
  };
}

function parseVtg(talker: string, f: string[]): NmeaFix {
  return {
    sentence: 'VTG',
    talker,
    course_deg: f[1] ? Number(f[1]) : undefined,
    speed_kmh: f[7] ? Number(f[7]) : undefined,
  };
}

/**
 * Parse one or more newline-separated NMEA sentences.
 * Bad checksums and unsupported sentence types land in `errors`.
 */
export function parseNmea(raw: string): NmeaParseResult {
  const result: NmeaParseResult = { fixes: [], errors: [] };

  for (const line of raw.split(/\r?\n/)) {
    const sentence = line.trim();
    if (!sentence) continue;

    if (!sentence.startsWith('$')) {
      result.errors.push({ sentence, reason: 'missing leading $' });
      continue;
    }

    const starIdx = sentence.lastIndexOf('*');
    if (starIdx === -1 || starIdx === sentence.length - 1) {
      result.errors.push({ sentence, reason: 'missing checksum' });
      continue;
    }

    const body = sentence.slice(1, starIdx);
    const expected = sentence.slice(starIdx + 1).toUpperCase();
    const actual = nmeaChecksum(body);
    if (actual !== expected) {
      result.errors.push({
        sentence,
        reason: `checksum mismatch (expected ${actual}, got ${expected})`,
      });
      continue;
    }

    const fields = body.split(',');
    const header = fields[0];
    const talker = header.slice(0, 2);
    const type = header.slice(2);

    if (type === 'RMC') result.fixes.push(parseRmc(talker, fields));
    else if (type === 'GGA') result.fixes.push(parseGga(talker, fields));
    else if (type === 'VTG') result.fixes.push(parseVtg(talker, fields));
    else result.errors.push({ sentence, reason: `unsupported sentence type ${header}` });
  }

  return result;
}
