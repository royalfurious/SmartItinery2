import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, forkJoin } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { CityService } from './city.service';

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
  private apiKey = 'fae9f1731e8348f2bbf3466b55be96dd';
  private apiUrl = 'https://api.geoapify.com/v2/places';

  constructor(
    private http: HttpClient,
    private cityService: CityService
  ) {}

  /**
   * Search hotels near a destination by name.
   * First geocodes the destination, then queries Geoapify Places API.
   */
  searchHotels(destination: string, limit: number = 20): Observable<Hotel[]> {
    return this.cityService.getCoordinates(destination).pipe(
      switchMap(coords => {
        if (!coords) {
          console.warn('Could not geocode destination:', destination);
          return of([]);
        }
        const [lon, lat] = coords;
        return this.searchHotelsByCoordinates(lat, lon, limit);
      }),
      catchError(error => {
        console.error('Hotel search error:', error);
        return of([]);
      })
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
    return this.cityService.getCoordinates(destination).pipe(
      switchMap(coords => {
        if (!coords) return of([]);
        const [lon, lat] = coords;
        
        const params = {
          categories: category,
          filter: `circle:${lon},${lat},10000`,
          bias: `proximity:${lon},${lat}`,
          limit: limit.toString(),
          apiKey: this.apiKey
        };

        return this.http.get<GeoapifyResponse>(this.apiUrl, { params }).pipe(
          map(response => this.mapResponseToHotels(response))
        );
      }),
      catchError(error => {
        console.error('Nearby places search error:', error);
        return of([]);
      })
    );
  }

  private mapResponseToHotels(response: GeoapifyResponse): Hotel[] {
    if (!response.features) return [];

    return response.features
      .filter(f => f.properties.name) // Only places with names
      .map(feature => {
        const props = feature.properties;
        const raw = props.datasource?.raw || {};

        return {
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
          image: raw.image || undefined
        };
      });
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
    return 'Accommodation';
  }

  /**
   * Format distance for display
   */
  formatDistance(meters?: number): string {
    if (!meters) return '';
    if (meters < 1000) return `${Math.round(meters)}m away`;
    return `${(meters / 1000).toFixed(1)}km away`;
  }
}
