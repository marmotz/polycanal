import { action, createClient, defineContract, type Interceptor, input, isPolycanalError } from '@polycanal/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { rest } from './binding.js';
import { fetchRest } from './fetch.js';
import { type HttpRequest, type HttpResponse, withHeaders } from './http.js';

const contract = defineContract({
  auth: {
    login: action({
      transport: rest.post('/auth/login'),
      input: z.object({ email: z.string(), password: z.string() }),
      output: z.object({ token: z.string() }),
      errors: { 401: z.object({ reason: z.string() }) },
    }),
  },
  households: {
    get: action({
      transport: rest.get('/households/:id'),
      input: input({ id: z.string() }),
      output: z.object({ id: z.string(), name: z.string() }),
    }),
    remove: action({
      transport: rest.delete('/households/:id', { status: 204 }),
      input: input({ id: z.string() }),
      output: z.void(),
    }),
  },
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn<typeof fetch>(async (url, init) => handler(String(url), init ?? {}));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

describe('fetchRest()', () => {
  it('calls fetch with the built request and returns the validated response', async () => {
    const fetchMock = fakeFetch(() => json({ token: 't' }));
    const server = createClient(contract, {
      drivers: [fetchRest({ baseUrl: 'https://api.test', fetch: fetchMock, credentials: 'include' })],
    });

    await expect(server.auth.login({ email: 'ada@example.com', password: 'pw' })).resolves.toEqual({ token: 't' });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/auth/login');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"email":"ada@example.com","password":"pw"}',
      credentials: 'include',
    });
  });

  it('passes the abort signal', async () => {
    const fetchMock = fakeFetch(() => json({ id: 'h1', name: 'Home' }));
    const server = createClient(contract, { drivers: [fetchRest({ fetch: fetchMock })] });
    const controller = new AbortController();

    await server.households.get({ id: 'h1' }, { signal: controller.signal });

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('maps error statuses to server errors with validated bodies', async () => {
    const server = createClient(contract, {
      drivers: [fetchRest({ fetch: fakeFetch(() => json({ reason: 'bad password' }, 401)) })],
    });

    const error = await server.auth.login({ email: 'a', password: 'b' }).catch((caught: unknown) => caught);

    expect(isPolycanalError(error, { kind: 'server', key: 401 })).toBe(true);
    expect(error).toMatchObject({ data: { reason: 'bad password' }, response: { status: 401 } });
  });

  it('honors the success status of the binding', async () => {
    const empty = createClient(contract, {
      drivers: [fetchRest({ fetch: fakeFetch(() => new Response(null, { status: 204 })) })],
    });
    const ok = createClient(contract, { drivers: [fetchRest({ fetch: fakeFetch(() => json({}, 200)) })] });

    await expect(empty.households.remove({ id: 'h1' })).resolves.toBeUndefined();
    await expect(ok.households.remove({ id: 'h1' })).rejects.toMatchObject({ kind: 'server', key: '200' });
  });

  it('keeps bodies of another content type as text', async () => {
    const server = createClient(contract, {
      drivers: [
        fetchRest({
          fetch: fakeFetch(
            () => new Response('Bad gateway', { status: 502, headers: { 'content-type': 'text/plain' } }),
          ),
        }),
      ],
    });

    await expect(server.households.get({ id: 'h1' })).rejects.toMatchObject({
      kind: 'server',
      key: '502',
      data: 'Bad gateway',
    });
  });

  it('reports undecodable bodies as transport errors', async () => {
    const server = createClient(contract, {
      drivers: [
        fetchRest({ fetch: fakeFetch(() => new Response('{', { headers: { 'content-type': 'application/json' } })) }),
      ],
    });

    const error = await server.households.get({ id: 'h1' }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: 'transport' });
    expect((error as Error).cause).toBeInstanceOf(TypeError);
    expect(((error as Error).cause as Error).message).toBe('response body is not valid application/json (status 200)');
  });

  it('reports network failures as transport errors', async () => {
    const server = createClient(contract, {
      drivers: [
        fetchRest({
          fetch: vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed'))),
        }),
      ],
    });

    await expect(server.households.get({ id: 'h1' })).rejects.toMatchObject({
      kind: 'transport',
      message: 'households.get: could not send the request',
    });
  });

  it('adds static and computed driver headers', async () => {
    const fetchMock = fakeFetch(() => json({ id: 'h1', name: 'Home' }));
    let token = 'a';
    const server = createClient(contract, {
      drivers: [fetchRest({ fetch: fetchMock, headers: () => ({ Authorization: `Bearer ${token}` }) })],
    });

    await server.households.get({ id: 'h1' });
    token = 'b';
    await server.households.get({ id: 'h1' });

    expect(
      fetchMock.mock.calls.map(([, init]) => (init?.headers as Record<string, string> | undefined)?.authorization),
    ).toEqual(['Bearer a', 'Bearer b']);
  });

  it('runs typed interceptors that can refresh a token and replay', async () => {
    const fetchMock = fakeFetch((_, init) =>
      (init.headers as Record<string, string>).authorization === 'Bearer fresh'
        ? json({ id: 'h1', name: 'Home' })
        : json({}, 401),
    );
    const refresh: Interceptor<HttpRequest, HttpResponse> = async (request, next) => {
      const response = await next(withHeaders(request, { Authorization: 'Bearer stale' }));

      return response.status === 401 ? next(withHeaders(request, { Authorization: 'Bearer fresh' })) : response;
    };
    const server = createClient(contract, { drivers: [fetchRest({ fetch: fetchMock, interceptors: [refresh] })] });

    await expect(server.households.get({ id: 'h1' })).resolves.toEqual({ id: 'h1', name: 'Home' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the codec of the operation', async () => {
    const upper = {
      contentType: 'text/x-upper',
      encode: (value: unknown) => String(value).toUpperCase(),
      decode: (text: string) => text.toLowerCase(),
    };
    const shout = defineContract({
      shout: action({
        transport: rest.post('/shout'),
        input: input({ text: { source: 'body', root: true, schema: z.string() } }),
        output: z.string(),
        codec: upper,
      }),
    });
    const fetchMock = fakeFetch(() => new Response('HELLO', { headers: { 'content-type': 'text/x-upper' } }));
    const server = createClient(shout, { drivers: [fetchRest({ fetch: fetchMock })] });

    await expect(server.shout({ text: 'hello' })).resolves.toBe('hello');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: 'HELLO',
      headers: { 'content-type': 'text/x-upper', accept: 'text/x-upper' },
    });
  });
});

describe('fetchRest() file transfers', () => {
  const files = defineContract({
    upload: action({
      transport: rest.post('/listings/:id/photos', { body: 'multipart', status: 201 }),
      input: input({ id: z.string(), photo: z.file(), title: z.string() }),
      output: z.object({ id: z.string() }),
    }),
    convert: action({
      transport: rest.post('/convert', { body: 'multipart', response: 'blob' }),
      input: input({ source: z.file() }),
      output: z.file(),
    }),
    save: action({
      transport: rest.post('/notes'),
      input: z.object({ text: z.string() }),
      output: z.object({ id: z.string() }),
    }),
    download: action({
      transport: rest.get('/files/:id', { response: 'blob' }),
      input: input({ id: z.string() }),
      output: z.file(),
    }),
  });
  const photo = new File(['x'.repeat(100)], 'photo.jpg', { type: 'image/jpeg' });

  interface ProgressEventLike {
    readonly loaded: number;
    readonly total: number;
    readonly lengthComputable: boolean;
  }

  class FakeXhrBase {
    method = '';
    url = '';
    headers: Record<string, string> = {};
    body: unknown;
    responseType = '';
    withCredentials = false;
    status = 0;
    response: unknown = null;
    responseText = '';
    responseHeaders = '';
    aborted = false;
    upload: { onprogress: ((event: ProgressEventLike) => void) | null; onload: (() => void) | null } = {
      onprogress: null,
      onload: null,
    };
    onprogress: ((event: ProgressEventLike) => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }

    getAllResponseHeaders() {
      return this.responseHeaders;
    }

    abort() {
      this.aborted = true;
      this.onabort?.();
    }
  }

  /** An `XMLHttpRequest` whose `send()` runs `script`, plus the instances created. */
  function fakeXhr(script: (xhr: FakeXhrBase) => void) {
    const instances: FakeXhrBase[] = [];

    class FakeXhr extends FakeXhrBase {
      constructor() {
        super();
        instances.push(this);
      }

      send(body: unknown) {
        this.body = body;
        script(this);
      }
    }

    return { Xhr: FakeXhr as unknown as typeof XMLHttpRequest, instances };
  }

  const progress = (loaded: number, total: number, lengthComputable = true): ProgressEventLike => ({
    loaded,
    total,
    lengthComputable,
  });

  describe('upload progress with XMLHttpRequest', () => {
    it('sends the request with XHR and reports the progress of each file', async () => {
      const { Xhr, instances } = fakeXhr((xhr) => {
        xhr.upload.onprogress?.(progress(0, 400));
        xhr.upload.onprogress?.(progress(400, 400));
        xhr.upload.onload?.();
        xhr.status = 201;
        xhr.responseText = '{"id":"p1"}';
        xhr.responseHeaders = 'Content-Type: application/json\r\nX-Request-Id: 7\r\n';
        xhr.onload?.();
      });
      const fetchMock = fakeFetch(() => json({}));
      const server = createClient(files, {
        drivers: [
          fetchRest({ baseUrl: 'https://api.test', fetch: fetchMock, XMLHttpRequest: Xhr, credentials: 'include' }),
        ],
      });
      const onUploadProgress = vi.fn();

      await expect(server.upload({ id: 'l1', photo, title: 'Sea' }, { onUploadProgress })).resolves.toEqual({
        id: 'p1',
      });

      expect(fetchMock).not.toHaveBeenCalled();
      const [xhr] = instances;
      expect(xhr).toMatchObject({
        method: 'POST',
        url: 'https://api.test/listings/l1/photos',
        headers: { accept: 'application/json' },
        responseType: 'text',
        withCredentials: true,
      });
      expect(xhr?.body).toBeInstanceOf(FormData);
      expect((xhr?.body as FormData | undefined)?.get('photo')).toBe(photo);
      expect(onUploadProgress.mock.calls.map(([event]) => event)).toEqual([
        { loaded: 0, total: 400, files: [{ field: 'photo', name: 'photo.jpg', loaded: 0, total: 100 }] },
        { loaded: 400, total: 400, files: [{ field: 'photo', name: 'photo.jpg', loaded: 100, total: 100 }] },
      ]);
    });

    it('completes every file at the end of the upload', async () => {
      const { Xhr } = fakeXhr((xhr) => {
        xhr.upload.onprogress?.(progress(10, 400));
        xhr.upload.onload?.();
        xhr.status = 201;
        xhr.responseText = '{"id":"p1"}';
        xhr.onload?.();
      });
      const server = createClient(files, { drivers: [fetchRest({ XMLHttpRequest: Xhr })] });
      const onUploadProgress = vi.fn();

      await server.upload({ id: 'l1', photo, title: 'Sea' }, { onUploadProgress });

      expect(onUploadProgress).toHaveBeenLastCalledWith({
        loaded: 400,
        total: 400,
        files: [{ field: 'photo', name: 'photo.jpg', loaded: 100, total: 100 }],
      });
    });

    it('reports an unknown total and no file progress for a JSON body', async () => {
      const { Xhr, instances } = fakeXhr((xhr) => {
        xhr.upload.onprogress?.(progress(5, 0, false));
        xhr.status = 200;
        xhr.responseText = '{"id":"n1"}';
        xhr.onload?.();
      });
      const server = createClient(files, { drivers: [fetchRest({ XMLHttpRequest: Xhr })] });
      const onUploadProgress = vi.fn();

      await expect(server.save({ text: 'hi' }, { onUploadProgress })).resolves.toEqual({ id: 'n1' });

      expect(instances[0]?.body).toBe('{"text":"hi"}');
      expect(instances[0]?.headers).toMatchObject({ 'content-type': 'application/json' });
      expect(onUploadProgress).toHaveBeenCalledWith({ loaded: 5, total: undefined, files: [] });
    });

    it('reads a blob response and reports the download progress', async () => {
      const { Xhr, instances } = fakeXhr((xhr) => {
        xhr.onprogress?.(progress(2, 4));
        xhr.onprogress?.(progress(4, 0, false));
        xhr.status = 200;
        xhr.response = new Blob(['%PDF']);
        xhr.responseHeaders = 'content-type: application/pdf\r\ncontent-disposition: attachment; filename="out.pdf"';
        xhr.onload?.();
      });
      const server = createClient(files, { drivers: [fetchRest({ XMLHttpRequest: Xhr })] });
      const onDownloadProgress = vi.fn();

      const file = await server.convert({ source: photo }, { onUploadProgress: () => {}, onDownloadProgress });

      expect(instances[0]?.responseType).toBe('blob');
      expect(file).toBeInstanceOf(File);
      expect(file).toMatchObject({ name: 'out.pdf', type: 'application/pdf' });
      await expect(file.text()).resolves.toBe('%PDF');
      expect(onDownloadProgress.mock.calls.map(([event]) => event)).toEqual([
        { loaded: 2, total: 4 },
        { loaded: 4, total: undefined },
      ]);
    });

    it('aborts the XHR when the signal aborts', async () => {
      const controller = new AbortController();
      const { Xhr, instances } = fakeXhr(() => controller.abort(new Error('user cancelled')));
      const server = createClient(files, { drivers: [fetchRest({ XMLHttpRequest: Xhr })] });

      const error = await server
        .upload({ id: 'l1', photo, title: 'Sea' }, { signal: controller.signal, onUploadProgress: () => {} })
        .catch((caught: unknown) => caught);

      expect(instances[0]?.aborted).toBe(true);
      expect(error).toMatchObject({ kind: 'transport', cause: new Error('user cancelled') });
    });

    it('reports network failures as transport errors', async () => {
      const { Xhr } = fakeXhr((xhr) => xhr.onerror?.());
      const server = createClient(files, { drivers: [fetchRest({ XMLHttpRequest: Xhr })] });

      await expect(
        server.upload({ id: 'l1', photo, title: 'Sea' }, { onUploadProgress: () => {} }),
      ).rejects.toMatchObject({ kind: 'transport', message: 'upload: could not send the request' });
    });

    it('uses the global XMLHttpRequest by default, and fetch without upload callback', async () => {
      const { Xhr, instances } = fakeXhr((xhr) => {
        xhr.status = 201;
        xhr.responseText = '{"id":"p1"}';
        xhr.onload?.();
      });
      vi.stubGlobal('XMLHttpRequest', Xhr);

      try {
        const fetchMock = fakeFetch(() => json({ id: 'p2' }, 201));
        const server = createClient(files, { drivers: [fetchRest({ fetch: fetchMock })] });

        await expect(server.upload({ id: 'l1', photo, title: 'Sea' }, { onUploadProgress: () => {} })).resolves.toEqual(
          { id: 'p1' },
        );
        await expect(server.upload({ id: 'l1', photo, title: 'Sea' })).resolves.toEqual({ id: 'p2' });

        expect(instances).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('upload progress without XMLHttpRequest', () => {
    /** A `fetch` that reads the streamed body like a server would, then answers. */
    function readingFetch(answer: () => Response) {
      const received: { init?: RequestInit | undefined; form?: FormData; text?: string } = {};
      const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
        received.init = init;
        const request = new Request(new URL(String(url), 'http://localhost'), init);

        if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
          received.form = await request.formData();
        } else {
          received.text = await request.text();
        }

        return answer();
      });

      return { fetchMock, received };
    }

    it('streams the serialized body through a byte counter', async () => {
      const { fetchMock, received } = readingFetch(() => json({ id: 'p1' }, 201));
      const server = createClient(files, { drivers: [fetchRest({ fetch: fetchMock, XMLHttpRequest: null })] });
      const onUploadProgress = vi.fn();

      await expect(server.upload({ id: 'l1', photo, title: 'Sea' }, { onUploadProgress })).resolves.toEqual({
        id: 'p1',
      });

      expect(received.init).toMatchObject({ method: 'POST', duplex: 'half' });
      expect(received.init?.body).toBeInstanceOf(ReadableStream);
      expect((received.init?.headers as Record<string, string> | undefined)?.['content-type']).toMatch(
        /^multipart\/form-data; ?boundary=/,
      );
      expect(received.form?.get('title')).toBe('Sea');
      await expect((received.form?.get('photo') as File | undefined)?.text()).resolves.toBe('x'.repeat(100));

      const events = onUploadProgress.mock.calls.map(([event]) => event);
      const last = events.at(-1);
      expect(events.length).toBeGreaterThan(0);
      expect(last.loaded).toBe(last.total);
      expect(last.total).toBeGreaterThan(100);
      expect(last.files).toEqual([{ field: 'photo', name: 'photo.jpg', loaded: 100, total: 100 }]);
      expect(events.map((event) => event.loaded)).toEqual(
        [...events.map((event) => event.loaded)].sort((a, b) => a - b),
      );
    });

    it('keeps the content type of a JSON body', async () => {
      const { fetchMock, received } = readingFetch(() => json({ id: 'n1' }));
      const server = createClient(files, { drivers: [fetchRest({ fetch: fetchMock, XMLHttpRequest: null })] });
      const onUploadProgress = vi.fn();

      await server.save({ text: 'hi' }, { onUploadProgress });

      expect((received.init?.headers as Record<string, string> | undefined)?.['content-type']).toBe('application/json');
      expect(received.text).toBe('{"text":"hi"}');
      expect(onUploadProgress).toHaveBeenLastCalledWith({ loaded: 13, total: 13, files: [] });
    });

    it('uses plain fetch when the request has no body', async () => {
      const fetchMock = fakeFetch(() => new Response('pdf', { headers: { 'content-type': 'application/pdf' } }));
      const server = createClient(files, { drivers: [fetchRest({ fetch: fetchMock, XMLHttpRequest: null })] });

      await server.download({ id: 'f1' }, { onUploadProgress: () => {} });

      expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('duplex');
    });
  });

  describe('responses', () => {
    const chunked = (chunks: readonly string[], headers: Record<string, string>) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
          },
        }),
        { headers },
      );

    it('delivers a blob response as a File', async () => {
      const server = createClient(files, {
        drivers: [
          fetchRest({
            fetch: fakeFetch(
              () =>
                new Response('%PDF', {
                  headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="a.pdf"' },
                }),
            ),
          }),
        ],
      });

      const file = await server.download({ id: 'f1' });

      expect(file).toBeInstanceOf(File);
      expect(file).toMatchObject({ name: 'a.pdf', type: 'application/pdf' });
      await expect(file.text()).resolves.toBe('%PDF');
    });

    it('reports the download progress while reading a blob body', async () => {
      const server = createClient(files, {
        drivers: [
          fetchRest({
            fetch: fakeFetch(() =>
              chunked(['ab', 'cd', 'e'], { 'content-type': 'application/octet-stream', 'content-length': '5' }),
            ),
          }),
        ],
      });
      const onDownloadProgress = vi.fn();

      const file = await server.download({ id: 'f1' }, { onDownloadProgress });

      expect(file).toMatchObject({ name: 'f1', type: 'application/octet-stream' });
      await expect(file.text()).resolves.toBe('abcde');
      expect(onDownloadProgress.mock.calls.map(([event]) => event)).toEqual([
        { loaded: 2, total: 5 },
        { loaded: 4, total: 5 },
        { loaded: 5, total: 5 },
      ]);
    });

    it('reports the download progress while reading a text body, without total when compressed', async () => {
      const server = createClient(files, {
        drivers: [
          fetchRest({
            fetch: fakeFetch(() =>
              chunked(['{"id":', '"n1"}'], {
                'content-type': 'application/json',
                'content-length': '8',
                'content-encoding': 'gzip',
              }),
            ),
          }),
        ],
      });
      const onDownloadProgress = vi.fn();

      await expect(server.save({ text: 'hi' }, { onDownloadProgress })).resolves.toEqual({ id: 'n1' });
      expect(onDownloadProgress.mock.calls.map(([event]) => event)).toEqual([
        { loaded: 6, total: undefined },
        { loaded: 11, total: undefined },
      ]);
    });
  });
});
