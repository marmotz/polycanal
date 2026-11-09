import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type ContractTree, createClient, VOID_KEYWORD } from '@polycanal/core';
import { fetchRest } from '@polycanal/rest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { files } from './__fixtures__/files.js';
import { petstore } from './__fixtures__/petstore.js';
import { run } from './cli.js';
import { generateFromOpenApi } from './generate.js';
import { convertSchema, importOpenApi } from './import.js';

const outputDir = fileURLToPath(new URL('../.test-output/', import.meta.url));

afterAll(() => rmSync(outputDir, { recursive: true, force: true }));

function operation(id: string, document = petstore) {
  const found = importOpenApi(document).description.operations.find((candidate) => candidate.path.join('.') === id);

  if (found?.family !== 'action') {
    throw new Error(`no action ${id}`);
  }

  return found;
}

describe('importOpenApi()', () => {
  it('names operations after their first tag and operationId', () => {
    expect(importOpenApi(petstore).description.operations.map((candidate) => candidate.path.join('.'))).toEqual([
      'pets.listPets',
      'pets.createPet',
      'pets.getPet',
      'pets.replaceTags',
      'pets.deletePetsByPetId',
    ]);
  });

  it('accepts a custom naming', () => {
    const { description } = importOpenApi(petstore, {
      naming: (info) => [info.method.toLowerCase(), info.path.split('/')[1] ?? ''],
    });

    expect(description.operations[0]?.path).toEqual(['get', 'pets']);
  });

  it('maps parameters to fields with their source', () => {
    expect(operation('pets.listPets')).toMatchObject({
      binding: { method: 'GET', path: '/pets' },
      input: {
        kind: 'fields',
        fields: [
          { name: 'limit', source: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'xTenant', alias: 'X-Tenant', source: 'header', required: true },
        ],
      },
      output: { type: 'array', items: { $ref: '#/schemas/Pet' } },
      meta: { summary: 'List pets', tags: ['pets'] },
    });
  });

  it('spreads object bodies and converts OpenAPI 3.0 exclusive bounds', () => {
    expect(operation('pets.createPet')).toMatchObject({
      binding: { method: 'POST', path: '/pets' },
      input: {
        fields: [
          { name: 'name', source: 'body', required: true, schema: { type: 'string' } },
          { name: 'age', source: 'body', required: false, schema: { type: 'integer', exclusiveMinimum: 0 } },
        ],
      },
      output: { $ref: '#/schemas/Pet' },
      errors: { 409: { type: 'object' } },
    });
    expect(operation('pets.createPet').input).not.toHaveProperty('fields.1.schema.minimum');
  });

  it('sends non-object bodies as a root field', () => {
    expect(operation('pets.replaceTags').input).toMatchObject({
      fields: [
        { name: 'petId', source: 'path', required: true },
        { name: 'body', source: 'body', root: true, required: true, schema: { type: 'array' } },
      ],
    });
  });

  it('resolves path-level parameters, JSON variants and void responses', () => {
    expect(operation('pets.getPet')).toMatchObject({
      binding: { path: '/pets/:petId' },
      output: { $ref: '#/schemas/Pet' },
      errors: { 404: { $ref: '#/schemas/Problem' } },
      meta: { deprecated: true },
    });
    expect(operation('pets.deletePetsByPetId').output).toEqual({ [VOID_KEYWORD]: true });
  });

  it('converts component schemas', () => {
    expect(importOpenApi(petstore).description.schemas?.Pet).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        nickname: { type: 'string', nullable: true },
        parent: { $ref: '#/schemas/Pet' },
      },
      required: ['id', 'name'],
    });
  });

  it('warns about what it cannot describe', () => {
    expect(importOpenApi(petstore).warnings).toEqual([
      'HEAD /pets: method not supported, skipped',
      'GET /pets: cookie parameter "session" not supported, ignored',
      'PATCH /pets/{petId}: request body has no JSON or multipart content, skipped',
      'GET /owners/{owner-id}: path parameter "owner-id" is not a valid identifier, skipped',
    ]);
  });

  it('rejects other OpenAPI versions and broken references', () => {
    expect(() => importOpenApi({ openapi: '2.0' })).toThrow('only OpenAPI 3 documents are supported (got "2.0")');
    expect(() =>
      importOpenApi({
        openapi: '3.1.0',
        paths: { '/x': { get: { parameters: [{ $ref: '#/components/parameters/Nope' }], responses: {} } } },
      }),
    ).toThrow('"#/components/parameters/Nope" does not exist');
  });

  it('keeps 3.1 schemas as they are', () => {
    expect(convertSchema({ type: ['string', 'null'], exclusiveMinimum: 3, examples: ['a'] })).toEqual({
      type: ['string', 'null'],
      exclusiveMinimum: 3,
    });
  });
});

describe('importOpenApi() with files', () => {
  it('spreads multipart bodies into body fields with a multipart binding', () => {
    expect(operation('photos.uploadPhotos', files)).toMatchObject({
      binding: { method: 'POST', path: '/photos', body: 'multipart', response: undefined },
      input: {
        kind: 'fields',
        fields: [
          {
            name: 'cover',
            source: 'body',
            required: true,
            schema: {
              type: 'string',
              format: 'binary',
              maxLength: 5000000,
              anyOf: [{ contentMediaType: 'image/png' }, { contentMediaType: 'image/jpeg' }],
            },
          },
          { name: 'photos', source: 'body', required: false, schema: { type: 'array', items: { format: 'binary' } } },
          { name: 'title', source: 'body', required: true, schema: { type: 'string' } },
          { name: 'price', source: 'body', required: false, schema: { type: 'number' } },
        ],
      },
      output: { type: 'object' },
    });
    // wildcard media types are not file constraints
    expect(operation('photos.uploadPhotos', files).input).not.toHaveProperty('fields.1.schema.items.contentMediaType');
  });

  it('turns encoding content types and OpenAPI 3.1 media strings into file constraints', () => {
    const { description } = importOpenApi({
      openapi: '3.1.0',
      paths: {
        '/avatar': {
          put: {
            operationId: 'setAvatar',
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      avatar: { type: 'string', contentMediaType: 'image/webp' },
                      scan: { type: 'string', format: 'binary' },
                      meta: { type: 'object' },
                    },
                  },
                  encoding: { scan: { contentType: 'application/pdf' }, meta: { contentType: 'application/json' } },
                },
              },
            },
            responses: { '204': { description: 'ok' } },
          },
        },
      },
    });

    expect(description.operations[0]).toMatchObject({
      binding: { body: 'multipart' },
      input: {
        fields: [
          { name: 'avatar', schema: { type: 'string', format: 'binary', contentMediaType: 'image/webp' } },
          { name: 'scan', schema: { type: 'string', format: 'binary', contentMediaType: 'application/pdf' } },
          { name: 'meta', schema: { type: 'object' } },
        ],
      },
    });
  });

  it('delivers binary success responses as files', () => {
    expect(operation('photos.downloadPhoto', files)).toMatchObject({
      binding: { method: 'GET', path: '/photos/:photoId', body: undefined, response: 'blob' },
      output: { type: 'string', format: 'binary' },
      errors: { 404: { type: 'object' } },
    });
    expect(operation('reports.downloadReport', files)).toMatchObject({
      binding: { response: 'blob' },
      output: { type: 'string', format: 'binary' },
    });
  });

  it('keeps JSON bodies and responses on the codec', () => {
    expect(operation('pets.createPet').binding).toMatchObject({ body: undefined, response: undefined });
  });

  it('skips multipart bodies it cannot send', () => {
    expect(importOpenApi(files).warnings).toEqual([
      'GET /photos: multipart request body on a GET or DELETE operation, skipped',
      'PUT /photos/{photoId}: multipart request body is not an object with identifier property names, skipped',
    ]);
  });
});

describe('generateFromOpenApi()', () => {
  it('generates a working contract', async () => {
    const { source } = generateFromOpenApi(petstore, { exportName: 'petstoreContract' });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}petstore.ts`, source);
    const { petstoreContract } = (await import(`${outputDir}petstore.ts`)) as { petstoreContract: ContractTree };

    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify([{ id: '1', name: 'Rex', nickname: null }]), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const server = createClient(petstoreContract, {
      drivers: [fetchRest({ baseUrl: 'https://pets.test', fetch: fetchMock })],
    }) as unknown as {
      pets: { listPets: (input: unknown) => Promise<unknown>; createPet: (input: unknown) => Promise<unknown> };
    };

    await expect(server.pets.listPets({ limit: 5, xTenant: 't1' })).resolves.toEqual([
      { id: '1', name: 'Rex', nickname: null },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://pets.test/pets?limit=5');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-tenant': 't1' });
    await expect(server.pets.listPets({ limit: 500, xTenant: 't1' })).rejects.toMatchObject({ kind: 'input' });
    await expect(server.pets.createPet({ age: 2 })).rejects.toMatchObject({ kind: 'input' });
  });
});

describe('generateFromOpenApi() with files', () => {
  it('generates z.file() schemas and file bindings that send and receive files', async () => {
    const { source } = generateFromOpenApi(files, { exportName: 'filesContract' });

    expect(source).toContain("rest.post('/photos', { body: 'multipart' })");
    expect(source).toContain("rest.get('/photos/:photoId', { response: 'blob' })");
    expect(source).toContain("z.file().max(5000000).mime(['image/png', 'image/jpeg'])");
    expect(source).toContain("photos: { source: 'body', schema: z.array(z.file()).optional() }");
    expect(source).toContain('output: z.file()');

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}files.ts`, source);
    const { filesContract } = (await import(`${outputDir}files.ts`)) as { filesContract: ContractTree };

    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/photos')
        ? new Response(JSON.stringify({ id: 'p1' }), { status: 201, headers: { 'content-type': 'application/json' } })
        : new Response(new Blob(['png-bytes'], { type: 'image/png' }), {
            headers: { 'content-type': 'image/png', 'content-disposition': 'attachment; filename="p1.png"' },
          }),
    );
    const client = createClient(filesContract, {
      drivers: [fetchRest({ baseUrl: 'https://files.test', fetch: fetchMock })],
    }) as unknown as {
      photos: {
        uploadPhotos: (input: unknown) => Promise<unknown>;
        downloadPhoto: (input: unknown) => Promise<File>;
      };
    };

    const cover = new File(['cover'], 'cover.png', { type: 'image/png' });

    await expect(client.photos.uploadPhotos({ cover, title: 'Holidays', price: 12.5 })).resolves.toEqual({ id: 'p1' });
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('cover') as File).name).toBe('cover.png');
    expect(body.get('price')).toBe('12.5');
    await expect(
      client.photos.uploadPhotos({ cover: new File(['x'], 'cover.gif', { type: 'image/gif' }), title: 'Holidays' }),
    ).rejects.toMatchObject({ kind: 'input' });

    const photo = await client.photos.downloadPhoto({ photoId: 'p1' });
    expect(photo).toBeInstanceOf(File);
    expect(photo.name).toBe('p1.png');
    await expect(photo.text()).resolves.toBe('png-bytes');
  });
});

describe('polycanal-openapi CLI', () => {
  it('writes the generated contract and reports warnings', () => {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}petstore.json`, JSON.stringify(petstore));
    const log = vi.fn();

    expect(run([`${outputDir}petstore.json`, `${outputDir}cli.ts`, '--export', 'api'], log)).toBe(0);
    expect(readFileSync(`${outputDir}cli.ts`, 'utf8')).toContain('export const api = defineContract({');
    expect(log).toHaveBeenCalledWith('warning: HEAD /pets: method not supported, skipped');
    expect(log).toHaveBeenLastCalledWith(`polycanal-openapi: wrote ${outputDir}cli.ts`);
  });

  it('prints the usage on missing arguments', () => {
    const log = vi.fn();

    expect(run(['only-input.json'], log)).toBe(1);
    expect(run(['in.json', 'out.ts', '--export'], log)).toBe(1);
    expect(log).toHaveBeenCalledWith('Usage: polycanal-openapi <openapi.json> <output.ts> [--export <name>]');
  });
});
