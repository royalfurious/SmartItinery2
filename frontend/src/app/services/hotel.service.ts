import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, forkJoin } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { CityService } from './city.service';
import { environment } from '../../environments/environment';

export interface Hotel {
  name: string;
  address: string;
  rating?: number;
  stars?: number;
  phone?: string;
  website?: string;
  lat: number;
  lon: number;
  categories: string[];
  distance?: number; // meters from center
  image?: string;
  placeId?: string;
  wikipedia?: string;
  imageUrl?: string;   // resolved photo URL (image > wikipedia > null)
}

export interface GeoapifyPlace {
  properties: {
    name?: string;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    categories?: string[];
    datasource?: {
      raw?: {
        stars?: number;
        rating?: number;
        phone?: string;
        website?: string;
        image?: string;
        'contact:phone'?: string;
        'contact:website'?: string;
      };
    };
    distance?: number;
    lat: number;
    lon: number;
    city?: string;
    country?: string;
    place_id?: string;
  };
}

export interface GeoapifyResponse {
  features: GeoapifyPlace[];
}

@Injectable({
  providedIn: 'root'
})
export class HotelService {
  private apiKey = (environment as { geoapifyKey?: string }).geoapifyKey ?? '';
  private apiUrl = 'https://api.geoapify.com/v2/places';
  private geocodeCache = new Map<string, [number, number]>();
  private placesCache = new Map<string, Hotel[]>();

  private hasGeoapifyKey(): boolean {
    const key = (this.apiKey || '').trim();
    return !!key && key !== 'YOUR_GEOAPIFY_KEY_HERE';
  }

  constructor(
    private http: HttpClient,
    private cityService: CityService
  ) {}

  /**
   * Search hotels near a destination by name.
   * Uses Geoapify's own geocoding to avoid dependency on Mapbox token.
   */
  searchHotels(destination: string, limit: number = 20): Observable<Hotel[]> {
    const cacheKey = `hotels|${destination.toLowerCase().trim()}|${limit}`;
    const cached = this.placesCache.get(cacheKey);
    if (cached) return of(cached);

    if (!this.hasGeoapifyKey()) {
      return this.searchOpenDataPlaces(destination, 'hotels', limit).pipe(
        map(results => {
          this.placesCache.set(cacheKey, results);
          return results;
        })
      );
    }

    return this.geocodeWithGeoapify(destination).pipe(
      switchMap(coords => {
        if (!coords) {
          // Fallback to CityService (Mapbox) geocoding
          return this.cityService.getCoordinates(destination).pipe(
            switchMap(mbCoords => {
              if (!mbCoords) {
                console.warn('Could not geocode destination:', destination);
                return of([]);
              }
              const [lon, lat] = mbCoords;
              return this.searchHotelsByCoordinates(lat, lon, limit);
            })
          );
        }
        const [lat, lon] = coords;
        return this.searchHotelsByCoordinates(lat, lon, limit).pipe(
          map(results => {
            this.placesCache.set(cacheKey, results);
            return results;
          })
        );
      }),
      catchError(error => {
        console.error('Hotel search error:', error);
        return of([]);
      })
    );
  }

  /**
   * Geocode destination using Geoapify Geocoding API (no Mapbox dependency).
   * Returns [lat, lon] or null.
   */
  private geocodeWithGeoapify(query: string): Observable<[number, number] | null> {
    const cacheKey = query.toLowerCase().trim();
    const cached = this.geocodeCache.get(cacheKey);
    if (cached) return of(cached);

    const url = 'https://api.geoapify.com/v1/geocode/search';
    return this.http.get<any>(url, {
      params: {
        text: query,
        limit: '1',
        apiKey: this.apiKey
      }
    }).pipe(
      map(response => {
        if (response?.results?.length > 0) {
          const r = response.results[0];
          const coords = [r.lat, r.lon] as [number, number];
          this.geocodeCache.set(cacheKey, coords);
          return coords;
        }
        if (response?.features?.length > 0) {
          const props = response.features[0].properties;
          const coords = [props.lat, props.lon] as [number, number];
          this.geocodeCache.set(cacheKey, coords);
          return coords;
        }
        return null;
      }),
      catchError(() => of(null))
    );
  }

  /**
   * Search hotels by coordinates using Geoapify Places API.
   * Uses a circular filter (10km radius) centered on the coordinates.
   */
  searchHotelsByCoordinates(lat: number, lon: number, limit: number = 20): Observable<Hotel[]> {
    const params = {
      categories: 'accommodation.hotel,accommodation.guest_house,accommodation.hostel,accommodation.motel',
      filter: `circle:${lon},${lat},10000`, // 10km radius
      bias: `proximity:${lon},${lat}`,
      limit: limit.toString(),
      apiKey: this.apiKey
    };

    return this.http.get<GeoapifyResponse>(this.apiUrl, { params }).pipe(
      map(response => this.mapResponseToHotels(response)),
      catchError(error => {
        console.error('Geoapify API error:', error);
        return of([]);
      })
    );
  }

  /**
   * Search places by category (restaurants, supermarkets, attractions, etc.)
   */
  searchNearbyPlaces(destination: string, category: string, limit: number = 20): Observable<Hotel[]> {
    const categoryKey = this.mapCategoryForOpenData(category);
    const cacheKey = `nearby|${destination.toLowerCase().trim()}|${categoryKey}|${limit}`;
    const cached = this.placesCache.get(cacheKey);
    if (cached) return of(cached);

    if (!this.hasGeoapifyKey()) {
      return this.searchOpenDataPlaces(destination, category, limit).pipe(
        map(results => {
          this.placesCache.set(cacheKey, results);
          return results;
        })
      );
    }

    return this.geocodeWithGeoapify(destination).pipe(
      switchMap(coords => {
        if (!coords) {
          // Fallback to CityService (Mapbox) geocoding
          return this.cityService.getCoordinates(destination).pipe(
            switchMap(mbCoords => {
              if (!mbCoords) return of([]);
              const [lon, lat] = mbCoords;
              return this.fetchPlaces(lat, lon, category, limit);
            })
          );
        }
        const [lat, lon] = coords;
        return this.fetchPlaces(lat, lon, category, limit).pipe(
          map(results => {
            this.placesCache.set(cacheKey, results);
            return results;
          })
        );
      }),
      catchError(error => {
        console.error('Nearby places search error:', error);
        return of([]);
      })
    );
  }

  private fetchPlaces(lat: number, lon: number, category: string, limit: number): Observable<Hotel[]> {
    const params = {
      categories: category,
      filter: `circle:${lon},${lat},10000`,
      bias: `proximity:${lon},${lat}`,
      limit: limit.toString(),
      apiKey: this.apiKey
    };

    return this.http.get<GeoapifyResponse>(this.apiUrl, { params }).pipe(
      map(response => this.mapResponseToHotels(response)),
      catchError(error => {
        console.error('Geoapify places API error:', error);
        return of([]);
      })
    );
  }

  private searchOpenDataPlaces(destination: string, category: string, limit: number): Observable<Hotel[]> {
    const categoryKey = this.mapCategoryForOpenData(category);

    // Fast path first: text search with Nominatim (usually much faster than Overpass).
    return this.searchNominatimPlaces(destination, categoryKey, limit).pipe(
      switchMap(quickResults => {
        if (quickResults.length >= Math.min(8, limit)) {
          return of(quickResults);
        }

        // Fallback path: geocode + Overpass for richer nearby results.
        return this.geocodeWithNominatim(destination).pipe(
          switchMap(coords => {
            if (!coords) return of(quickResults);
            const [lat, lon] = coords;
            return this.fetchOverpassPlaces(lat, lon, categoryKey, limit).pipe(
              map(overpassResults => {
                const merged = [...quickResults, ...overpassResults];
                const dedup = new Map<string, Hotel>();
                for (const item of merged) {
                  const key = `${item.name.toLowerCase()}_${item.lat.toFixed(4)}_${item.lon.toFixed(4)}`;
                  if (!dedup.has(key)) dedup.set(key, item);
                }
                return [...dedup.values()].slice(0, limit);
              })
            );
          })
        );
      }),
      catchError(error => {
        console.error('Open data places search error:', error);
        return of([]);
      })
    );
  }

  private searchNominatimPlaces(destination: string, category: string, limit: number): Observable<Hotel[]> {
    const queryByCategory: Record<string, string> = {
      hotels: 'hotel guest house hostel',
      restaurants: 'restaurant food',
      cafes: 'cafe coffee',
      attractions: 'tourist attraction museum sightseeing',
      shopping: 'shopping mall market'
    };
    const q = `${queryByCategory[category] || queryByCategory['hotels']} in ${destination}`;

    return this.http.get<any[]>('https://nominatim.openstreetmap.org/search', {
      params: {
        q,
        format: 'json',
        addressdetails: '1',
        limit: String(limit),
      }
    }).pipe(
      map(response => {
        if (!Array.isArray(response)) return [];
        return response
          .map((item: any) => {
            const lat = Number(item.lat);
            const lon = Number(item.lon);
            if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

            const displayName = String(item.display_name || '').trim();
            const shortName = String(item.name || displayName.split(',')[0] || 'Place').trim();
            return {
              name: shortName,
              address: displayName,
              lat,
              lon,
              categories: [category],
              stars: undefined,
              rating: undefined,
            } as Hotel;
          })
          .filter((h: Hotel | null): h is Hotel => !!h);
      }),
      catchError(() => of([]))
    );
  }

  private mapCategoryForOpenData(category: string): string {
    const value = (category || '').toLowerCase();
    if (value.includes('restaurant')) return 'restaurants';
    if (value.includes('cafe')) return 'cafes';
    if (value.includes('attraction') || value.includes('sights')) return 'attractions';
    if (value.includes('shopping') || value.includes('supermarket')) return 'shopping';
    return 'hotels';
  }

  private geocodeWithNominatim(query: string): Observable<[number, number] | null> {
    const cacheKey = `nom:${query.toLowerCase().trim()}`;
    const cached = this.geocodeCache.get(cacheKey);
    if (cached) return of(cached);

    return this.http.get<any[]>('https://nominatim.openstreetmap.org/search', {
      params: {
        q: query,
        format: 'json',
        limit: '1'
      }
    }).pipe(
      map(response => {
        if (!Array.isArray(response) || response.length === 0) return null;
        const item = response[0];
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
        const coords = [lat, lon] as [number, number];
        this.geocodeCache.set(cacheKey, coords);
        return coords;
      }),
      catchError(() => of(null))
    );
  }

  private fetchOverpassPlaces(lat: number, lon: number, category: string, limit: number): Observable<Hotel[]> {
    const radius = 6000;
    const queryByCategory: Record<string, string> = {
      hotels: '["tourism"~"hotel|guest_house|hostel|motel|apartment"]',
      restaurants: '["amenity"="restaurant"]',
      cafes: '["amenity"="cafe"]',
      attractions: '["tourism"~"attraction|museum|gallery|theme_park|viewpoint"]',
      shopping: '["shop"]'
    };

    const selector = queryByCategory[category] || queryByCategory['hotels'];
    const overpassQuery = `
[out:json][timeout:12];
(
  node${selector}(around:${radius},${lat},${lon});
  way${selector}(around:${radius},${lat},${lon});
);
out center ${Math.max(5, limit)};
`;

    return this.http.get<any>('https://overpass-api.de/api/interpreter', {
      params: { data: overpassQuery }
    }).pipe(
      map(response => this.mapOverpassToHotels(response, lat, lon, category, limit)),
      catchError(error => {
        console.error('Overpass API error:', error);
        return of([]);
      })
    );
  }

  private mapOverpassToHotels(response: any, originLat: number, originLon: number, category: string, limit: number): Hotel[] {
    const elements = Array.isArray(response?.elements) ? response.elements : [];
    const unique = new Set<string>();
    const places: Hotel[] = [];

    for (const el of elements) {
      const tags = el.tags || {};
      const name = (tags.name || '').trim();
      const lat = Number(el.lat ?? el.center?.lat);
      const lon = Number(el.lon ?? el.center?.lon);

      if (!name || Number.isNaN(lat) || Number.isNaN(lon)) continue;

      const key = `${name.toLowerCase()}_${lat.toFixed(4)}_${lon.toFixed(4)}`;
      if (unique.has(key)) continue;
      unique.add(key);

      const stars = Number(tags.stars);
      const address = [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:city'],
        tags['addr:country']
      ].filter(Boolean).join(', ');

      const categories = this.deriveOpenDataCategories(tags, category);
      places.push({
        name,
        address,
        rating: undefined,
        stars: Number.isNaN(stars) ? undefined : stars,
        phone: tags.phone || tags['contact:phone'],
        website: tags.website || tags['contact:website'],
        lat,
        lon,
        categories,
        distance: this.distanceInMeters(originLat, originLon, lat, lon),
        image: undefined,
        placeId: undefined,
        wikipedia: tags.wikipedia,
        imageUrl: undefined
      });

      if (places.length >= limit) break;
    }

    return places;
  }

  private deriveOpenDataCategories(tags: any, category: string): string[] {
    const values = [tags.tourism, tags.amenity, tags.shop].filter(Boolean).map((v: any) => String(v).toLowerCase());
    if (values.length > 0) return values;
    return [category];
  }

  private distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(6371000 * c);
  }

  private mapResponseToHotels(response: GeoapifyResponse): Hotel[] {
    if (!response.features) return [];

    return response.features
      .filter(f => f.properties.name) // Only places with names
      .map(feature => {
        const props = feature.properties;
        const raw = props.datasource?.raw || {};

        const hotel: Hotel = {
          name: props.name || 'Unknown',
          address: props.formatted || props.address_line2 || '',
          rating: raw.rating || undefined,
          stars: raw.stars || undefined,
          phone: raw.phone || raw['contact:phone'] || undefined,
          website: raw.website || raw['contact:website'] || undefined,
          lat: props.lat,
          lon: props.lon,
          categories: props.categories || [],
          distance: props.distance,
          image: raw.image || undefined,
          placeId: props.place_id || undefined,
          wikipedia: (raw as any)['wikipedia'] || undefined,
          imageUrl: raw.image || undefined
        };

        // Estimate stars if not provided by the API
        if (!hotel.stars) {
          hotel.stars = this.estimateStarRating(hotel, raw);
        }

        return hotel;
      });
  }

  /**
   * Estimate star rating based on available signals when API doesn't provide it.
   * Uses hotel name keywords, rating, website presence, and accommodation type.
   */
  private estimateStarRating(hotel: Hotel, raw: any): number | undefined {
    const name = (hotel.name || '').toLowerCase();
    const categories = hotel.categories || [];
    const hasWebsite = !!hotel.website;
    const rating = hotel.rating || 0;

    // Check name for luxury keywords
    const luxury5 = ['palace', 'taj', 'marriott', 'hilton', 'hyatt', 'sheraton', 'westin',
      'ritz', 'four seasons', 'intercontinental', 'jw ', 'st. regis', 'mandarin oriental',
      'oberoi', 'leela', 'itc ', 'radisson blu', 'sofitel', 'fairmont', 'shangri-la'];
    const upscale4 = ['resort', 'suites', 'grand', 'royal', 'plaza', 'crown',
      'radisson', 'novotel', 'holiday inn', 'courtyard', 'doubletree', 'ramada',
      'best western', 'lemon tree', 'pride', 'clarks', 'fortune', 'club'];
    const mid3 = ['inn', 'lodge', 'comfort', 'treebo', 'fabhotel', 'oyo', 'ginger'];
    const budget2 = ['hostel', 'dormitory', 'backpacker', 'paying guest', 'pg '];

    if (luxury5.some(k => name.includes(k))) return 5;
    if (upscale4.some(k => name.includes(k))) return 4;

    // Guest houses and hostels are typically lower rated
    if (categories.some(c => c.includes('hostel'))) return 2;
    if (categories.some(c => c.includes('guest_house'))) {
      return hasWebsite ? 3 : 2;
    }

    if (budget2.some(k => name.includes(k))) return 2;
    if (mid3.some(k => name.includes(k))) return 3;

    // Use rating if available
    if (rating >= 4.5) return 5;
    if (rating >= 4.0) return 4;
    if (rating >= 3.0) return 3;

    // Default: hotel with website = 3, without = 2
    if (categories.some(c => c.includes('hotel'))) {
      return hasWebsite ? 3 : 2;
    }

    return undefined; // non-hotel categories (restaurants etc.) don't get stars
  }

  /**
   * Get a static map image URL for a hotel location
   */
  getStaticMapUrl(lat: number, lon: number, zoom: number = 15): string {
    return `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=400&height=200&center=lonlat:${lon},${lat}&zoom=${zoom}&marker=lonlat:${lon},${lat};color:%23ff0000;size:medium&apiKey=${this.apiKey}`;
  }

  /**
   * Get the accommodation type from categories
   */
  getAccommodationType(categories: string[]): string {
    if (categories.some(c => c.includes('hotel'))) return 'Hotel';
    if (categories.some(c => c.includes('guest_house'))) return 'Guest House';
    if (categories.some(c => c.includes('hostel'))) return 'Hostel';
    if (categories.some(c => c.includes('motel'))) return 'Motel';
    if (categories.some(c => c.includes('apartment'))) return 'Apartment';
    if (categories.some(c => c.includes('restaurant'))) return 'Restaurant';
    if (categories.some(c => c.includes('cafe'))) return 'Cafe';
    if (categories.some(c => c.includes('attraction') || c.includes('sights'))) return 'Attraction';
    if (categories.some(c => c.includes('shopping') || c.includes('supermarket'))) return 'Shopping';
    if (categories.some(c => c.includes('tourism'))) return 'Tourism';
    return 'Place';
  }

  /**
   * Format distance for display
   */
  formatDistance(meters?: number): string {
    if (!meters) return '';
    if (meters < 1000) return `${Math.round(meters)}m away`;
    return `${(meters / 1000).toFixed(1)}km away`;
  }

  /**
   * Load real photos for hotels.
   * Tries: 1) Geoapify Place Details API  2) Wikipedia  3) Google Street View
   * Updates the imageUrl property on each hotel in-place.
   */
  loadHotelPhotos(hotels: Hotel[]): void {
    if (!this.hasGeoapifyKey()) return;

    hotels.forEach(hotel => {
      if (hotel.imageUrl) return; // already has image from API

      // Try Geoapify Place Details for a real photo
      if (hotel.placeId) {
        this.http.get<any>(
          `https://api.geoapify.com/v2/place-details?id=${hotel.placeId}&apiKey=${this.apiKey}`
        ).pipe(
          map(data => {
            const wiki = data?.features?.[0]?.properties?.wiki_and_media;
            if (wiki?.image) return wiki.image;
            if (wiki?.wikidata_image) return wiki.wikidata_image;
            return null;
          }),
          catchError(() => of(null))
        ).subscribe(url => {
          if (url) {
            hotel.imageUrl = url;
          } else if (hotel.wikipedia) {
            this.loadWikipediaPhoto(hotel);
          }
        });
      } else if (hotel.wikipedia) {
        this.loadWikipediaPhoto(hotel);
      }
    });
  }

  private loadWikipediaPhoto(hotel: Hotel): void {
    if (!hotel.wikipedia) return;
    const article = hotel.wikipedia.includes(':')
      ? hotel.wikipedia.split(':').slice(1).join(':')
      : hotel.wikipedia;
    const lang = hotel.wikipedia.includes(':') ? hotel.wikipedia.split(':')[0] : 'en';
    this.http.get<any>(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article)}`
    ).pipe(
      map(data => data?.thumbnail?.source || data?.originalimage?.source || null),
      catchError(() => of(null))
    ).subscribe(url => {
      if (url) hotel.imageUrl = url;
    });
  }

  /**
   * Get a hotel photo URL for a hotel card.
   * Priority: real imageUrl (from Place Details/Wikipedia) > satellite map view
   */
  getHotelPhotoUrl(hotel: Hotel): string {
    if (hotel.imageUrl) return hotel.imageUrl;
    // Satellite/aerial photo of the actual location from Geoapify
    return this.getSatelliteMapUrl(hotel.lat, hotel.lon);
  }

  /**
   * Geoapify satellite/aerial static map — shows a real aerial photo of the location.
   * Each hotel shows the actual building area from above. Different from the street map.
   */
  private getSatelliteMapUrl(lat: number, lon: number): string {
    if (!this.hasGeoapifyKey()) {
      // No-key fallback: OpenStreetMap static map snapshot for the location.
      return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=15&size=400x250&markers=${lat},${lon},red-pushpin`;
    }
    return `https://maps.geoapify.com/v1/staticmap?style=klokantech-basic&width=400&height=250&center=lonlat:${lon},${lat}&zoom=17&marker=lonlat:${lon},${lat};color:%23ff0000;size:medium&apiKey=${this.apiKey}`;
  }

  /**
   * Get a placeholder gradient based on accommodation type
   */
  getPlaceholderGradient(categories: string[]): string {
    const type = this.getAccommodationType(categories).toLowerCase();
    switch (type) {
      case 'hotel': return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      case 'guest house': return 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
      case 'hostel': return 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
      case 'motel': return 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)';
      case 'restaurant': return 'linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%)';
      case 'cafe': return 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)';
      case 'attraction': case 'tourism': return 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)';
      case 'shopping': return 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)';
      default: return 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)';
    }
  }

  /**
   * Get Google Maps photo search URL for a hotel
   */
  getGooglePhotosUrl(hotel: Hotel): string {
    const q = encodeURIComponent(`${hotel.name} ${hotel.address || ''}`.trim());
    return `https://www.google.com/maps/search/${q}/@${hotel.lat},${hotel.lon},17z`;
  }
}
