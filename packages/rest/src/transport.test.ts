import { action, createClient, defineContract, input } from '@polycanal/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { rest } from './binding.js';
import type { HttpSender } from './http.js';
import { restTransport } from './transport.js';

const contract = defineContract({
  households: {
    get: action({
      transport: rest.get('/households/:id'),
      input: input({ id: z.string() }),
      output: z.object({ id: z.string(), name: z.string() }),
    }),
  },
});

describe('restTransport()', () => {
  it('gives the sender the call it carries', async () => {
    const send = vi.fn<HttpSender>(async () => ({ status: 200, headers: {}, text: '{"id":"h1","name":"Home"}' }));
    const server = createClient(contract, { drivers: [restTransport(send)] });

    await server.households.get({ id: 'h1' }, { context: { tag: 't1' } });

    const call = send.mock.calls[0]?.[2];
    expect(call?.operation.id).toBe('households.get');
    expect(call?.input).toEqual({ id: 'h1' });
    expect(call?.context).toEqual({ tag: 't1' });
  });

  it('skips the codec when the sender already decoded the body', async () => {
    const decode = vi.fn((text: string) => JSON.parse(text) as unknown);
    const send: HttpSender = async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: '',
      body: { id: 'h1', name: 'Home' },
    });
    const server = createClient(contract, {
      drivers: [restTransport(send, { codec: { contentType: 'application/json', encode: JSON.stringify, decode } })],
    });

    await expect(server.households.get({ id: 'h1' })).resolves.toEqual({ id: 'h1', name: 'Home' });
    expect(decode).not.toHaveBeenCalled();
  });

  describe('blob responses', () => {
    const files = defineContract({
      download: action({
        transport: rest.get('/files/:id/export', { response: 'blob', status: [200, 206] }),
        input: input({ id: z.string() }),
        output: z.file(),
        errors: { 404: z.object({ message: z.string() }) },
      }),
    });
    const client = (raw: Awaited<ReturnType<HttpSender>>) =>
      createClient(files, { drivers: [restTransport(async () => raw)] });

    it('delivers a success body as a File named by Content-Disposition', async () => {
      const file = await client({
        status: 206,
        headers: {
          'content-type': 'application/pdf; charset=binary',
          'content-disposition': 'attachment; filename="report 1.pdf"',
        },
        text: '',
        blob: new Blob(['%PDF']),
      }).download({ id: 'f1' });

      expect(file).toBeInstanceOf(File);
      expect(file.name).toBe('report 1.pdf');
      expect(file.type).toBe('application/pdf');
      await expect(file.text()).resolves.toBe('%PDF');
    });

    it('prefers the UTF-8 filename* and defaults to the last path segment', async () => {
      const extended = await client({
        status: 200,
        headers: {
          'content-disposition': 'attachment; filename="rapport.pdf"; filename*=UTF-8\'\'rapport%20%C3%A9t%C3%A9.pdf',
        },
        text: '',
        blob: new Blob(['x'], { type: 'text/plain' }),
      }).download({ id: 'f1' });

      expect(extended.name).toBe('rapport été.pdf');
      expect(extended.type).toBe('text/plain');

      const unnamed = await client({ status: 200, headers: {}, text: '', blob: new Blob(['x']) }).download({
        id: 'f1',
      });

      expect(unnamed.name).toBe('export');
    });

    it('decodes an error body with the codec', async () => {
      const failing = client({
        status: 404,
        headers: { 'content-type': 'application/json' },
        text: '',
        blob: new Blob(['{"message":"gone"}']),
      });

      await expect(failing.download({ id: 'f1' })).rejects.toMatchObject({
        kind: 'server',
        key: '404',
        data: { message: 'gone' },
      });
    });
  });
});
