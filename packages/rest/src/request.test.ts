import { type ActionDefinition, action, defineContract, input, jsonCodec, toModel } from '@polycanal/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { rest } from './binding.js';
import { buildRequest } from './request.js';

const options = { baseUrl: 'https://api.test/', codec: jsonCodec, headers: {} };

function build(definition: ActionDefinition, value: unknown, overrides: Partial<typeof options> = {}) {
  const [operation] = toModel(defineContract({ op: definition })).operations;

  if (operation?.family !== 'action') {
    throw new Error('expected an action');
  }

  return buildRequest(operation, value, { ...options, ...overrides });
}

describe('buildRequest()', () => {
  it('sends remaining fields in the body for POST, PUT and PATCH', () => {
    const request = build(
      action({
        transport: rest.patch('/user/:userId'),
        input: input({
          householdId: z.string(),
          userId: { source: 'path', schema: z.string() },
          toUserId: { source: 'body', alias: 'userId', schema: z.string() },
          role: z.string(),
        }),
        output: z.void(),
      }),
      { householdId: 'h1', userId: 'u 1', toUserId: 'u2', role: 'admin' },
    );

    expect(request).toEqual({
      method: 'PATCH',
      url: 'https://api.test/user/u%201',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"householdId":"h1","userId":"u2","role":"admin"}',
    });
  });

  it('sends remaining fields in the query string for GET and DELETE', () => {
    const definition = action({
      transport: rest.get('/projects/:id/analyses'),
      input: input({
        id: z.string(),
        page: z.number(),
        tags: z.array(z.string()),
        since: z.date(),
        filter: z.object({ a: z.number() }),
        empty: z.string().optional(),
        none: z.null(),
      }),
      output: z.void(),
    });

    const request = build(definition, {
      id: 'p1',
      page: 2,
      tags: ['a', 'b'],
      since: new Date('2026-01-02T03:04:05.000Z'),
      filter: { a: 1 },
      none: null,
    });

    expect(request.url).toBe(
      'https://api.test/projects/p1/analyses?page=2&tags=a&tags=b&since=2026-01-02T03%3A04%3A05.000Z&filter=%7B%22a%22%3A1%7D',
    );
    expect(request.body).toBeUndefined();
    expect(request.headers).toEqual({ accept: 'application/json' });
    expect(
      build(action({ transport: rest.delete('/x'), input: input({ q: z.string() }), output: z.void() }), { q: 'a' })
        .url,
    ).toBe('https://api.test/x?q=a');
  });

  it('honors explicit sources: query on POST, body on GET, headers', () => {
    const request = build(
      action({
        transport: rest.post('/search'),
        input: input({
          page: { source: 'query', schema: z.number() },
          tenant: { source: 'header', alias: 'X-Tenant', schema: z.string() },
          ids: { source: 'header', schema: z.array(z.string()) },
          term: z.string(),
        }),
        output: z.void(),
      }),
      { page: 1, tenant: 't1', ids: ['a', 'b'], term: 'ada' },
    );

    expect(request).toMatchObject({
      url: 'https://api.test/search?page=1',
      headers: { 'x-tenant': 't1', ids: 'a, b' },
      body: '{"term":"ada"}',
    });
  });

  it('sends a root body field as the whole body', () => {
    const request = build(
      action({
        transport: rest.post('/households/:id/members/import'),
        input: input({ id: z.string(), members: { source: 'body', root: true, schema: z.array(z.string()) } }),
        output: z.void(),
      }),
      { id: 'h1', members: ['u1', 'u2'] },
    );

    expect(request).toMatchObject({ url: 'https://api.test/households/h1/members/import', body: '["u1","u2"]' });
  });

  it('spreads root query and header fields', () => {
    const request = build(
      action({
        transport: rest.get('/search'),
        input: input({
          filters: { source: 'query', root: true, schema: z.object({ a: z.string(), b: z.number() }) },
          meta: { source: 'header', root: true, schema: z.record(z.string(), z.string()) },
        }),
        output: z.void(),
      }),
      { filters: { a: 'x', b: 2 }, meta: { 'X-Trace': 'abc' } },
    );

    expect(request).toMatchObject({ url: 'https://api.test/search?a=x&b=2', headers: { 'x-trace': 'abc' } });
  });

  it('maps plain object schemas with the default rules', () => {
    const definition = action({
      transport: rest.put('/users/:id'),
      input: z.object({ id: z.string(), name: z.string() }),
      output: z.void(),
    });

    expect(build(definition, { id: 'u1', name: 'Ada' })).toMatchObject({
      url: 'https://api.test/users/u1',
      body: '{"name":"Ada"}',
    });
  });

  it('sends no body without input or without body fields', () => {
    expect(build(action({ transport: rest.post('/ping'), output: z.void() }), undefined)).toEqual({
      method: 'POST',
      url: 'https://api.test/ping',
      headers: { accept: 'application/json' },
      body: undefined,
    });
  });

  it('adds driver headers, lowercased, and supports a relative base URL', () => {
    const request = build(action({ transport: rest.get('/ping'), output: z.void() }), undefined, {
      baseUrl: '',
      headers: { Authorization: 'Bearer t' },
    });

    expect(request).toMatchObject({ url: '/ping', headers: { authorization: 'Bearer t' } });
  });

  it('fails on a missing path parameter value', () => {
    const definition = action({
      transport: rest.get('/users/:id'),
      input: input({ id: z.string().optional() }),
      output: z.void(),
    });

    expect(() => build(definition, {})).toThrow('op: missing value for path parameter "id"');
  });

  it('fails on a root query field that is not an object', () => {
    const definition = action({
      transport: rest.get('/x'),
      input: input({ q: { source: 'query', root: true, schema: z.array(z.string()) } }),
      output: z.void(),
    });

    expect(() => build(definition, { q: ['a'] })).toThrow('root field "q" must be an object to be spread');
  });

  describe('multipart body', () => {
    const upload = action({
      transport: rest.post('/listings/:id/photos', { body: 'multipart' }),
      input: input({
        id: z.string(),
        cover: z.file(),
        photos: z.array(z.file()),
        thumbnail: z.instanceof(Blob).optional(),
        title: z.string(),
        price: z.number(),
        draft: z.boolean(),
        publishAt: z.date(),
        meta: z.object({ tags: z.array(z.string()) }),
        note: z.string().nullable(),
        missing: z.string().optional(),
        tag: { source: 'query', schema: z.string() },
      }),
      output: z.void(),
    });

    it('encodes the body fields as FormData, without content type', () => {
      const cover = new File(['cover'], 'cover.jpg', { type: 'image/jpeg' });
      const first = new File(['a'], 'a.png', { type: 'image/png' });
      const second = new File(['bb'], 'b.png', { type: 'image/png' });
      const thumbnail = new Blob(['t'], { type: 'image/webp' });
      const request = build(upload, {
        id: 'l1',
        cover,
        photos: [first, second],
        thumbnail,
        title: 'Flat',
        price: 12.5,
        draft: false,
        publishAt: new Date('2026-01-02T03:04:05.000Z'),
        meta: { tags: ['sea'] },
        note: null,
        tag: 'x',
      });

      expect(request).toMatchObject({
        method: 'POST',
        url: 'https://api.test/listings/l1/photos?tag=x',
        headers: { accept: 'application/json' },
      });
      expect(request.headers['content-type']).toBeUndefined();
      expect(request.body).toBeInstanceOf(FormData);

      const form = request.body as FormData;

      expect([...form.keys()]).toEqual([
        'cover',
        'photos',
        'photos',
        'thumbnail',
        'title',
        'price',
        'draft',
        'publishAt',
        'meta',
      ]);
      expect(form.get('cover')).toBe(cover);
      expect(form.getAll('photos')).toEqual([first, second]);
      expect(form.getAll('photos').map((file) => (file as File).name)).toEqual(['a.png', 'b.png']);
      expect(form.get('thumbnail')).toBeInstanceOf(Blob);
      expect((form.get('thumbnail') as Blob).size).toBe(1);
      expect(form.get('title')).toBe('Flat');
      expect(form.get('price')).toBe('12.5');
      expect(form.get('draft')).toBe('false');
      expect(form.get('publishAt')).toBe('2026-01-02T03:04:05.000Z');
      expect(form.get('meta')).toBe('{"tags":["sea"]}');
      expect(form.has('note')).toBe(false);
      expect(form.has('missing')).toBe(false);
    });

    it('sends no body when no body field has a value', () => {
      const definition = action({
        transport: rest.put('/x', { body: 'multipart' }),
        input: input({ file: z.file().optional() }),
        output: z.void(),
      });

      expect(build(definition, {}).body).toBeUndefined();
    });

    it('accepts any media type for a blob response', () => {
      const definition = action({
        transport: rest.get('/files/:id', { response: 'blob' }),
        input: input({ id: z.string() }),
        output: z.file(),
      });

      expect(build(definition, { id: 'f1' }).headers).toEqual({ accept: '*/*' });
    });

    it('rejects a root body field', () => {
      const definition = action({
        transport: rest.post('/x', { body: 'multipart' }),
        input: input({ data: { source: 'body', root: true, schema: z.object({ a: z.string() }) } }),
        output: z.void(),
      });

      expect(() => build(definition, { data: { a: 'b' } })).toThrow(
        'op: root body field "data" cannot be sent as multipart',
      );
    });
  });
});
