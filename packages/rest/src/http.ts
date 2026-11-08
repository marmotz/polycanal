/** Native request of the REST driver, as seen and changed by interceptors. */
export interface HttpRequest {
  readonly method: string;
  /** Full URL, query string included. */
  readonly url: string;
  /** Header names are lowercase. */
  readonly headers: Readonly<Record<string, string>>;
  /** Encoded body, `undefined` when there is none. */
  readonly body: string | undefined;
}

/** Response as returned by a sender, before decoding. */
export interface RawHttpResponse {
  readonly status: number;
  /** Header names are lowercase. */
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
}

/** Native response of the REST driver, as seen and changed by interceptors. */
export interface HttpResponse extends RawHttpResponse {
  /**
   * Decoded body: decoded by the codec when the response has its content type (or none), the raw text otherwise,
   * `undefined` when the body is empty.
   */
  readonly body: unknown;
}

/** Sends an HTTP request: the only part that differs between `fetch`, Angular `HttpClient`, etc. */
export type HttpSender = (request: HttpRequest, signal: AbortSignal | undefined) => Promise<RawHttpResponse>;

/** Returns a copy of `request` with headers added or replaced. */
export function withHeaders(request: HttpRequest, headers: Readonly<Record<string, string>>): HttpRequest {
  return { ...request, headers: { ...request.headers, ...lowercaseKeys(headers) } };
}

export function lowercaseKeys(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}
