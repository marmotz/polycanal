import {
  type HttpResponse as AngularHttpResponse,
  HttpClient,
  type HttpContext,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { type ActionCall, jsonCodec, matchesContentType, type TransportDriver } from '@polycanal/core';
import {
  type HttpRequest,
  type HttpResponse,
  type HttpSender,
  type RawHttpResponse,
  type RestTransportOptions,
  restTransport,
} from '@polycanal/rest';

export interface AngularRestOptions extends RestTransportOptions {
  /** Sends cookies to another origin (`withCredentials` of `HttpClient`). */
  readonly withCredentials?: boolean;
  /**
   * `HttpContext` of each request, read by the application's Angular interceptors (`HttpContextToken`). Receives the
   * call: its operation (`call.operation.id`) and the `context` given to the call. `undefined`: no context.
   */
  readonly httpContext?: (call: ActionCall) => HttpContext | undefined;
}

/**
 * REST driver based on Angular's `HttpClient`: the application's Angular interceptors (`withInterceptors()`,
 * `HTTP_INTERCEPTORS`) keep applying to every call.
 *
 * With the default JSON codec, `HttpClient` serializes the body and parses the response itself, so Angular
 * interceptors see objects, as with a direct `HttpClient` call. With another codec, bodies are exchanged as text.
 */
export function angularRest(
  http: HttpClient,
  options: AngularRestOptions = {},
): TransportDriver<HttpRequest, HttpResponse> {
  return restTransport(httpClientSender(http, options), options);
}

/** `angularRest()` with the `HttpClient` of the current injection context. */
export function injectAngularRest(options: AngularRestOptions = {}): TransportDriver<HttpRequest, HttpResponse> {
  return angularRest(inject(HttpClient), options);
}

function httpClientSender(http: HttpClient, options: AngularRestOptions): HttpSender {
  return (request, signal, call) =>
    new Promise<RawHttpResponse>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);

        return;
      }

      const json = (call.operation.codec ?? options.codec ?? jsonCodec) === jsonCodec;
      const context = options.httpContext?.(call);
      const init = {
        headers: new HttpHeaders({ ...request.headers }),
        observe: 'response' as const,
        withCredentials: options.withCredentials ?? false,
        ...(context === undefined ? {} : { context }),
      };
      const response$ = json
        ? http.request<unknown>(request.method, request.url, {
            ...init,
            body: jsonBody(request),
            responseType: 'json',
          })
        : http.request(request.method, request.url, { ...init, body: request.body ?? null, responseType: 'text' });

      const subscription = response$.subscribe({
        next: (response: AngularHttpResponse<unknown>) =>
          resolve(raw(response.status, headersOf(response.headers), response.body)),
        error: (error: unknown) => {
          // Status 0: the request did not reach the server (network, CORS)
          if (error instanceof HttpErrorResponse && error.status !== 0) {
            resolve(fromError(error));
          } else {
            reject(error);
          }
        },
      });

      signal?.addEventListener(
        'abort',
        () => {
          subscription.unsubscribe();
          reject(signal.reason);
        },
        { once: true },
      );
    });
}

/** A JSON body goes to `HttpClient` as a value, so Angular interceptors see what was sent, not its encoding. */
function jsonBody(request: HttpRequest): unknown {
  if (request.body === undefined) {
    return null;
  }

  return typeof request.body === 'string' && matchesContentType(request.headers['content-type'], jsonCodec.contentType)
    ? JSON.parse(request.body)
    : request.body;
}

function fromError(error: HttpErrorResponse): RawHttpResponse {
  const headers = headersOf(error.headers);
  const payload: unknown = error.error;

  // A 2xx answer whose body is not JSON: HttpClient reports a parse failure and keeps the text
  if (error.status >= 200 && error.status < 300 && isParseFailure(payload)) {
    return { status: error.status, headers, text: payload.text };
  }

  return raw(error.status, headers, payload);
}

/**
 * Response for the REST transport. Text is left to the codec; a value parsed by `HttpClient` is passed as the decoded
 * body, unless the response declares another content type.
 */
function raw(status: number, headers: Record<string, string>, payload: unknown): RawHttpResponse {
  if (typeof payload === 'string') {
    return { status, headers, text: payload };
  }

  // HttpClient gives null for an empty body as well as for a JSON `null`
  if (payload === null || payload === undefined) {
    return isJsonNull(status, headers) ? { status, headers, text: 'null', body: null } : { status, headers, text: '' };
  }

  const text = JSON.stringify(payload);
  const contentType = headers['content-type'];

  return contentType === undefined || matchesContentType(contentType, jsonCodec.contentType)
    ? { status, headers, text, body: payload }
    : { status, headers, text };
}

function isJsonNull(status: number, headers: Record<string, string>): boolean {
  return (
    status !== 204 &&
    status !== 205 &&
    headers['content-length'] !== '0' &&
    matchesContentType(headers['content-type'], jsonCodec.contentType)
  );
}

function isParseFailure(payload: unknown): payload is { readonly text: string } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof (payload as { text?: unknown }).text === 'string'
  );
}

function headersOf(headers: HttpHeaders): Record<string, string> {
  return Object.fromEntries(headers.keys().map((name) => [name.toLowerCase(), headers.get(name) ?? '']));
}
