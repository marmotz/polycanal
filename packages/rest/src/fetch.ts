import type { ActionCall, DownloadProgress, TransportDriver } from '@polycanal/core';
import { isRestBinding } from './binding.js';
import type { HttpRequest, HttpResponse, HttpSender, RawHttpResponse } from './http.js';
import { fileProgress, type MultipartPart, multipartParts } from './multipart.js';
import { type RestTransportOptions, restTransport } from './transport.js';

export interface FetchRestOptions extends RestTransportOptions {
  /** `fetch` implementation. Default: the global `fetch`. Not used to report upload progress with `XMLHttpRequest`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Cookies policy, e.g. `include` to send cookies to another origin. */
  readonly credentials?: RequestCredentials;
  /**
   * `XMLHttpRequest` implementation, used to report `onUploadProgress`. Default: the global one, when there is one
   * (browsers). `null` (or no global, as in Node and Bun) reports the upload progress by counting the bytes `fetch`
   * reads from the body.
   */
  readonly XMLHttpRequest?: typeof globalThis.XMLHttpRequest | null;
}

type Upload = (loaded: number, total: number | undefined) => void;

/** REST driver based on `fetch`, for browsers, Node and Bun. */
export function fetchRest(options: FetchRestOptions = {}): TransportDriver<HttpRequest, HttpResponse> {
  const send: HttpSender = async (request, signal, call) => {
    const blob = isRestBinding(call.operation.transport) && call.operation.transport.response === 'blob';
    const upload = request.body === undefined ? undefined : uploadReporter(request.body, call);

    if (upload !== undefined) {
      const Xhr =
        options.XMLHttpRequest === undefined
          ? (globalThis as { XMLHttpRequest?: typeof globalThis.XMLHttpRequest }).XMLHttpRequest
          : options.XMLHttpRequest;

      if (Xhr !== undefined && Xhr !== null) {
        return sendWithXhr(Xhr, request, signal, call, { blob, upload, credentials: options.credentials });
      }
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    const body = upload === undefined || request.body === undefined ? undefined : await countedBody(request, upload);
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: body?.headers ?? request.headers,
      ...(body !== undefined
        ? { body: body.stream, duplex: 'half' }
        : request.body === undefined
          ? {}
          : { body: request.body }),
      ...(signal === undefined ? {} : { signal }),
      ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    } as RequestInit);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });

    if (call.onDownloadProgress !== undefined && response.body !== null) {
      const content = await readCounted(response.body, downloadTotal(headers), call.onDownloadProgress);
      const type = headers['content-type'] ?? '';

      return blob
        ? { status: response.status, headers, text: '', blob: new Blob(content, { type }) }
        : { status: response.status, headers, text: await new Blob(content).text() };
    }

    return blob
      ? { status: response.status, headers, text: '', blob: await response.blob() }
      : { status: response.status, headers, text: await response.text() };
  };

  return restTransport(send, options);
}

/** Reports the upload progress of `body` to the call, with the estimated progress of each file of a multipart body. */
function uploadReporter(body: string | FormData, call: ActionCall): Upload | undefined {
  const onUploadProgress = call.onUploadProgress;

  if (onUploadProgress === undefined) {
    return undefined;
  }

  const parts: readonly MultipartPart[] = body instanceof FormData ? multipartParts(body) : [];

  return (loaded, total) => onUploadProgress({ loaded, total, files: fileProgress(parts, loaded, total) });
}

/**
 * The body serialized once (exact size, `Content-Type` with the multipart boundary), streamed through a counter of
 * the bytes `fetch` reads. It measures what `fetch` consumed, slightly ahead of what left the socket.
 */
async function countedBody(
  request: HttpRequest,
  upload: Upload,
): Promise<{ stream: ReadableStream<Uint8Array>; headers: Readonly<Record<string, string>> }> {
  const serialized = new Response(request.body);
  const contentType = serialized.headers.get('content-type');
  const blob = await serialized.blob();
  const total = blob.size;
  let loaded = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      loaded += chunk.byteLength;
      upload(loaded, total);
    },
  });

  return {
    stream: blob.stream().pipeThrough(counter),
    headers:
      'content-type' in request.headers || contentType === null
        ? request.headers
        : { ...request.headers, 'content-type': contentType },
  };
}

/** Reads a response body chunk by chunk, reporting the bytes received. */
async function readCounted(
  body: ReadableStream<Uint8Array>,
  total: number | undefined,
  onProgress: (progress: DownloadProgress) => void,
): Promise<Uint8Array<ArrayBuffer>[]> {
  const reader = body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      return chunks;
    }

    chunks.push(new Uint8Array(value));
    loaded += value.byteLength;
    onProgress({ loaded, total });
  }
}

/** `Content-Length`, unless the body is compressed: `fetch` counts the decoded bytes. */
function downloadTotal(headers: Readonly<Record<string, string>>): number | undefined {
  const encoding = headers['content-encoding']?.trim().toLowerCase();
  const length = Number(headers['content-length']);

  return (encoding === undefined || encoding === '' || encoding === 'identity') &&
    headers['content-length'] !== undefined &&
    Number.isFinite(length) &&
    length >= 0
    ? length
    : undefined;
}

/** Sends the request with `XMLHttpRequest`, the only browser API reporting the bytes sent. */
function sendWithXhr(
  Xhr: typeof globalThis.XMLHttpRequest,
  request: HttpRequest,
  signal: AbortSignal | undefined,
  call: ActionCall,
  options: { blob: boolean; upload: Upload; credentials: RequestCredentials | undefined },
): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const xhr = new Xhr();
    const onAbort = () => xhr.abort();
    const settle = (settler: () => void) => {
      signal?.removeEventListener('abort', onAbort);
      settler();
    };
    let lastTotal: number | undefined;
    let lastLoaded = 0;

    xhr.open(request.method, request.url);

    for (const [name, value] of Object.entries(request.headers)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.responseType = options.blob ? 'blob' : 'text';

    if (options.credentials === 'include') {
      xhr.withCredentials = true;
    }

    xhr.upload.onprogress = (event) => {
      lastLoaded = event.loaded;
      lastTotal = event.lengthComputable ? event.total : undefined;
      options.upload(lastLoaded, lastTotal);
    };
    // The end of the upload completes every file, even when the last progress event came before it
    xhr.upload.onload = () => {
      if (lastTotal !== undefined && lastLoaded < lastTotal) {
        options.upload(lastTotal, lastTotal);
      }
    };

    const onDownloadProgress = call.onDownloadProgress;

    if (onDownloadProgress !== undefined) {
      xhr.onprogress = (event) =>
        onDownloadProgress({ loaded: event.loaded, total: event.lengthComputable ? event.total : undefined });
    }

    xhr.onload = () =>
      settle(() => {
        const headers = responseHeaders(xhr.getAllResponseHeaders());

        resolve(
          options.blob
            ? { status: xhr.status, headers, text: '', blob: xhr.response as Blob }
            : { status: xhr.status, headers, text: xhr.responseText },
        );
      });
    xhr.onerror = () => settle(() => reject(new TypeError('XMLHttpRequest failed')));
    xhr.ontimeout = () => settle(() => reject(new TypeError('XMLHttpRequest timed out')));
    xhr.onabort = () =>
      settle(() => reject(signal?.aborted ? signal.reason : new DOMException('The request was aborted', 'AbortError')));
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(request.body ?? null);
  });
}

/** Parses `getAllResponseHeaders()`, names lowercase. */
function responseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(':');

    if (separator > 0) {
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  }

  return headers;
}
