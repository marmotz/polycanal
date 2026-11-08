import 'reflect-metadata';
import { Controller, Get, type INestApplication, Res, SetMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Endpoint } from './decorators.js';
import { EndpointOutputInterceptor, type EndpointOutputOptions } from './output.js';

const Note = z.object({ id: z.number(), at: z.string() });
const NOTE_SCHEMA = 'noteSchema';

@Controller('notes')
class NotesController {
  @Get('valid')
  @Endpoint({ output: Note })
  valid() {
    return { id: 1, at: new Date('2026-11-08T10:00:00.000Z') };
  }

  @Get('invalid')
  @Endpoint({ output: Note })
  invalid() {
    return { id: 'one', at: 'x' } as never;
  }

  @Get('async')
  @Endpoint({ output: Note })
  async later() {
    return { id: 2, at: 'x' };
  }

  @Get('undeclared')
  undeclared() {
    return { anything: true };
  }

  @Get('metadata')
  @SetMetadata(NOTE_SCHEMA, Note)
  metadata() {
    return { id: 'wrong' };
  }

  @Get('manual')
  // @ts-expect-error a handler answering through @Res() returns nothing: the typed check cannot see what it sends
  @Endpoint({ output: Note })
  manual(@Res() response: { json: (body: unknown) => void }) {
    response.json({ not: 'checked' });
  }
}

let app: INestApplication | undefined;

async function start(options: EndpointOutputOptions = {}): Promise<string> {
  const moduleRef = await Test.createTestingModule({ controllers: [NotesController] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalInterceptors(new EndpointOutputInterceptor(options));
  await app.listen(0);

  return app.getUrl();
}

async function get(base: string, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}/notes/${path}`);

  return { status: response.status, body: await response.json() };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('EndpointOutputInterceptor', () => {
  it('lets a matching response through, dates checked as their JSON string', async () => {
    const base = await start();

    expect(await get(base, 'valid')).toEqual({ status: 200, body: { id: 1, at: '2026-11-08T10:00:00.000Z' } });
    expect(await get(base, 'async')).toEqual({ status: 200, body: { id: 2, at: 'x' } });
  });

  it('answers a 500 for a response that does not match, by default', async () => {
    const base = await start();

    expect(await get(base, 'invalid')).toMatchObject({
      status: 500,
      body: { message: 'The response does not match its schema' },
    });
  });

  it('sends the response anyway in log mode', async () => {
    const base = await start({ onInvalid: 'log' });

    expect(await get(base, 'invalid')).toEqual({ status: 200, body: { id: 'one', at: 'x' } });
  });

  it('hands the failure to a function', async () => {
    const onInvalid = vi.fn();
    const base = await start({ onInvalid });

    expect((await get(base, 'invalid')).status).toBe(200);
    expect(onInvalid).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'NotesController.invalid', value: { id: 'one', at: 'x' } }),
    );
    expect(onInvalid.mock.calls[0]?.[0].issues[0].path).toEqual(['id']);
  });

  it('leaves handlers without schema alone, unless outputOf finds one', async () => {
    const base = await start();

    expect(await get(base, 'undeclared')).toEqual({ status: 200, body: { anything: true } });
    expect((await get(base, 'metadata')).status).toBe(200);
    await app?.close();

    const reflected = await start({
      outputOf: (controller, handler) =>
        Reflect.getMetadata(NOTE_SCHEMA, (controller.prototype as Record<string, object>)[handler] as object),
    });
    expect((await get(reflected, 'metadata')).status).toBe(500);
  });

  it('does not check a handler that answered by itself', async () => {
    const base = await start();

    expect(await get(base, 'manual')).toEqual({ status: 200, body: { not: 'checked' } });
  });
});
