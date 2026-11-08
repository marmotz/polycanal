import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express4 from 'express';
import express5 from 'express5';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { endpoint } from './endpoint.js';
import { type ResponseValidationOptions, validateResponses } from './output.js';

const Note = z.object({ id: z.number(), at: z.string() });

let server: Server | undefined;

async function start(
  framework: typeof express4,
  options: ResponseValidationOptions | undefined,
): Promise<(path: string) => Promise<{ status: number; body: unknown }>> {
  const app = framework();

  if (options !== undefined) {
    validateResponses(app, options);
  }

  app.get('/valid', endpoint({ output: Note }), (_request, response) => {
    response.json({ id: 1, at: new Date('2026-11-08T10:00:00.000Z') });
  });
  app.get('/invalid', endpoint({ output: Note }), (_request, response) => {
    response.send({ id: 'one', at: 'x' });
  });
  app.get('/plain', (_request, response) => {
    response.json({ anything: true });
  });

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  return async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);

    return { status: response.status, body: await response.json() };
  };
}

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
  vi.restoreAllMocks();
});

describe.each([
  ['Express 4', express4],
  ['Express 5', express5 as unknown as typeof express4],
])('validateResponses() with %s', (_name, framework) => {
  it('lets matching responses through, dates checked as their JSON string', async () => {
    const get = await start(framework, {});

    expect(await get('/valid')).toEqual({ status: 200, body: { id: 1, at: '2026-11-08T10:00:00.000Z' } });
    expect(await get('/plain')).toEqual({ status: 200, body: { anything: true } });
  });

  it('answers a 500 for a response that does not match, by default', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const get = await start(framework, {});

    expect(await get('/invalid')).toEqual({ status: 500, body: { message: 'The response does not match its schema' } });
    expect(error).toHaveBeenCalledOnce();
  });

  it('sends the response anyway in log mode, or hands the failure to a function', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const logged = await start(framework, { onInvalid: 'log' });
    expect(await logged('/invalid')).toEqual({ status: 200, body: { id: 'one', at: 'x' } });
    await new Promise((resolve) => server?.close(resolve));

    const onInvalid = vi.fn();
    const handed = await start(framework, { onInvalid });
    expect((await handed('/invalid')).status).toBe(200);
    expect(onInvalid).toHaveBeenCalledWith(expect.objectContaining({ route: 'GET /invalid' }));
  });

  it('checks nothing when the application does not validate its responses', async () => {
    const get = await start(framework, undefined);

    expect(await get('/invalid')).toEqual({ status: 200, body: { id: 'one', at: 'x' } });
  });
});
