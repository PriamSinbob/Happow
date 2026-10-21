import type { LatLng } from '@happow/core';

/** An event as found on a web page, before config-driven normalization. Shared by JSON-LD and LLM paths. */
export interface ExtractedEvent {
  title: string;
  description: string | null;
  /** ISO 8601: with an offset, a local date-time ("2026-10-24T19:00"), or a date ("2026-10-24"). */
  start: string;
  end: string | null;
  venueName: string | null;
  address: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  };
  point: LatLng | null;
  isFree: boolean | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  /** The event's own page, if the page is a listing. */
  url: string | null;
  ticketUrl: string | null;
  imageUrl: string | null;
  status: 'scheduled' | 'cancelled' | 'postponed';
  /** Online-only events cannot be placed on the map. */
  online: boolean;
  /** Source vocabulary to map through a categoryMap (e.g. "musicevent"). */
  categoryHints: string[];
  /** Category ids chosen directly from our taxonomy (LLM path). */
  categoryIds: string[];
  method: 'jsonld' | 'llm';
  /** 0–1: how sure the extraction is about title, time and place. */
  confidence: number;
}

/** A small async key-value cache (Postgres in workers, PostgREST in the API, a Map in tests). */
export interface KeyValueCache<T> {
  /** undefined = not cached; null may be a cached "not found". */
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
}

export class MemoryCache<T> implements KeyValueCache<T> {
  private readonly map = new Map<string, T>();
  async get(key: string) {
    return this.map.get(key);
  }
  async set(key: string, value: T) {
    this.map.set(key, value);
  }
}
