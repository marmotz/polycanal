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
});
