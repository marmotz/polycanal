import { type Codec, type Interceptor, jsonCodec, matchesContentType, type TransportDriver } from '@polycanal/core';
import { isRestBinding, type RestBinding } from './binding.js';
import type { HttpRequest, HttpResponse, HttpSender, RawHttpResponse } from './http.js';
import { buildRequest } from './request.js';

export interface RestTransportOptions {
  /** Prefix of every path, e.g. `https://api.example.com` or `/api`. Default: none (same origin). */
  readonly baseUrl?: string;
  /** Headers of every request; a function is called for each request. */
  readonly headers?: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>>);
  /** Default codec, overridden by the `codec` of an operation. Default: JSON. */
  readonly codec?: Codec;
  readonly interceptors?: readonly Interceptor<HttpRequest, HttpResponse>[];
}

/**
 * Builds a REST transport driver around an HTTP sender. `fetchRest()` and `angularRest()` are built on it; use it
 * directly to plug another HTTP client.
 */
export function restTransport(
  send: HttpSender,
  options: RestTransportOptions = {},
): TransportDriver<HttpRequest, HttpResponse> {
  const codecOf = (codec: Codec | undefined) => codec ?? options.codec ?? jsonCodec;

  return {
    name: 'rest',
    ...(options.interceptors === undefined ? {} : { interceptors: options.interceptors }),
    action: {
      prepare: (call) =>
        buildRequest(call.operation, call.input, {
          baseUrl: options.baseUrl ?? '',
          codec: codecOf(call.operation.codec),
          headers: typeof options.headers === 'function' ? options.headers() : (options.headers ?? {}),
        }),
      send: async (request, call) => {
        const binding = isRestBinding(call.operation.transport) ? call.operation.transport : undefined;

        return decode(await send(request, call.signal, call), request, binding, codecOf(call.operation.codec));
      },
      read: (response, call) => {
        const binding = call.operation.transport;

        return isSuccess(isRestBinding(binding) ? binding : undefined, response.status)
          ? { ok: true, body: response.body }
          : { ok: false, key: String(response.status), body: response.body };
      },
    },
  };
}

function isSuccess(binding: RestBinding | undefined, status: number): boolean {
  return binding?.status === undefined ? status >= 200 && status < 300 : binding.status.includes(status);
}

async function decode(
  raw: RawHttpResponse,
  request: HttpRequest,
  binding: RestBinding | undefined,
  codec: Codec,
): Promise<HttpResponse> {
  if ('body' in raw) {
    return { ...raw, body: raw.body };
  }

  if (raw.blob !== undefined && isSuccess(binding, raw.status)) {
    return { ...raw, body: toFile(raw.blob, raw.headers, request.url) };
  }

  // An error response of a blob binding is JSON like any other: read it as text
  const response = raw.blob === undefined ? raw : { ...raw, text: await raw.blob.text() };

  if (response.text.trim() === '') {
    return { ...response, body: undefined };
  }

  const contentType = response.headers['content-type'];

  if (contentType !== undefined && !matchesContentType(contentType, codec.contentType)) {
    return { ...response, body: response.text };
  }

  try {
    return { ...response, body: codec.decode(response.text) };
  } catch (cause) {
    throw new TypeError(`response body is not valid ${codec.contentType} (status ${response.status})`, { cause });
  }
}

/** A binary success body as a `File`: type from `Content-Type`, name from `Content-Disposition` or the URL path. */
function toFile(blob: Blob, headers: Readonly<Record<string, string>>, url: string): File {
  const contentType = headers['content-type']?.split(';')[0]?.trim();
  const type = contentType === undefined || contentType === '' ? blob.type : contentType;

  return new File([blob], dispositionFilename(headers['content-disposition']) ?? lastSegment(url), { type });
}

/** `filename*` (RFC 5987, UTF-8) first, then `filename`. */
function dispositionFilename(disposition: string | undefined): string | undefined {
  if (disposition === undefined) {
    return undefined;
  }

  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(disposition);

  if (extended?.[2] !== undefined) {
    try {
      return decodeURIComponent(extended[2].trim());
    } catch {
      // Malformed encoding: fall back to the plain filename
    }
  }

  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(disposition);
  const name = plain?.[1]?.replace(/\\(.)/g, '$1') ?? plain?.[2]?.trim();

  return name === undefined || name === '' ? undefined : name;
}

function lastSegment(url: string): string {
  const segment = new URL(url, 'http://localhost').pathname.split('/').filter(Boolean).at(-1);

  if (segment === undefined) {
    return 'download';
  }

  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
