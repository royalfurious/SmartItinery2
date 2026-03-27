import { Request, Response } from 'express';
import axios from 'axios';

/* ═══════════════════════════════════════════════════════
   AMADEUS  –  Flight Offers Search (test sandbox)
   ═══════════════════════════════════════════════════════ */
const AMADEUS_BASE = 'https://test.api.amadeus.com';
const AMADEUS_KEY = process.env.AMADEUS_API_KEY || '';
const AMADEUS_SECRET = process.env.AMADEUS_API_SECRET || '';

let amadeusToken = '';
let amadeusTokenExpiry = 0;

async function getAmadeusToken(): Promise<string> {
  if (amadeusToken && Date.now() < amadeusTokenExpiry) return amadeusToken;

  const res = await axios.post(
    `${AMADEUS_BASE}/v1/security/oauth2/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: AMADEUS_KEY,
      client_secret: AMADEUS_SECRET,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  amadeusToken = res.data.access_token;
  amadeusTokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return amadeusToken;
}

/* ═══════════════════════════════════════════════════════
   IRCTC / RapidAPI  –  Train search
   ═══════════════════════════════════════════════════════ */
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const IRCTC_HOST = 'irctc1.p.rapidapi.com';

/* ═══════════════════════════════════════════════════════
   IATA / Station code lookups
   ═══════════════════════════════════════════════════════ */

// Common Indian city → IATA airport code mapping
const IATA_MAP: Record<string, string> = {
  'delhi': 'DEL', 'new delhi': 'DEL', 'noida': 'DEL', 'gurgaon': 'DEL', 'gurugram': 'DEL',
  'mumbai': 'BOM', 'bombay': 'BOM',
  'bangalore': 'BLR', 'bengaluru': 'BLR',
  'hyderabad': 'HYD',
  'chennai': 'MAA', 'madras': 'MAA',
  'kolkata': 'CCU', 'calcutta': 'CCU',
  'pune': 'PNQ',
  'ahmedabad': 'AMD',
  'jaipur': 'JAI',
  'goa': 'GOI', 'panaji': 'GOI',
  'lucknow': 'LKO',
  'kochi': 'COK', 'cochin': 'COK',
  'chandigarh': 'IXC',
  'indore': 'IDR',
  'patna': 'PAT',
  'bhopal': 'BHO',
  'varanasi': 'VNS',
  'srinagar': 'SXR',
  'thiruvananthapuram': 'TRV', 'trivandrum': 'TRV',
  'coimbatore': 'CJB',
  'nagpur': 'NAG',
  'amritsar': 'ATQ',
  'ranchi': 'IXR',
  'bhubaneswar': 'BBI',
  'visakhapatnam': 'VTZ', 'vizag': 'VTZ',
  'mangalore': 'IXE', 'mangaluru': 'IXE',
  'udaipur': 'UDR',
  // International
  'london': 'LHR', 'paris': 'CDG', 'tokyo': 'NRT', 'new york': 'JFK',
  'dubai': 'DXB', 'singapore': 'SIN', 'bangkok': 'BKK', 'sydney': 'SYD',
  'hong kong': 'HKG', 'toronto': 'YYZ', 'los angeles': 'LAX',
  'san francisco': 'SFO', 'amsterdam': 'AMS', 'rome': 'FCO',
  'frankfurt': 'FRA', 'istanbul': 'IST', 'kuala lumpur': 'KUL',
  'bali': 'DPS', 'denpasar': 'DPS', 'maldives': 'MLE', 'male': 'MLE',
  'cairo': 'CAI', 'lisbon': 'LIS', 'prague': 'PRG', 'zurich': 'ZRH',
  'barcelona': 'BCN', 'madrid': 'MAD', 'berlin': 'BER',
  'seoul': 'ICN', 'beijing': 'PEK', 'shanghai': 'PVG',
  'himachal pradesh': 'SLV', 'himanchal pradesh': 'SLV', 'shimla': 'SLV',
  'japan': 'NRT', 'united kingdom': 'LHR', 'uk': 'LHR',
  'france': 'CDG', 'italy': 'FCO', 'spain': 'MAD', 'germany': 'FRA',
  'turkey': 'IST', 'thailand': 'BKK', 'south korea': 'ICN',
  'china': 'PEK', 'australia': 'SYD', 'canada': 'YYZ',
  'united arab emirates': 'DXB', 'uae': 'DXB', 'singapore republic': 'SIN',
  'mumbai, maharashtra, india': 'BOM', 'new delhi, delhi, india': 'DEL',
  'bangalore, karnataka, india': 'BLR',
};

// Common Indian city → railway station code mapping
const STATION_MAP: Record<string, string> = {
  'delhi': 'NDLS', 'new delhi': 'NDLS', 'noida': 'NDLS',
  'mumbai': 'CSMT', 'bombay': 'CSMT',
  'bangalore': 'SBC', 'bengaluru': 'SBC',
  'hyderabad': 'SC',
  'chennai': 'MAS', 'madras': 'MAS',
  'kolkata': 'HWH', 'calcutta': 'HWH',
  'pune': 'PUNE',
  'ahmedabad': 'ADI',
  'jaipur': 'JP',
  'goa': 'MAO', 'panaji': 'MAO',
  'lucknow': 'LKO',
  'kochi': 'ERS', 'cochin': 'ERS',
  'chandigarh': 'CDG',
  'bhopal': 'BPL',
  'varanasi': 'BSB',
  'patna': 'PNBE',
  'indore': 'INDB',
  'nagpur': 'NGP',
  'amritsar': 'ASR',
  'coimbatore': 'CBE',
  'thiruvananthapuram': 'TVC', 'trivandrum': 'TVC',
  'bhubaneswar': 'BBS',
  'visakhapatnam': 'VSKP', 'vizag': 'VSKP',
  'mangalore': 'MAQ', 'mangaluru': 'MAQ',
  'udaipur': 'UDZ',
  'agra': 'AGC',
  'ranchi': 'RNC',
  'himachal pradesh': 'KLK', 'himanchal pradesh': 'KLK', 'shimla': 'SML',
};

const LOCATION_COORDS: Record<string, { lat: number; lon: number }> = {
  // India
  'avadi': { lat: 13.1143, lon: 80.1098 },
  'chennai': { lat: 13.0827, lon: 80.2707 },
  'bangalore': { lat: 12.9716, lon: 77.5946 },
  'bengaluru': { lat: 12.9716, lon: 77.5946 },
  'mumbai': { lat: 19.076, lon: 72.8777 },
  'delhi': { lat: 28.6139, lon: 77.209 },
  'new delhi': { lat: 28.6139, lon: 77.209 },
  'hyderabad': { lat: 17.385, lon: 78.4867 },
  'kolkata': { lat: 22.5726, lon: 88.3639 },
  'pune': { lat: 18.5204, lon: 73.8567 },
  'goa': { lat: 15.2993, lon: 74.124 },
  'shimla': { lat: 31.1048, lon: 77.1734 },
  'himachal pradesh': { lat: 31.1048, lon: 77.1734 },
  'himanchal pradesh': { lat: 31.1048, lon: 77.1734 },
  'chandigarh': { lat: 30.7333, lon: 76.7794 },
  // International
  'male': { lat: 4.1755, lon: 73.5093 },
  'maldives': { lat: 4.1755, lon: 73.5093 },
  'singapore': { lat: 1.3521, lon: 103.8198 },
  'dubai': { lat: 25.2048, lon: 55.2708 },
  'london': { lat: 51.5074, lon: -0.1278 },
  'paris': { lat: 48.8566, lon: 2.3522 },
  'tokyo': { lat: 35.6762, lon: 139.6503 },
  'new york': { lat: 40.7128, lon: -74.0060 },
};

const INDIAN_IATA_CODES = new Set<string>([
  'DEL', 'BOM', 'BLR', 'HYD', 'MAA', 'CCU', 'PNQ', 'AMD', 'JAI', 'GOI', 'LKO',
  'COK', 'IXC', 'IDR', 'PAT', 'BHO', 'VNS', 'SXR', 'TRV', 'CJB', 'NAG', 'ATQ',
  'IXR', 'BBI', 'VTZ', 'IXE', 'UDR'
]);

const INDIAN_LOCATION_KEYS = new Set<string>([
  ...Object.keys(STATION_MAP),
  'india', 'tamil nadu', 'maharashtra', 'karnataka', 'kerala', 'uttarakhand',
  'telangana', 'west bengal', 'rajasthan', 'gujarat', 'punjab', 'goa'
]);

function normalizeLocationParts(value: string): string[] {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const parts = normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const candidates = new Set<string>([normalized, ...parts]);

  // Also try de-punctuated versions of each candidate (for inputs like "St. Louis").
  for (const candidate of [...candidates]) {
    const plain = candidate.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (plain) candidates.add(plain);
  }

  return [...candidates];
}

function resolveFromMap(value: string, lookup: Record<string, string>): string | null {
  const candidates = normalizeLocationParts(value);
  for (const key of candidates) {
    if (lookup[key]) return lookup[key];
  }
  return null;
}

function resolveCoordsFromLocation(value: string): { lat: number; lon: number } | null {
  const candidates = normalizeLocationParts(value);
  for (const key of candidates) {
    if (LOCATION_COORDS[key]) return LOCATION_COORDS[key];
  }
  return null;
}

function isLikelyIndiaLocation(value: string, iata?: string | null): boolean {
  if (iata && INDIAN_IATA_CODES.has(iata)) return true;
  const candidates = normalizeLocationParts(value);
  return candidates.some((key) => INDIAN_LOCATION_KEYS.has(key));
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function resolveIATA(city: string): string | null {
  return resolveFromMap(city, IATA_MAP);
}

function resolveStation(city: string): string | null {
  return resolveFromMap(city, STATION_MAP);
}

/* ═══════════════════════════════════════════════════════
   Helper: format minutes to "Xh Ym"
   ═══════════════════════════════════════════════════════ */

function durationToMinutes(isoDuration: string): number {
  // PT2H30M → 150
  const h = isoDuration.match(/(\d+)H/);
  const m = isoDuration.match(/(\d+)M/);
  return (h ? parseInt(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0);
}

/* ═══════════════════════════════════════════════════════
   BUS estimation (no free API)
   ═══════════════════════════════════════════════════════ */

function estimateBusOptions(source: string, dest: string, passengers: number) {
  const dist = estimateDistance(source, dest);
  const providers = ['RedBus Express', 'GreenLine Travels', 'Royal Cruiser'];
  return providers.map((prov, i) => {
    const speed = 42 + i * 4;
    const dur = Math.round((dist / speed) * 60);
    const basePrice = +(220 + dist * (1.35 + i * 0.2)).toFixed(2);
    const dep = 6 + i * 3;
    return {
      mode: 'bus' as const,
      provider: prov,
      pricePerPerson: basePrice,
      totalPrice: +(basePrice * passengers).toFixed(2),
      durationMinutes: dur,
      departureTime: fmtTime(dep, 0),
      arrivalTime: fmtTime(dep, dur),
      co2Kg: +(dist * 0.027).toFixed(1),
    };
  });
}

function pushEstimatedFlights(arr: any[], source: string, dest: string, passengers: number, isDomestic: boolean) {
  const rawDist = estimateDistance(source, dest);
  const dist = isDomestic ? Math.max(220, rawDist) : Math.max(1400, rawDist);
  const providers = ['IndiGo', 'Air India', 'Vistara'];
  for (let i = 0; i < providers.length; i++) {
    const speed = isDomestic ? 650 + i * 40 : 780 + i * 60;
    const airportBuffer = isDomestic ? 55 : 120;
    const longRouteBuffer = isDomestic && dist > 1200 ? 70 : 0;
    const dur = Math.max(75, Math.round((dist / speed) * 60) + airportBuffer + longRouteBuffer);
    const basePrice = isDomestic
      ? +(1800 + dist * (4.6 + i * 0.8)).toFixed(2)
      : +(4500 + dist * (8.5 + i * 1.2)).toFixed(2);
    const dep = 6 + i * 4;
    arr.push({
      mode: 'flight',
      provider: `${providers[i]} (est.)`,
      pricePerPerson: basePrice,
      totalPrice: +(basePrice * passengers).toFixed(2),
      durationMinutes: dur,
      departureTime: fmtTime(dep, 0),
      arrivalTime: fmtTime(dep, dur),
      co2Kg: +(dist * 0.115).toFixed(1),
      source: 'estimate',
    });
  }
}

function isPastTravelDate(dateStr: string): boolean {
  const input = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(input.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return input.getTime() < today.getTime();
}

function estimateDistance(a: string, b: string): number {
  const ca = resolveCoordsFromLocation(a);
  const cb = resolveCoordsFromLocation(b);
  if (ca && cb) {
    return Math.max(80, Math.round(haversineKm(ca, cb)));
  }

  let h = 0;
  const s = a.toLowerCase() + '|' + b.toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return 180 + (Math.abs(h) % 1400);
}

function fmtTime(baseHour: number, addMin: number): string {
  const d = new Date(2025, 0, 1, baseHour, 0);
  d.setMinutes(d.getMinutes() + addMin);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/* ═══════════════════════════════════════════════════════
   CONTROLLER: POST /api/transport/search
   ═══════════════════════════════════════════════════════ */

export const searchTransport = async (req: Request, res: Response) => {
  try {
    const { source, destination, date, passengers = 1 } = req.body;

    if (!source || !destination || !date) {
      return res.status(400).json({ error: 'source, destination, and date are required' });
    }

    console.log(`🚀 Transport search: ${source} → ${destination}, date=${date}, pax=${passengers}`);

    const results: any[] = [];
    const errors: string[] = [];
    let hasFlightOptions = false;

    // ─── Flights (Amadeus) ───
    const originIATA = resolveIATA(source);
    const destIATA = resolveIATA(destination);

    // Domestic detection should not depend only on station codes.
    const fromStation = resolveStation(source);
    const toStation = resolveStation(destination);
    const originIsIndia = isLikelyIndiaLocation(source, originIATA);
    const destIsIndia = isLikelyIndiaLocation(destination, destIATA);
    const isDomestic = originIsIndia && destIsIndia;

    if (originIATA && destIATA && AMADEUS_KEY) {
      if (isPastTravelDate(date)) {
        errors.push('Flights: Selected date is in the past — showing estimated options');
        pushEstimatedFlights(results, source, destination, passengers, isDomestic);
        hasFlightOptions = true;
      } else {
      try {
        const token = await getAmadeusToken();
        const flightRes = await axios.get(`${AMADEUS_BASE}/v2/shopping/flight-offers`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            originLocationCode: originIATA,
            destinationLocationCode: destIATA,
            departureDate: date,
            adults: passengers,
            nonStop: false,
            max: 5,
            currencyCode: 'INR',
          },
          timeout: 15000,
        });

        const offers = flightRes.data?.data || [];
        for (const offer of offers) {
          const seg = offer.itineraries?.[0];
          const totalPrice = parseFloat(offer.price?.total || '0');
          const perPerson = +(totalPrice / passengers).toFixed(2);
          const dur = seg?.duration ? durationToMinutes(seg.duration) : 0;

          // Get carrier info
          const firstSeg = seg?.segments?.[0];
          const carrier = flightRes.data?.dictionaries?.carriers?.[firstSeg?.carrierCode] || firstSeg?.carrierCode || 'Airline';
          const depTime = firstSeg?.departure?.at ? new Date(firstSeg.departure.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
          const lastSeg = seg?.segments?.[seg.segments.length - 1];
          const arrTime = lastSeg?.arrival?.at ? new Date(lastSeg.arrival.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
          const stops = (seg?.segments?.length || 1) - 1;

          results.push({
            mode: 'flight',
            provider: `${carrier}${stops > 0 ? ` (${stops} stop${stops > 1 ? 's' : ''})` : ' (Non-stop)'}`,
            pricePerPerson: perPerson,
            totalPrice,
            durationMinutes: dur,
            departureTime: depTime,
            arrivalTime: arrTime,
            co2Kg: +(estimateDistance(source, destination) * 0.115).toFixed(1),
            source: 'amadeus',
          });
        }

        if (offers.length > 0) {
          hasFlightOptions = true;
        } else {
          errors.push('Flights: No live offers found — showing estimated options');
          pushEstimatedFlights(results, source, destination, passengers, isDomestic);
          hasFlightOptions = true;
        }

        console.log(`  ✈ Amadeus returned ${offers.length} flight offers`);
      } catch (flightErr: any) {
        const msg = flightErr.response?.data?.errors?.[0]?.detail || flightErr.message;
        console.error(`  ✈ Amadeus error: ${msg}`);
        errors.push(`Flights: ${msg}`);
        pushEstimatedFlights(results, source, destination, passengers, isDomestic);
        hasFlightOptions = true;
      }
      }
    } else {
      if (!originIATA || !destIATA) {
        errors.push(`Flights: Could not resolve IATA codes for "${!originIATA ? source : destination}"`);
        pushEstimatedFlights(results, source, destination, passengers, isDomestic);
        hasFlightOptions = true;
      }
    }

    console.log(`  🌍 Route type: ${isDomestic ? 'Domestic (India)' : 'International'} — trains/buses ${isDomestic ? 'enabled' : 'skipped'}`);

    // ─── Trains (IRCTC / RapidAPI) — only for domestic routes ───
    if (isDomestic && fromStation && toStation && RAPIDAPI_KEY) {
      try {
        // Search trains between stations
        const trainRes = await axios.get(`https://${IRCTC_HOST}/api/v3/trainBetweenStations`, {
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': IRCTC_HOST,
          },
          params: {
            fromStationCode: fromStation,
            toStationCode: toStation,
            dateOfJourney: date,
          },
          timeout: 15000,
        });

        const trains = trainRes.data?.data || [];
        // Take top 5 trains
        const topTrains = trains.slice(0, 5);

        for (const train of topTrains) {
          const trainName = train.train_name || train.trainName || 'Train';
          const trainNumber = train.train_number || train.trainNumber || '';
          const dur = parseInt(train.duration_h || '0') * 60 + parseInt(train.duration_m || '0');

          // Estimate train fare (IRCTC free tier doesn't always include fares)
          const dist = estimateDistance(source, destination);
          const baseFare = train.fare || +(dist * 6).toFixed(2);
          const perPerson = +baseFare;
          const depTime = train.from_std || train.departureTime || '';
          const arrTime = train.to_std || train.arrivalTime || '';

          results.push({
            mode: 'train',
            provider: `${trainName} (${trainNumber})`,
            pricePerPerson: perPerson,
            totalPrice: +(perPerson * passengers).toFixed(2),
            durationMinutes: dur || Math.round((dist / 80) * 60),
            departureTime: depTime,
            arrivalTime: arrTime,
            co2Kg: +(dist * 0.014).toFixed(1),
            source: 'irctc',
          });
        }

        console.log(`  🚆 IRCTC returned ${topTrains.length} trains`);
      } catch (trainErr: any) {
        const msg = trainErr.response?.data?.message || trainErr.message;
        console.error(`  🚆 IRCTC error: ${msg}`);
        errors.push(`Trains: ${msg}`);

        // Fallback: generate estimated trains
        pushEstimatedTrains(results, source, destination, passengers);
      }
    } else if (isDomestic) {
      // No station codes found — use estimates for domestic
      pushEstimatedTrains(results, source, destination, passengers);
      if (!fromStation || !toStation) {
        errors.push(`Trains: No station code for "${!fromStation ? source : destination}" — showing estimates`);
      }
    }

    // ─── Buses (estimated) — only for domestic routes ───
    if (isDomestic) {
      const buses = estimateBusOptions(source, destination, passengers);
      results.push(...buses);
    }

    // Safety net: ensure UI always has at least some flight options for comparison cards.
    if (!hasFlightOptions) {
      pushEstimatedFlights(results, source, destination, passengers, isDomestic);
      errors.push('Flights: Live flight data unavailable — showing estimated options');
    }

    // Return
    return res.json({
      options: results,
      source,
      destination,
      date,
      passengers,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('Transport search error:', err.message);
    return res.status(500).json({ error: 'Transport search failed', details: err.message });
  }
};

/* Fallback estimated trains */
function pushEstimatedTrains(arr: any[], source: string, dest: string, passengers: number) {
  const dist = estimateDistance(source, dest);
  const providers = ['Rajdhani Express', 'Shatabdi Express', 'Vande Bharat'];
  for (let i = 0; i < providers.length; i++) {
    const speed = 58 + i * 10;
    const dur = Math.round((dist / speed) * 60);
    const basePrice = +(250 + dist * (0.95 + i * 0.25)).toFixed(2);
    const dep = 5 + i * 4;
    arr.push({
      mode: 'train',
      provider: `${providers[i]} (est.)`,
      pricePerPerson: basePrice,
      totalPrice: +(basePrice * passengers).toFixed(2),
      durationMinutes: dur,
      departureTime: fmtTime(dep, 0),
      arrivalTime: fmtTime(dep, dur),
      co2Kg: +(dist * 0.014).toFixed(1),
      source: 'estimate',
    });
  }
}

/* ═══════════════════════════════════════════════════════
   CONTROLLER: GET /api/transport/iata?city=...
   Resolve a city name to IATA code (utility)
   ═══════════════════════════════════════════════════════ */
export const getIATACode = (req: Request, res: Response) => {
  const city = (req.query.city as string) || '';
  const code = resolveIATA(city);
  return res.json({ city, iata: code });
};
