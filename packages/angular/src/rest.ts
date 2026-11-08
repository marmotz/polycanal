import {
  HttpRequest as AngularHttpRequest,
  HttpClient,
  type HttpContext,
  HttpErrorResponse,
  type HttpEvent,
  HttpEventType,
  HttpHeaders,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { type ActionCall, jsonCodec, matchesContentType, type TransportDriver } from '@polycanal/core';
import {
  fileProgress,
  type HttpRequest,
  type HttpResponse,
  type HttpSender,
  isRestBinding,
  multipartParts,
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
 * Multipart bodies go to `HttpClient` as `FormData`, and `response: 'blob'` bindings are read as blobs.
 *
 * `onUploadProgress` and `onDownloadProgress` are reported from the `HttpClient` progress events (`reportProgress`).
 * Only the `XMLHttpRequest` backend (`withXhr()`) emits upload progress events.
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

      const blob = isRestBinding(call.operation.transport) && call.operation.transport.response === 'blob';
      const json = (call.operation.codec ?? options.codec ?? jsonCodec) === jsonCodec;
      const context = options.httpContext?.(call);
      const progress = progressReporter(request, call);
      const angularRequest = new AngularHttpRequest<unknown>(
        request.method,
        request.url,
        json ? jsonBody(request) : (request.body ?? null),
        {
          headers: new HttpHeaders({ ...request.headers }),
          reportProgress: progress !== undefined,
          responseType: blob ? 'blob' : json ? 'json' : 'text',
          withCredentials: options.withCredentials ?? false,
          ...(context === undefined ? {} : { context }),
        },
      );

      const subscription = http.request(angularRequest).subscribe({
        next: (event: HttpEvent<unknown>) => {
          progress?.(event);

          if (event.type === HttpEventType.Response) {
            resolve(raw(event.status, headersOf(event.headers), event.body, blob));
          }
        },
        error: (error: unknown) => {
          // Status 0: the request did not reach the server (network, CORS)
          if (error instanceof HttpErrorResponse && error.status !== 0) {
            resolve(fromError(error, blob));
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

/**
 * Turns the `HttpClient` progress events into the progress callbacks of the call, with the estimated progress of each
 * file of a multipart body. `undefined` when the call has no progress callback.
 */
function progressReporter(request: HttpRequest, call: ActionCall): ((event: HttpEvent<unknown>) => void) | undefined {
  const { onUploadProgress, onDownloadProgress } = call;

  if (onUploadProgress === undefined && onDownloadProgress === undefined) {
    return undefined;
  }

  const parts = request.body instanceof FormData ? multipartParts(request.body) : [];
  let uploaded: { loaded: number; total: number | undefined } | undefined;
  const upload = (loaded: number, total: number | undefined) => {
    uploaded = { loaded, total };
    onUploadProgress?.({ loaded, total, files: fileProgress(parts, loaded, total) });
  };
  // The answer starts once the body is sent: it completes every file, even when the last progress event came before it
  const completeUpload = () => {
    if (uploaded?.total !== undefined && uploaded.loaded < uploaded.total) {
      upload(uploaded.total, uploaded.total);
    }
  };

  return (event) => {
    switch (event.type) {
      case HttpEventType.UploadProgress:
        upload(event.loaded, event.total);
        break;
      case HttpEventType.DownloadProgress:
        completeUpload();
        onDownloadProgress?.({ loaded: event.loaded, total: event.total });
        break;
      case HttpEventType.ResponseHeader:
      case HttpEventType.Response:
        completeUpload();
        break;
      default:
        break;
    }
  };
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

function fromError(error: HttpErrorResponse, blob: boolean): RawHttpResponse {
  const headers = headersOf(error.headers);
  const payload: unknown = error.error;

  // An error of a blob binding comes as a blob, read as text by the transport
  if (blob) {
    return raw(error.status, headers, payload, true);
  }

  // A 2xx answer whose body is not JSON: HttpClient reports a parse failure and keeps the text
  if (error.status >= 200 && error.status < 300 && isParseFailure(payload)) {
    return { status: error.status, headers, text: payload.text };
  }

  return raw(error.status, headers, payload, false);
}

/**
 * Response for the REST transport. Text is left to the codec; a value parsed by `HttpClient` is passed as the decoded
 * body, unless the response declares another content type. A blob is passed as is, for the transport to decode.
 */
function raw(status: number, headers: Record<string, string>, payload: unknown, blob: boolean): RawHttpResponse {
  if (blob) {
    return payload instanceof Blob ? { status, headers, text: '', blob: payload } : { status, headers, text: '' };
  }

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
