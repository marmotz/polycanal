import { type Codec, type Interceptor, jsonCodec, matchesContentType, type TransportDriver } from '@polycanal/core';
import { isRestBinding } from './binding.js';
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
      send: async (request, call) => decode(await send(request, call.signal, call), codecOf(call.operation.codec)),
      read: (response, call) => {
        const binding = call.operation.transport;
        const status = isRestBinding(binding) ? binding.status : undefined;
        const ok =
          status === undefined ? response.status >= 200 && response.status < 300 : status.includes(response.status);

        return ok
          ? { ok: true, body: response.body }
          : { ok: false, key: String(response.status), body: response.body };
      },
    },
  };
}

function decode(response: RawHttpResponse, codec: Codec): HttpResponse {
  if ('body' in response) {
    return { ...response, body: response.body };
  }

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
