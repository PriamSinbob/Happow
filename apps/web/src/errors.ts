import { ApiError } from './api';
import { region } from './config';
import type { Language } from '@happow/core';
import type { Translate } from './i18n';

/** A user-facing sentence for an /api failure. */
export function errorText(t: Translate, err: unknown, lang: Language): string {
  const code = err instanceof ApiError ? err.code : 'network';
  switch (code) {
    case 'network':
    case 'rate_limited':
    case 'not_configured':
    case 'unsafe_url':
    case 'page_unavailable':
    case 'invalid_input':
    case 'unknown_event':
    case 'account_required':
    case 'photo_unavailable':
    case 'photo_too_large':
    case 'too_many_feeds':
    case 'feed_stopped':
      return t(`error.${code}`);
    case 'outside_region':
      return t('error.outside_region', { region: region.name[lang] });
    default:
      return t('error.generic');
  }
}
