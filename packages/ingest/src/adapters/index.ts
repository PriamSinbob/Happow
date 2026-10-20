import type { SourceAdapter } from '../types.js';
import { crawler } from './crawler.js';
import { meetup } from './meetup.js';
import { ticketmaster } from './ticketmaster.js';

/** Adapter implementations by the `adapter` name used in config/sources.json. */
export const adapters: Record<string, SourceAdapter> = {
  ticketmaster,
  meetup,
  crawler,
};
