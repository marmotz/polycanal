import { mkdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { type ContractTree, createClient } from '@polycanal/core';
import { fetchRest } from '@polycanal/rest';
import express4 from 'express';
import express5 from 'express5';
import multer from 'multer';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { discoverExpressContract } from './discover.js';
import { endpoint } from './endpoint.js';
import { generateExpressContract } from './generate.js';
import { fileKind, isMulterMiddleware } from './multipart.js';
import { validateResponses } from './output.js';

const outputDir = fileURLToPath(new URL('../.test-output/multipart/', import.meta.url));
const diskDir = `${outputDir}uploads/`;

afterAll(() => rmSync(outputDir, { recursive: true, force: true }));

const memory = multer({ storage: multer.memoryStorage() });
const avatarInput = {
  avatar: z.file().mime(['image/png']),
  caption: z.string().optional(),
  zip: z.string(),
  ratio: z.number(),
};

function uploadApp(express: typeof express4) {
  const app = express();

  app.post(
    '/users/:id/avatar',
    memory.single('avatar'),
    endpoint({ name: 'avatar', input: avatarInput, output: z.object({ body: z.unknown(), file: z.string() }) }),
    (request, response) => {
      response.json({
        body: request.body,
        file: (request as unknown as { file: { originalname: string } }).file.originalname,
      });
    },
  );
  app.post(
    '/albums',
    memory.fields([{ name: 'cover', maxCount: 1 }, { name: 'photos' }]),
    endpoint({
      name: 'album',
      input: z.object({ title: z.string(), cover: z.file(), photos: z.array(z.file()).min(1) }),
      output: z.object({ body: z.unknown(), count: z.number() }),
    }),
    (request, response) => {
      const files = (request as unknown as { files: Record<string, unknown[]> }).files;
      response.json({ body: request.body, count: (files.cover?.length ?? 0) + (files.photos?.length ?? 0) });
    },
  );
  app.post(
    '/gallery',
    multer({ dest: diskDir }).array('pictures'),
    endpoint({ name: 'gallery', input: { pictures: z.array(z.file().max(5)) }, output: z.number() }),
    (request, response) => {
      response.json((request as unknown as { files: unknown[] }).files.length);
    },
  );

  return app;
}

async function serve<T>(app: ReturnType<typeof express4>, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function form(entries: Record<string, string | File | readonly File[]>): FormData {
  const data = new FormData();

  for (const [name, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      data.append(name, item as string | File);
    }
  }

  return data;
}

const png = (name = 'me.png', content = 'png') => new File([content], name, { type: 'image/png' });

describe('multipart helpers', () => {
  it('recognizes multer middlewares by name', () => {
    expect(isMulterMiddleware(memory.single('avatar'))).toBe(true);
    expect(isMulterMiddleware(memory.none())).toBe(true);
    expect(isMulterMiddleware(express4.json())).toBe(false);
    expect(isMulterMiddleware('multerMiddleware')).toBe(false);
  });

  it('reads files and lists of files from JSON Schema', () => {
    expect(fileKind({ type: 'string', format: 'binary' })).toBe('file');
    expect(fileKind({ anyOf: [{ type: 'string', format: 'binary' }, { type: 'null' }] })).toBe('file');
    expect(fileKind({ type: 'array', items: { type: 'string', format: 'binary' } })).toBe('list');
    expect(fileKind({ type: 'string', format: 'byte' })).toBeUndefined();
    expect(fileKind({ type: 'array', items: { type: 'string' } })).toBeUndefined();
    expect(fileKind(true)).toBeUndefined();
  });
});

describe('multipart discovery', () => {
  it('describes routes behind multer as multipart, with their file fields', () => {
    const discovery = discoverExpressContract(uploadApp(express4));
    const binding = (name: string) =>
      discovery.description.operations.find((operation) => operation.path.join('.') === name);

    expect(binding('avatar')).toMatchObject({
      binding: { method: 'POST', path: '/users/:id/avatar', body: 'multipart' },
      input: {
        kind: 'fields',
        fields: expect.arrayContaining([
          { name: 'avatar', required: true, schema: expect.objectContaining({ type: 'string', format: 'binary' }) },
        ]),
      },
    });
    expect(binding('album')).toMatchObject({ binding: { body: 'multipart' }, input: { kind: 'schema' } });
    expect(binding('gallery')).toMatchObject({ binding: { body: 'multipart' } });
    expect(discovery.report.warnings).toEqual([]);
  });

  it('describes file fields as multipart without multer on the route (mounted on the application)', () => {
    const app = express4();
    app.put('/logo', endpoint({ input: { logo: z.file() }, output: z.void() }), (_request, response) => {
      response.status(204).end();
    });
    app.post('/json', endpoint({ input: { name: z.string() }, output: z.void() }), (_request, response) => {
      response.status(204).end();
    });

    const { description } = discoverExpressContract(app);

    expect(description.operations[0]).toMatchObject({ binding: { method: 'PUT', body: 'multipart' } });
    expect(description.operations[1]?.binding).toMatchObject({ method: 'POST', body: undefined });
  });

  it('warns about multer without file field and endpoint() placed before multer', () => {
    const app = express4();
    app.post('/text', memory.none(), endpoint({ input: { name: z.string() }, output: z.void() }), () => {});
    app.post('/late', endpoint({ input: { doc: z.file() }, output: z.void() }), memory.single('doc'), () => {});

    const { description, report } = discoverExpressContract(app);

    expect(description.operations.map((operation) => operation.binding)).toMatchObject([
      { path: '/text', body: 'multipart' },
      { path: '/late', body: 'multipart' },
    ]);
    expect(report.warnings).toEqual([
      'POST /text: multer is used, but endpoint() input declares no file field (z.file())',
      'POST /late: endpoint() runs before multer, it cannot see the uploaded files',
    ]);
  });

  it('skips uploads on GET and DELETE routes', () => {
    const app = express4();
    app.get('/download', memory.single('file'), endpoint({ output: z.void() }), () => {});
    app.delete('/files', endpoint({ input: { file: z.file() }, output: z.void() }), () => {});

    const { description, report } = discoverExpressContract(app);

    expect(description.operations).toEqual([]);
    expect(report.skipped.map(({ route, reason }) => `${route.method} ${route.path}: ${reason}`)).toEqual([
      'GET /download: uploaded files need a POST, PUT or PATCH route',
      'DELETE /files: uploaded files need a POST, PUT or PATCH route',
    ]);
  });
});

describe.each([
  ['Express 4', express4],
  ['Express 5', express5 as unknown as typeof express4],
])('multipart validation in endpoint() (%s)', (_name, express) => {
  it('validates the file and the text fields, parsing them as JSON when needed', async () => {
    await serve(uploadApp(express), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/users/u1/avatar`, {
        method: 'POST',
        body: form({ avatar: png(), zip: '75001', ratio: '12.5', ignored: 'x' }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ body: { zip: '75001', ratio: 12.5 }, file: 'me.png' });
    });
  });

  it('answers 400 with the issues of the files and of the text fields', async () => {
    await serve(uploadApp(express), async (baseUrl) => {
      const wrongFile = await fetch(`${baseUrl}/users/u1/avatar`, {
        method: 'POST',
        body: form({ avatar: new File(['x'], 'me.txt', { type: 'text/plain' }), zip: '75001', ratio: 'abc' }),
      });

      expect(wrongFile.status).toBe(400);
      const body = (await wrongFile.json()) as { message: string; issues: { path: unknown[] }[] };
      expect(body.message).toBe('Invalid uploaded files');
      expect(body.issues.map((issue) => issue.path[0])).toEqual(['avatar', 'ratio']);

      const wrongText = await fetch(`${baseUrl}/users/u1/avatar`, {
        method: 'POST',
        body: form({ avatar: png(), zip: '75001' }),
      });

      expect(wrongText.status).toBe(400);
      expect(await wrongText.json()).toMatchObject({
        message: 'Invalid multipart body',
        issues: [{ path: ['ratio'] }],
      });

      const missing = await fetch(`${baseUrl}/users/u1/avatar`, {
        method: 'POST',
        body: form({ zip: '75001', ratio: '1' }),
      });

      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({ message: 'Invalid uploaded files', issues: [{ path: ['avatar'] }] });
    });
  });

  it('validates upload.fields() against an object schema', async () => {
    await serve(uploadApp(express), async (baseUrl) => {
      const valid = await fetch(`${baseUrl}/albums`, {
        method: 'POST',
        body: form({ title: 'Holidays', cover: png('cover.png'), photos: [png('a.png'), png('b.png')] }),
      });

      expect(valid.status).toBe(200);
      expect(await valid.json()).toEqual({ body: { title: 'Holidays' }, count: 3 });

      const invalid = await fetch(`${baseUrl}/albums`, {
        method: 'POST',
        body: form({ title: 'Holidays', cover: png('cover.png') }),
      });

      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ message: 'Invalid uploaded files', issues: [{ path: ['photos'] }] });
    });
  });

  it('validates files stored on disk by upload.array()', async () => {
    mkdirSync(diskDir, { recursive: true });

    await serve(uploadApp(express), async (baseUrl) => {
      const valid = await fetch(`${baseUrl}/gallery`, { method: 'POST', body: form({ pictures: [png(), png()] }) });

      expect(valid.status).toBe(200);
      expect(await valid.json()).toBe(2);

      const tooLarge = await fetch(`${baseUrl}/gallery`, {
        method: 'POST',
        body: form({ pictures: [png('big.png', 'too large')] }),
      });

      expect(tooLarge.status).toBe(400);
      expect(await tooLarge.json()).toMatchObject({ issues: [{ path: ['pictures', 0] }] });
    });
  });

  it('answers the 400 as is when the application validates its responses', async () => {
    const app = uploadApp(express);
    validateResponses(app);

    await serve(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/users/u1/avatar`, {
        method: 'POST',
        body: form({ zip: '75001', ratio: '1' }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ message: 'Invalid uploaded files' });
    });
  });
});

describe('generated multipart contract', () => {
  it('uploads files with the generated client', async () => {
    mkdirSync(outputDir, { recursive: true });
    const app = uploadApp(express4);
    const file = `${outputDir}contract.ts`;
    const { source } = generateExpressContract(app, { output: file, exportName: 'api' });

    expect(source).toContain("body: 'multipart'");
    expect(source).toContain('z.file()');

    await serve(app, async (baseUrl) => {
      const { api } = (await import(file)) as { api: ContractTree };
      const client = createClient(api, { drivers: [fetchRest({ baseUrl })] }) as unknown as {
        avatar: (input: unknown) => Promise<unknown>;
        album: (input: unknown) => Promise<unknown>;
      };

      await expect(client.avatar({ id: 'u1', avatar: png(), zip: '75001', ratio: 12.5 })).resolves.toEqual({
        body: { zip: '75001', ratio: 12.5 },
        file: 'me.png',
      });
      await expect(client.album({ title: 'Trip', cover: png('cover.png'), photos: [png('a.png')] })).resolves.toEqual({
        body: { title: 'Trip' },
        count: 2,
      });
    });
  });
});
