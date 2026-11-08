import type { Codec } from './binding.js';

/** Default codec of every driver. */
export const jsonCodec: Codec = {
  contentType: 'application/json',
  encode: (value) => JSON.stringify(value),
  decode: (text) => (text.trim() === '' ? undefined : JSON.parse(text)),
};

/** Whether a received `Content-Type` header matches a codec media type, ignoring parameters such as `charset`. */
export function matchesContentType(header: string | null | undefined, contentType: string): boolean {
  if (!header) {
    return false;
  }

  const media = header.split(';')[0]?.trim().toLowerCase() ?? '';
  const expected = contentType.toLowerCase();

  if (media === expected) {
    return true;
  }

  // Structured syntax suffix, e.g. application/problem+json for application/json
  const [type, subtype] = expected.split('/');

  return subtype !== undefined && media.startsWith(`${type}/`) && media.endsWith(`+${subtype}`);
}
