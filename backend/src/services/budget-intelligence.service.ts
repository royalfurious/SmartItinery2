import axios from 'axios';

interface BudgetIntelligenceInput {
  source?: string;
  destination: string;
  startDate: string;
  endDate: string;
  passengers?: number;
}

interface BudgetRateDetail {
  perUnitInr: number;
  unit: 'night' | 'day';
  provider: string;
  confidence: 'high' | 'medium' | 'low';
  fallbackUsed: boolean;
}

interface BudgetIntelCacheEntry {
  value: BudgetIntelligenceResponse;
  expiresAt: number;
}

export interface BudgetIntelligenceResponse {
  destination: string;
  source?: string;
  currency: 'INR';
  generatedAt: string;
  cacheHit: boolean;
  cacheTtlSeconds: number;
  nights: number;
  passengers: number;
  accommodation: BudgetRateDetail;
  localTransport: BudgetRateDetail;
  factors: {
    usdToInr: number;
    daysUntilDeparture: number;
    seasonalityMultiplier: number;
    inflationMultiplier: number;
  };
  warnings?: string[];
}

interface TeleportCostSnapshot {
  accommodationUsdPerNight?: number;
  localTransportUsdPerDay?: number;
}

interface DestinationGeo {
  name: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
}

interface HotelLivePricesInput {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  adults?: number;
  hotelName?: string;
}

interface HotelOfferItem {
  hotelName: string;
  hotelId?: string;
  provider: string;
  roomType?: string;
  boardType?: string;
  refundable?: boolean;
  quotedNights: number;
  totalPriceInr: number;
  nightlyPriceInr: number;
  bookingComNightlyPriceInr?: number;
  currency: 'INR';
}

export interface HotelLivePricesResponse {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  cacheHit: boolean;
  cacheTtlSeconds: number;
  offers: HotelOfferItem[];
  warnings?: string[];
}

interface HotelLiveCacheEntry {
  value: HotelLivePricesResponse;
  expiresAt: number;
}

const AMADEUS_BASE = 'https://test.api.amadeus.com';
const BOOKING_RAPID_BASE = 'https://booking-com-api3.p.rapidapi.com';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const TELEPORT_SEARCH_URL = 'https://api.teleport.org/api/cities/';
const USD_RATE_URL = 'https://open.er-api.com/v6/latest/USD';

const AMADEUS_KEY = process.env.AMADEUS_API_KEY || '';
const AMADEUS_SECRET = process.env.AMADEUS_API_SECRET || '';
const BOOKING_RAPID_KEY = process.env.BOOKING_RAPIDAPI_KEY || process.env.RAPIDAPI_KEY || '';

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
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
  );

  amadeusToken = res.data.access_token;
  amadeusTokenExpiry = Date.now() + (Number(res.data.expires_in || 1800) - 60) * 1000;
  return amadeusToken;
}

export class BudgetIntelligenceService {
  private static readonly BASELINE_YEAR = 2024;
  private static readonly ANNUAL_INFLATION = 0.055;

  private readonly indiaKeywords = [
    'india', 'delhi', 'mumbai', 'bangalore', 'bengaluru', 'chennai', 'hyderabad', 'kolkata',
    'pune', 'goa', 'jaipur', 'kochi', 'avadi', 'himachal', 'shimla', 'kerala', 'karnataka',
    'tamil nadu', 'maharashtra', 'rajasthan', 'uttarakhand', 'gujarat', 'noida', 'gurgaon', 'gurugram',
  ];

  private cache = new Map<string, BudgetIntelCacheEntry>();
  private hotelPricesCache = new Map<string, HotelLiveCacheEntry>();
  private readonly cacheTtlSeconds = Number(process.env.BUDGET_INTEL_CACHE_TTL_SECONDS || 1800);
  private readonly hotelPricesCacheTtlSeconds = Number(process.env.HOTEL_LIVE_PRICES_CACHE_TTL_SECONDS || 900);

  async getLiveBudgetIntelligence(input: BudgetIntelligenceInput): Promise<BudgetIntelligenceResponse> {
    const normalized = this.normalizeInput(input);
    const cacheKey = this.makeCacheKey(normalized);

    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return {
        ...cached,
        generatedAt: new Date().toISOString(),
        cacheHit: true,
      };
    }

    const warnings: string[] = [];

    const [geo, usdToInr] = await Promise.all([
      this.geocodeDestination(normalized.destination).catch((err: any) => {
        warnings.push(`Geocode unavailable: ${err?.message || 'unknown error'}`);
        return { name: normalized.destination } as DestinationGeo;
      }),
      this.fetchUsdToInr().catch((err: any) => {
        warnings.push(`FX rate unavailable: ${err?.message || 'using fallback rate'}`);
        return 83;
      }),
    ]);

    const [teleportCosts, amadeusNightRateInr] = await Promise.all([
      this.fetchTeleportCostSnapshot(geo.name).catch((err: any) => {
        warnings.push(`Teleport cost snapshot unavailable: ${err?.message || 'unknown error'}`);
        return {} as TeleportCostSnapshot;
      }),
      this.fetchAmadeusHotelRateInInr(geo.name, normalized.startDate, normalized.endDate, normalized.passengers)
        .catch((err: any) => {
          warnings.push(`Amadeus hotel offers unavailable: ${err?.message || 'falling back'}`);
          return null;
        }),
    ]);

    const seasonalityMultiplier = this.getSeasonalityMultiplier(normalized.startDate);
    const inflationMultiplier = this.getInflationMultiplier();

    const accommodation = this.resolveAccommodationRate({
      amadeusNightRateInr,
      teleportCosts,
      usdToInr,
      isIndiaDestination: this.isLikelyIndiaDestination(geo.countryCode, normalized.destination),
      passengers: normalized.passengers,
      inflationMultiplier,
      seasonalityMultiplier,
    });

    const localTransport = this.resolveLocalTransportRate({
      teleportCosts,
      usdToInr,
      isIndiaDestination: this.isLikelyIndiaDestination(geo.countryCode, normalized.destination),
      passengers: normalized.passengers,
      inflationMultiplier,
      seasonalityMultiplier,
    });

    const response: BudgetIntelligenceResponse = {
      destination: geo.name || normalized.destination,
      source: normalized.source,
      currency: 'INR',
      generatedAt: new Date().toISOString(),
      cacheHit: false,
      cacheTtlSeconds: this.cacheTtlSeconds,
      nights: normalized.nights,
      passengers: normalized.passengers,
      accommodation,
      localTransport,
      factors: {
        usdToInr,
        daysUntilDeparture: normalized.daysUntilDeparture,
        seasonalityMultiplier,
        inflationMultiplier,
      },
      warnings: warnings.length ? warnings : undefined,
    };

    this.saveToCache(cacheKey, response);
    return response;
  }

  async getHotelLivePrices(input: HotelLivePricesInput): Promise<HotelLivePricesResponse> {
    const normalized = this.normalizeHotelLiveInput(input);
    const cacheKey = this.makeHotelLiveCacheKey(normalized);

    const cached = this.hotelPricesCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return {
        ...cached.value,
        cacheHit: true,
      };
    }

    if (!AMADEUS_KEY || !AMADEUS_SECRET) {
      throw new Error('Amadeus credentials missing for hotel live pricing');
    }

    const warnings: string[] = [...normalized.warnings];
    const nights = Math.max(1, this.calculateNights(new Date(normalized.checkInDate), new Date(normalized.checkOutDate)));
    const token = await getAmadeusToken();
    const geo = await this.geocodeDestination(normalized.destination).catch(() => ({ name: normalized.destination } as DestinationGeo));

    let hotels: any[] = [];
    const cityKeyword = this.buildCityKeyword(normalized.destination);

    if (cityKeyword) {
      try {
        const cityCodeRes = await axios.get(`${AMADEUS_BASE}/v1/reference-data/locations/cities`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { keyword: cityKeyword, max: 1 },
          timeout: 15000,
        });

        const cityCode = cityCodeRes.data?.data?.[0]?.iataCode;
        if (cityCode) {
          const hotelsRes = await axios.get(`${AMADEUS_BASE}/v1/reference-data/locations/hotels/by-city`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { cityCode },
            timeout: 15000,
          });
          hotels = (hotelsRes.data?.data || []) as any[];
        } else {
          warnings.push(`No IATA city code found for keyword "${cityKeyword}"`);
        }
      } catch (err: any) {
        warnings.push(`City lookup failed: ${this.getProviderErrorMessage(err)}`);
      }
    } else {
      warnings.push('City keyword could not be derived from destination');
    }

    if (!hotels.length && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
      const geoHotels = await this.fetchHotelsByGeo(token, Number(geo.lat), Number(geo.lon)).catch(() => [] as any[]);
      if (geoHotels.length) {
        warnings.push('Used nearby geo hotel catalog for better live coverage');
        hotels = geoHotels;
      }
    }

    const hotelCandidates = this.filterHotelsByName(hotels, normalized.hotelName).slice(0, 18);
    const hotelIds = hotelCandidates
      .map((h: any) => String(h?.hotelId || '').trim())
      .filter((id: string) => !!id);

    if (!hotelIds.length) {
      throw new Error(`No live hotel IDs matched for ${normalized.hotelName || normalized.destination}`);
    }

    const dateAttempts = this.buildDateAttempts(normalized.checkInDate, normalized.checkOutDate, 4);
    let offersData: any[] = [];
    let usedWindow = dateAttempts[0];

    for (const attempt of dateAttempts) {
      try {
        offersData = await this.fetchHotelOffersChunked(token, hotelIds, {
          adults: normalized.adults,
          checkInDate: attempt.checkInDate,
          checkOutDate: attempt.checkOutDate,
          roomQuantity: 1,
          bestRateOnly: false,
          currency: 'INR',
        });
        usedWindow = attempt;
        if (offersData.length > 0) break;
      } catch (err: any) {
        warnings.push(`Offer lookup failed for ${attempt.checkInDate}: ${this.getProviderErrorMessage(err)}`);
      }
    }

    // Last resort within live data: widen hotel pool to top city hotels when strict match has no offers.
    if (!offersData.length && hotelCandidates.length < hotels.length) {
      const widerHotelIds = hotels
        .map((h: any) => String(h?.hotelId || '').trim())
        .filter((id: string) => !!id)
        .slice(0, 30);

      if (widerHotelIds.length) {
        try {
          offersData = await this.fetchHotelOffersChunked(token, widerHotelIds, {
            adults: normalized.adults,
            checkInDate: usedWindow.checkInDate,
            checkOutDate: usedWindow.checkOutDate,
            roomQuantity: 1,
            bestRateOnly: false,
            currency: 'INR',
          });
          if (offersData.length) {
            warnings.push('Expanded search to nearby hotels to retrieve live offers');
          }
        } catch (err: any) {
          warnings.push(`Expanded offer lookup failed: ${this.getProviderErrorMessage(err)}`);
        }
      }
    }

    const offerNights = Math.max(1, this.calculateNights(new Date(usedWindow.checkInDate), new Date(usedWindow.checkOutDate)));
    const offers = this.mapHotelOffers(offersData, offerNights).slice(0, 20);

    // Optional Booking.com live enrichment via RapidAPI (if key configured).
    const bookingNightly = await this.fetchBookingComNightlyRateInr({
      destination: normalized.destination,
      checkInDate: usedWindow.checkInDate,
      checkOutDate: usedWindow.checkOutDate,
      adults: normalized.adults,
      hotelName: normalized.hotelName,
    }).catch((err: any) => {
      warnings.push(`Booking.com live pricing unavailable: ${this.getProviderErrorMessage(err)}`);
      return null;
    });

    if (bookingNightly && bookingNightly > 0) {
      for (const offer of offers) {
        offer.bookingComNightlyPriceInr = +bookingNightly.toFixed(2);
      }
    }
    if (!offers.length) {
      warnings.push('No priced offers returned for selected dates');
    }

    if (usedWindow.checkInDate !== normalized.checkInDate || usedWindow.checkOutDate !== normalized.checkOutDate) {
      warnings.push(`Offers shown for nearest available window: ${usedWindow.checkInDate} to ${usedWindow.checkOutDate}`);
    }

    const response: HotelLivePricesResponse = {
      destination: normalized.destination,
      checkInDate: usedWindow.checkInDate,
      checkOutDate: usedWindow.checkOutDate,
      adults: normalized.adults,
      cacheHit: false,
      cacheTtlSeconds: this.hotelPricesCacheTtlSeconds,
      offers,
      warnings: warnings.length ? warnings : undefined,
    };

    this.hotelPricesCache.set(cacheKey, {
      value: response,
      expiresAt: Date.now() + this.hotelPricesCacheTtlSeconds * 1000,
    });

    return response;
  }

  private normalizeHotelLiveInput(input: HotelLivePricesInput) {
    const destination = (input.destination || '').trim();
    const hotelName = (input.hotelName || '').trim() || undefined;
    let checkIn = this.normalizeDate(input.checkInDate);
    let checkOut = this.normalizeDate(input.checkOutDate);
    const warnings: string[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (checkIn.getTime() < today.getTime()) {
      const original = this.toIsoDate(checkIn);
      checkIn = new Date(today);
      warnings.push(`Check-in ${original} was in the past; moved to ${this.toIsoDate(checkIn)}`);
    }

    if (checkOut.getTime() <= checkIn.getTime()) {
      checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + 1);
      warnings.push(`Check-out adjusted to ${this.toIsoDate(checkOut)} to keep at least 1 night`);
    }

    const checkInDate = this.toIsoDate(checkIn);
    const checkOutDate = this.toIsoDate(checkOut);
    const adults = Math.max(1, Math.floor(Number(input.adults) || 1));

    return {
      destination,
      hotelName,
      checkInDate,
      checkOutDate,
      adults,
      warnings,
    };
  }

  private async fetchHotelsByGeo(token: string, lat: number, lon: number): Promise<any[]> {
    const res = await axios.get(`${AMADEUS_BASE}/v1/reference-data/locations/hotels/by-geocode`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        latitude: lat,
        longitude: lon,
        radius: 25,
      },
      timeout: 15000,
    });

    return (res.data?.data || []) as any[];
  }

  private buildDateAttempts(checkInDate: string, checkOutDate: string, maxAttempts: number): Array<{ checkInDate: string; checkOutDate: string }> {
    const checkIn = this.normalizeDate(checkInDate);
    const checkOut = this.normalizeDate(checkOutDate);
    const nights = Math.max(1, this.calculateNights(checkIn, checkOut));

    const attempts: Array<{ checkInDate: string; checkOutDate: string }> = [];
    for (let i = 0; i < maxAttempts; i++) {
      const ci = new Date(checkIn);
      ci.setDate(ci.getDate() + i);
      const co = new Date(ci);
      co.setDate(co.getDate() + nights);
      attempts.push({
        checkInDate: this.toIsoDate(ci),
        checkOutDate: this.toIsoDate(co),
      });
    }
    return attempts;
  }

  private buildCityKeyword(destination: string): string {
    const source = String(destination || '').trim();
    if (!source) return '';

    // Prefer the first comma-separated component (usually the city name).
    const firstPart = source.split(',')[0]?.trim() || source;
    const clean = firstPart
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-zA-Z\s\-']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return clean;
  }

  private async fetchHotelOffersChunked(
    token: string,
    hotelIds: string[],
    baseParams: {
      adults: number;
      checkInDate: string;
      checkOutDate: string;
      roomQuantity: number;
      bestRateOnly: boolean;
      currency: 'INR';
    }
  ): Promise<any[]> {
    // Amadeus hotel-offers often rejects very long hotelIds lists with 400.
    const chunkSize = 5;
    const allData: any[] = [];

    for (let i = 0; i < hotelIds.length; i += chunkSize) {
      const chunk = hotelIds.slice(i, i + chunkSize);
      try {
        const offersRes = await axios.get(`${AMADEUS_BASE}/v3/shopping/hotel-offers`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            hotelIds: chunk.join(','),
            ...baseParams,
          },
          timeout: 22000,
        });

        const data = offersRes.data?.data || [];
        if (Array.isArray(data) && data.length) {
          allData.push(...data);
        }
      } catch (err: any) {
        // Keep querying other chunks; fail only if all chunks fail upstream.
        const msg = this.getProviderErrorMessage(err);
        if (i === 0 && hotelIds.length <= chunkSize) {
          throw new Error(msg);
        }
      }
    }

    return allData;
  }

  private getProviderErrorMessage(err: any): string {
    const apiDetail = err?.response?.data?.errors?.[0]?.detail;
    const apiTitle = err?.response?.data?.errors?.[0]?.title;
    const apiMessage = err?.response?.data?.message;
    const status = err?.response?.status;
    if (apiDetail) return String(apiDetail);
    if (apiTitle) return String(apiTitle);
    if (apiMessage) return String(apiMessage);
    if (status) return `Provider request failed with status ${status}`;
    return err?.message || 'Unknown provider error';
  }

  private async fetchBookingComNightlyRateInr(input: {
    destination: string;
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    hotelName?: string;
  }): Promise<number | null> {
    if (!BOOKING_RAPID_KEY) {
      throw new Error('BOOKING_RAPIDAPI_KEY not configured');
    }

    const destination = input.destination.trim();
    if (!destination) return null;

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-rapidapi-host': 'booking-com-api3.p.rapidapi.com',
      'x-rapidapi-key': BOOKING_RAPID_KEY,
    };

    // API variants differ across RapidAPI providers; try conservative parameter sets.
    const candidates: Array<Record<string, string>> = [
      {
        order_by: 'ranking',
        user_platform: 'desktop',
        language: 'en',
        rows: '20',
        guest_country: 'IN',
        checkin_date: input.checkInDate,
        checkout_date: input.checkOutDate,
        adults_number: String(Math.max(1, input.adults)),
        room_number: '1',
        units: 'metric',
        currency: 'INR',
        filter_by_currency: 'INR',
        name: destination,
      },
      {
        order_by: 'ranking',
        user_platform: 'desktop',
        language: 'en',
        rows: '20',
        guest_country: 'IN',
        checkin_date: input.checkInDate,
        checkout_date: input.checkOutDate,
        adults_number: String(Math.max(1, input.adults)),
        room_number: '1',
        currency: 'INR',
        city_name: destination,
      },
    ];

    let lastError: any = null;
    for (const params of candidates) {
      try {
        const res = await axios.get(`${BOOKING_RAPID_BASE}/booking/hotelAvailability`, {
          headers,
          params,
          timeout: 18000,
        });

        const nightly = this.extractBookingNightlyRateInr(res.data, input.hotelName);
        if (nightly && nightly > 0) return nightly;
      } catch (err: any) {
        lastError = err;
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  private extractBookingNightlyRateInr(payload: any, hotelName?: string): number | null {
    const rows: any[] = [];

    const pushRows = (arr: any) => {
      if (Array.isArray(arr)) rows.push(...arr);
    };

    pushRows(payload?.data);
    pushRows(payload?.result);
    pushRows(payload?.results);
    pushRows(payload?.hotels);
    pushRows(payload?.hotel_data);

    if (!rows.length && Array.isArray(payload)) {
      rows.push(...payload);
    }

    if (!rows.length) return null;

    const normalizedTarget = this.normalizeHotelNameToken(hotelName || '');

    const scored = rows
      .map((row) => {
        const name = String(
          row?.hotel_name || row?.name || row?.property_name || row?.hotelName || ''
        ).trim();
        const nightly = this.extractBookingNightlyFromRow(row);
        if (!nightly || nightly <= 0) return null;

        const normalizedName = this.normalizeHotelNameToken(name);
        let score = 0;
        if (normalizedTarget && normalizedName === normalizedTarget) score += 100;
        if (normalizedTarget && normalizedName.includes(normalizedTarget)) score += 60;
        if (normalizedTarget && normalizedTarget.includes(normalizedName)) score += 30;
        if (!normalizedTarget) score = 1;

        return { score, nightly };
      })
      .filter((x): x is { score: number; nightly: number } => !!x)
      .sort((a, b) => b.score - a.score || a.nightly - b.nightly);

    if (!scored.length) return null;
    return scored[0].nightly;
  }

  private extractBookingNightlyFromRow(row: any): number | null {
    const asNumber = (value: any): number | null => {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
      return null;
    };

    const parseText = (value: any): number | null => {
      const s = String(value || '').replace(/,/g, '');
      const m = s.match(/\d+(\.\d+)?/);
      if (!m) return null;
      const n = Number(m[0]);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const candidates = [
      asNumber(row?.price_breakdown?.gross_price_per_night?.value),
      asNumber(row?.price_breakdown?.all_inclusive_price_per_night?.value),
      asNumber(row?.composite_price_breakdown?.all_inclusive_amount?.value),
      asNumber(row?.min_total_price),
      asNumber(row?.price),
      asNumber(row?.hotel_price),
      parseText(row?.price_breakdown?.gross_price_per_night?.currency),
      parseText(row?.price_display),
      parseText(row?.price_text),
    ];

    for (const c of candidates) {
      if (c && c > 0) return c;
    }
    return null;
  }

  private normalizeHotelNameToken(name: string): string {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private makeHotelLiveCacheKey(input: {
    destination: string;
    hotelName?: string;
    checkInDate: string;
    checkOutDate: string;
    adults: number;
  }): string {
    return JSON.stringify({
      destination: input.destination.toLowerCase(),
      hotelName: (input.hotelName || '').toLowerCase(),
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      adults: input.adults,
    });
  }

  private filterHotelsByName(hotels: any[], hotelName?: string): any[] {
    if (!hotelName) return hotels;
    const target = hotelName.toLowerCase().trim();
    const tokens = target.split(/\s+/).filter(Boolean);

    const scored = hotels
      .map((h: any) => {
        const name = String(h?.name || '').toLowerCase();
        let score = 0;
        if (name === target) score += 100;
        if (name.includes(target)) score += 60;
        for (const token of tokens) {
          if (name.includes(token)) score += 10;
        }
        return { h, score };
      })
      .filter((x: any) => x.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .map((x: any) => x.h);

    return scored.length ? scored : hotels;
  }

  private mapHotelOffers(data: any[], nights: number): HotelOfferItem[] {
    const grouped = new Map<string, HotelOfferItem>();

    for (const h of data) {
      const hotelName = String(h?.hotel?.name || h?.hotel?.hotelName || 'Hotel').trim();
      const hotelId = String(h?.hotel?.hotelId || '').trim() || undefined;
      const offers = Array.isArray(h?.offers) ? h.offers : [];

      for (const offer of offers) {
        const total = Number(offer?.price?.total);
        if (!Number.isFinite(total) || total <= 0) continue;

        const item: HotelOfferItem = {
          quotedNights: Math.max(1, nights),
          hotelName,
          hotelId,
          provider: 'Amadeus',
          roomType: offer?.room?.typeEstimated?.category || offer?.room?.description?.text || undefined,
          boardType: offer?.boardType || undefined,
          refundable: offer?.policies?.cancellation ? true : undefined,
          totalPriceInr: +this.resolveTotalPrice(offer, total).toFixed(2),
          nightlyPriceInr: +this.resolveNightlyPrice(offer, total, Math.max(1, nights)).toFixed(2),
          currency: 'INR',
        };

        // Canonical grouping: keep only the best (lowest) rate for each room/board at a hotel.
        const dedupeKey = [
          String(item.hotelId || item.hotelName).toLowerCase().trim(),
          String(item.roomType || 'room').toLowerCase().replace(/[^a-z0-9]/g, ''),
          String(item.boardType || 'board').toLowerCase().replace(/[^a-z0-9]/g, ''),
        ].join('|');

        const existing = grouped.get(dedupeKey);
        if (!existing || item.nightlyPriceInr < existing.nightlyPriceInr) {
          grouped.set(dedupeKey, item);
        }
      }
    }

    return [...grouped.values()].sort((a, b) => a.nightlyPriceInr - b.nightlyPriceInr);
  }

  private resolveTotalPrice(offer: any, fallbackTotal: number): number {
    const total = Number(offer?.price?.total);
    if (Number.isFinite(total) && total > 0) return total;

    const base = Number(offer?.price?.base);
    const tax = Number(offer?.price?.variations?.average?.taxes?.[0]?.amount);
    if (Number.isFinite(base) && base > 0) {
      if (Number.isFinite(tax) && tax >= 0) return base + tax;
      return base;
    }

    return fallbackTotal;
  }

  private resolveNightlyPrice(offer: any, fallbackTotal: number, nights: number): number {
    const nightlyVariation = Number(offer?.price?.variations?.average?.total);
    if (Number.isFinite(nightlyVariation) && nightlyVariation > 0) {
      return nightlyVariation;
    }

    const total = this.resolveTotalPrice(offer, fallbackTotal);
    return total / Math.max(1, nights);
  }

  private normalizeInput(input: BudgetIntelligenceInput) {
    const destination = (input.destination || '').trim();
    const source = (input.source || '').trim() || undefined;
    const startDate = this.normalizeDate(input.startDate);
    const endDate = this.normalizeDate(input.endDate);
    const passengers = Math.max(1, Math.floor(Number(input.passengers) || 1));

    const nights = Math.max(1, this.calculateNights(startDate, endDate));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysUntilDeparture = Math.max(0, Math.ceil((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

    return {
      destination,
      source,
      startDate: this.toIsoDate(startDate),
      endDate: this.toIsoDate(endDate),
      passengers,
      nights,
      daysUntilDeparture,
    };
  }

  private normalizeDate(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid date: ${value}`);
    }
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  private toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private calculateNights(startDate: Date, endDate: Date): number {
    const diff = endDate.getTime() - startDate.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  private makeCacheKey(input: {
    destination: string;
    source?: string;
    startDate: string;
    endDate: string;
    passengers: number;
  }): string {
    return JSON.stringify({
      source: (input.source || '').toLowerCase(),
      destination: input.destination.toLowerCase(),
      startDate: input.startDate,
      endDate: input.endDate,
      passengers: input.passengers,
    });
  }

  private getFromCache(key: string): BudgetIntelligenceResponse | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() >= hit.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return hit.value;
  }

  private saveToCache(key: string, value: BudgetIntelligenceResponse): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTtlSeconds * 1000,
    });
  }

  private async geocodeDestination(destination: string): Promise<DestinationGeo> {
    const response = await axios.get(GEOCODE_URL, {
      params: {
        name: destination,
        count: 1,
        language: 'en',
        format: 'json',
      },
      timeout: 10000,
    });

    const item = response.data?.results?.[0];
    if (!item) {
      return { name: destination };
    }

    return {
      name: String(item.name || destination),
      countryCode: item.country_code ? String(item.country_code).toUpperCase() : undefined,
      lat: Number.isFinite(Number(item.latitude)) ? Number(item.latitude) : undefined,
      lon: Number.isFinite(Number(item.longitude)) ? Number(item.longitude) : undefined,
    };
  }

  private async fetchUsdToInr(): Promise<number> {
    const response = await axios.get(USD_RATE_URL, { timeout: 10000 });
    const inr = Number(response.data?.rates?.INR);
    if (!Number.isFinite(inr) || inr <= 0) {
      throw new Error('USD->INR rate missing from provider');
    }
    return inr;
  }

  private async fetchTeleportCostSnapshot(city: string): Promise<TeleportCostSnapshot> {
    const searchRes = await axios.get(TELEPORT_SEARCH_URL, {
      params: { search: city, limit: 1 },
      timeout: 12000,
    });

    const result = searchRes.data?._embedded?.['city:search-results']?.[0];
    const cityHref = result?._links?.['city:item']?.href;
    if (!cityHref) return {};

    const cityRes = await axios.get(cityHref, { timeout: 12000 });
    const urbanHref = cityRes.data?._links?.['city:urban_area']?.href;
    if (!urbanHref) return {};

    const detailsRes = await axios.get(`${urbanHref}details/`, { timeout: 12000 });
    const categories = detailsRes.data?.categories;
    if (!Array.isArray(categories)) return {};

    const values: Array<{ id: string; value: number }> = [];

    for (const category of categories) {
      const data = Array.isArray(category?.data) ? category.data : [];
      for (const item of data) {
        const id = String(item?.id || '').toUpperCase();
        const value = this.extractNumericValue(item);
        if (!id || !Number.isFinite(value) || value <= 0) continue;
        values.push({ id, value });
      }
    }

    const accommodationCandidates = values
      .filter((v) => /APARTMENT|HOTEL|RENT/i.test(v.id))
      .map((v) => v.value);

    const localTransportCandidates = values
      .filter((v) => /PUBLIC-TRANSPORT|TRANSPORT|TAXI|BUS|METRO/i.test(v.id))
      .map((v) => v.value);

    return {
      accommodationUsdPerNight: this.median(accommodationCandidates),
      localTransportUsdPerDay: this.median(localTransportCandidates),
    };
  }

  private extractNumericValue(item: any): number {
    const candidates = [
      Number(item?.currency_dollar_value),
      Number(item?.usd_dollar_value),
      Number(item?.float_value),
      this.parseTextNumber(String(item?.value || '')),
    ];

    for (const value of candidates) {
      if (Number.isFinite(value) && value > 0) return value;
    }
    return NaN;
  }

  private parseTextNumber(text: string): number {
    if (!text) return NaN;
    const match = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }

  private async fetchAmadeusHotelRateInInr(
    destination: string,
    startDate: string,
    endDate: string,
    passengers: number
  ): Promise<number | null> {
    if (!AMADEUS_KEY || !AMADEUS_SECRET) {
      throw new Error('Amadeus credentials missing');
    }

    const token = await getAmadeusToken();

    const cityCodeRes = await axios.get(`${AMADEUS_BASE}/v1/reference-data/locations/cities`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { keyword: destination, max: 1 },
      timeout: 15000,
    });

    const cityCode = cityCodeRes.data?.data?.[0]?.iataCode;
    if (!cityCode) {
      throw new Error(`No IATA city code found for ${destination}`);
    }

    const hotelsRes = await axios.get(`${AMADEUS_BASE}/v1/reference-data/locations/hotels/by-city`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { cityCode },
      timeout: 15000,
    });

    const hotelIds = (hotelsRes.data?.data || [])
      .map((h: any) => String(h?.hotelId || '').trim())
      .filter((id: string) => !!id)
      .slice(0, 8);

    if (hotelIds.length === 0) {
      throw new Error(`No hotels found for cityCode ${cityCode}`);
    }

    const offersRes = await axios.get(`${AMADEUS_BASE}/v3/shopping/hotel-offers`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        hotelIds: hotelIds.join(','),
        adults: passengers,
        checkInDate: startDate,
        checkOutDate: endDate,
        roomQuantity: 1,
        bestRateOnly: true,
        currency: 'INR',
      },
      timeout: 20000,
    });

    const offerTotals: number[] = [];
    for (const hotel of offersRes.data?.data || []) {
      const offer = hotel?.offers?.[0];
      const total = Number(offer?.price?.total);
      if (Number.isFinite(total) && total > 0) offerTotals.push(total);
    }

    if (!offerTotals.length) {
      throw new Error('No priced hotel offers received');
    }

    const medianStayTotal = this.median(offerTotals);
    if (!medianStayTotal) return null;

    const nights = Math.max(1, this.calculateNights(new Date(startDate), new Date(endDate)));
    return +(medianStayTotal / nights).toFixed(2);
  }

  private resolveAccommodationRate(input: {
    amadeusNightRateInr: number | null;
    teleportCosts: TeleportCostSnapshot;
    usdToInr: number;
    isIndiaDestination: boolean;
    passengers: number;
    inflationMultiplier: number;
    seasonalityMultiplier: number;
  }): BudgetRateDetail {
    if (input.amadeusNightRateInr && input.amadeusNightRateInr > 0) {
      return {
        perUnitInr: +input.amadeusNightRateInr.toFixed(2),
        unit: 'night',
        provider: 'amadeus-hotel-offers',
        confidence: 'high',
        fallbackUsed: false,
      };
    }

    if (input.teleportCosts.accommodationUsdPerNight && input.teleportCosts.accommodationUsdPerNight > 0) {
      return {
        perUnitInr: +(input.teleportCosts.accommodationUsdPerNight * input.usdToInr).toFixed(2),
        unit: 'night',
        provider: 'teleport-cost-of-living',
        confidence: 'medium',
        fallbackUsed: true,
      };
    }

    const base = input.isIndiaDestination ? 2600 : 7800;
    const adjusted = base * input.inflationMultiplier * input.seasonalityMultiplier * (0.95 + Math.min(0.25, input.passengers * 0.03));

    return {
      perUnitInr: +adjusted.toFixed(2),
      unit: 'night',
      provider: 'heuristic-fallback',
      confidence: 'low',
      fallbackUsed: true,
    };
  }

  private resolveLocalTransportRate(input: {
    teleportCosts: TeleportCostSnapshot;
    usdToInr: number;
    isIndiaDestination: boolean;
    passengers: number;
    inflationMultiplier: number;
    seasonalityMultiplier: number;
  }): BudgetRateDetail {
    if (input.teleportCosts.localTransportUsdPerDay && input.teleportCosts.localTransportUsdPerDay > 0) {
      return {
        perUnitInr: +(input.teleportCosts.localTransportUsdPerDay * input.usdToInr).toFixed(2),
        unit: 'day',
        provider: 'teleport-cost-of-living',
        confidence: 'medium',
        fallbackUsed: false,
      };
    }

    const base = input.isIndiaDestination ? 600 : 1700;
    const adjusted = base * input.inflationMultiplier * (0.97 + (input.seasonalityMultiplier - 1) * 0.35) * (1 + Math.min(0.15, input.passengers * 0.02));

    return {
      perUnitInr: +adjusted.toFixed(2),
      unit: 'day',
      provider: 'heuristic-fallback',
      confidence: 'low',
      fallbackUsed: true,
    };
  }

  private median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private isLikelyIndiaDestination(countryCode: string | undefined, destination: string): boolean {
    if (countryCode === 'IN') return true;
    const d = (destination || '').toLowerCase();
    return this.indiaKeywords.some((k: string) => d.includes(k));
  }

  private getSeasonalityMultiplier(startDate: string): number {
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) return 1;

    const m = d.getMonth() + 1;
    if ([12, 1, 5, 6].includes(m)) return 1.12;
    if ([3, 4, 10, 11].includes(m)) return 1.06;
    if ([7, 8, 9].includes(m)) return 0.94;
    return 1.0;
  }

  private getInflationMultiplier(): number {
    const now = new Date();
    const yearDelta = now.getFullYear() - BudgetIntelligenceService.BASELINE_YEAR;
    const monthShare = now.getMonth() / 12;
    const periods = Math.max(0, yearDelta + monthShare);
    return +(Math.pow(1 + BudgetIntelligenceService.ANNUAL_INFLATION, periods)).toFixed(3);
  }
}

export const budgetIntelligenceService = new BudgetIntelligenceService();
