import type { AppConfig, Trust } from './types.js';

/** What ingestion knows about one event when it decides how sure to be about it. */
export interface ConfidenceSignals {
  /** The extractor's own score (1 for API sources), already lowered for a coarse geocode match. */
  extracted: number;
  /** The source's trust level from config. */
  trust: Trust;
  /** The source gave an end time (otherwise it is estimated from the category). */
  hasEnd: boolean;
  /** The source named a venue, not only a street or an area. */
  hasVenue: boolean;
}

export type ConfidenceWeights = AppConfig['confidence'];

/**
 * How sure we are that an event is real and correctly placed and timed, 0–1. Below
 * `extraction.minConfidence` a new, uncorroborated event goes to moderation instead of the map.
 * It never changes ranking or order.
 */
export function scoreConfidence(s: ConfidenceSignals, w: ConfidenceWeights): number {
  // TODO(human): combine the signals with the weights from config/app.json → "confidence".
  void w;
  return s.extracted;
}
