import {
  type HttpResponse as AngularHttpResponse,
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { inject } from '@angular/core';
import type { TransportDriver } from '@polycanal/core';
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
}

/**
 * REST driver based on Angular's `HttpClient`: the application's Angular interceptors (`withInterceptors()`,
 * `HTTP_INTERCEPTORS`) keep applying to every call.
 */
export function angularRest(
  http: HttpClient,
  options: AngularRestOptions = {},
): TransportDriver<HttpRequest, HttpResponse> {
  return restTransport(httpClientSender(http, options.withCredentials ?? false), options);
}

/** `angularRest()` with the `HttpClient` of the current injection context. */
export function injectAngularRest(options: AngularRestOptions = {}): TransportDriver<HttpRequest, HttpResponse> {
  return angularRest(inject(HttpClient), options);
}

function httpClientSender(http: HttpClient, withCredentials: boolean): HttpSender {
  return (request, signal) =>
    new Promise<RawHttpResponse>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);

        return;
      }

      const subscription = http
        .request(request.method, request.url, {
          body: request.body ?? null,
          headers: new HttpHeaders({ ...request.headers }),
          observe: 'response',
          responseType: 'text',
          withCredentials,
        })
        .subscribe({
          next: (response) => resolve(raw(response)),
          error: (error: unknown) => {
            // Status 0: the request did not reach the server (network, CORS)
            if (error instanceof HttpErrorResponse && error.status !== 0) {
              resolve({
                status: error.status,
                headers: headersOf(error.headers),
                text: typeof error.error === 'string' ? error.error : '',
              });
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

function raw(response: AngularHttpResponse<string>): RawHttpResponse {
  return { status: response.status, headers: headersOf(response.headers), text: response.body ?? '' };
}

function headersOf(headers: HttpHeaders): Record<string, string> {
  return Object.fromEntries(headers.keys().map((name) => [name.toLowerCase(), headers.get(name) ?? '']));
}
