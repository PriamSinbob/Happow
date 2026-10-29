import type { SourceAdapter } from '../types.js';
import { crawler } from './crawler.js';
import { meetup } from './meetup.js';
import { threads } from './threads.js';
import { ticketmaster } from './ticketmaster.js';
import { venueSites } from './venue-sites.js';
import { worshipServices } from './worship-services.js';

/** Adapter implementations by the `adapter` name used in config/sources.json. */
export const adapters: Record<string, SourceAdapter> = {
  ticketmaster,
  meetup,
  crawler,
  threads,
  'venue-sites': venueSites,
  'worship-services': worshipServices,
};
