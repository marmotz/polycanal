import type { TransportDriver } from '@polycanal/core';
import type { HttpRequest, HttpResponse, HttpSender } from './http.js';
import { type RestTransportOptions, restTransport } from './transport.js';

export interface FetchRestOptions extends RestTransportOptions {
  /** `fetch` implementation. Default: the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Cookies policy, e.g. `include` to send cookies to another origin. */
  readonly credentials?: RequestCredentials;
}

/** REST driver based on `fetch`, for browsers, Node and Bun. */
export function fetchRest(options: FetchRestOptions = {}): TransportDriver<HttpRequest, HttpResponse> {
  const send: HttpSender = async (request, signal) => {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(signal === undefined ? {} : { signal }),
      ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });

    return { status: response.status, headers, text: await response.text() };
  };

  return restTransport(send, options);
}
