import 'reflect-metadata';
import { mkdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { action, type ContractTree, createClient, defineContract, input } from '@polycanal/core';
import { fetchRest, rest } from '@polycanal/rest';
import { register } from '@reflet/express';
import express from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AuthRouter, HouseholdsRouter } from './__fixtures__/reflet.js';
import { discoverExpressContract } from './discover.js';
import { endpoint } from './endpoint.js';
import { generateExpressContract } from './generate.js';

const outputDir = fileURLToPath(new URL('../.test-output/', import.meta.url));

afterAll(() => rmSync(outputDir, { recursive: true, force: true }));

function refletApp() {
  const app = express();
  app.use(express.json());
  register(app, [HouseholdsRouter, AuthRouter]);

  return app;
}

function plainApp(app = express()) {
  const projects = express.Router();
  projects.get(
    '/:id/analyses',
    endpoint({ input: { page: z.coerce.number().default(1) }, output: z.object({ id: z.string(), page: z.number() }) }),
    (request, response) => {
      response.json({ id: request.params.id, page: Number(request.query.page ?? 1) });
    },
  );
  projects.delete('/:id', endpoint({ name: 'remove', output: z.void(), status: 204 }), (_request, response) => {
    response.status(204).end();
  });
  projects.post(
    '/:id/rename',
    endpoint({
      name: 'rename',
      input: z.object({ name: z.string() }),
      output: z.object({ id: z.string(), name: z.string() }),
    }),
    (request, response) => {
      response.json({ id: request.params.id, name: request.body.name });
    },
  );
  app.use(express.json());
  app.use('/projects', projects);
  app.get('/health', (_request, response) => {
    response.send('ok');
  });
  app.get(/^\/legacy/, endpoint({ output: z.string() }), (_request, response) => {
    response.send('legacy');
  });

  return app;
}

function operation(discovery: ReturnType<typeof discoverExpressContract>, id: string) {
  const found = discovery.description.operations.find((candidate) => candidate.path.join('.') === id);

  if (found?.family !== 'action') {
    throw new Error(`no action ${id}`);
  }

  return found;
}

describe('discoverExpressContract()', () => {
  it('describes @reflet/express routes marked with @Use(endpoint())', () => {
    const discovery = discoverExpressContract(refletApp());

    expect(discovery.description.operations.map((candidate) => candidate.path.join('.'))).toEqual([
      'households.get',
      'households.updateMemberRole',
      'auth.login',
    ]);
    expect(discovery.report.undescribed.map(({ method, path }) => `${method} ${path}`)).toEqual(['GET /households']);
    expect(operation(discovery, 'households.updateMemberRole')).toMatchObject({
      binding: { method: 'PATCH', path: '/households/:id/members/:userId' },
      input: {
        kind: 'fields',
        fields: [
          { name: 'id', required: true },
          { name: 'userId', source: 'path' },
          { name: 'toUserId', source: 'body', alias: 'userId' },
          { name: 'role', schema: { enum: ['admin', 'member'] } },
        ],
      },
    });
    expect(operation(discovery, 'auth.login')).toMatchObject({
      input: { kind: 'schema', schema: { type: 'object', required: ['email', 'password'] } },
      errors: { 401: { type: 'object' } },
    });
  });

  it('describes plain Express routes, adding the path parameters and default names', () => {
    const discovery = discoverExpressContract(plainApp());

    expect(operation(discovery, 'getProjectsByIdAnalyses')).toMatchObject({
      binding: { method: 'GET', path: '/projects/:id/analyses' },
      input: {
        kind: 'fields',
        fields: [
          { name: 'page', required: false },
          { name: 'id', source: 'path', required: true, schema: { type: 'string' } },
        ],
      },
    });
    expect(operation(discovery, 'remove')).toMatchObject({
      binding: { status: [204] },
      output: { 'x-polycanal-void': true },
    });
    expect(operation(discovery, 'rename').input).toMatchObject({
      kind: 'fields',
      fields: [
        { name: 'name', required: true },
        { name: 'id', source: 'path', required: true },
      ],
    });
    expect(discovery.report.undescribed.map(({ path }) => path)).toEqual(['/health']);
    expect(discovery.report.skipped).toMatchObject([
      { route: { method: 'GET' }, reason: 'pattern or multiple paths are not supported' },
    ]);
  });

  it('gives the config the priority and reports conflicts', () => {
    const config = defineContract({
      auth: {
        login: action({
          transport: rest.post('/v2/auth/login'),
          input: input({ email: z.string() }),
          output: z.string(),
        }),
      },
    });
    const discovery = discoverExpressContract(refletApp(), { config });

    expect(operation(discovery, 'auth.login').binding).toMatchObject({ path: '/v2/auth/login' });
    expect(discovery.report.conflicts).toEqual([
      { operation: 'auth.login', reason: 'config declares POST /v2/auth/login, discovered POST /auth/login' },
    ]);
  });

  it('rejects an input schema that is not an object', () => {
    const app = express();
    app.post('/x', endpoint({ input: z.string(), output: z.string() }), () => {});

    expect(() => discoverExpressContract(app)).toThrow(
      'POST /x: endpoint input must be an object schema or a field map',
    );
  });
});

describe('generateExpressContract()', () => {
  it('generates a front-end contract that calls the real application', async () => {
    mkdirSync(outputDir, { recursive: true });
    // Sub-applications (`app.use(otherApp)`) hide their routes behind a closure: routes are added to one app
    const app = plainApp(refletApp());
    const file = `${outputDir}contract.ts`;

    const { report } = generateExpressContract(app, { output: file, exportName: 'api' });
    expect(report.skipped).toHaveLength(1);

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const { api } = (await import(file)) as { api: ContractTree };
      const client = createClient(api, { drivers: [fetchRest({ baseUrl })] }) as unknown as {
        auth: { login: (input: unknown) => Promise<unknown> };
        households: {
          get: (input: unknown) => Promise<unknown>;
          updateMemberRole: (input: unknown) => Promise<unknown>;
        };
        getProjectsByIdAnalyses: (input: unknown) => Promise<unknown>;
        remove: (input: unknown) => Promise<unknown>;
      };

      await expect(client.auth.login({ email: 'ada@example.com', password: 'pw' })).resolves.toEqual({
        token: 'token-for-ada@example.com',
      });
      await expect(client.households.get({ id: 'h1' })).resolves.toEqual({ id: 'h1', name: 'Home' });
      await expect(
        client.households.updateMemberRole({ id: 'h1', userId: 'u1', toUserId: 'u2', role: 'admin' }),
      ).resolves.toEqual({ id: 'h1', userId: 'u1', target: 'u2', role: 'admin' });
      await expect(client.getProjectsByIdAnalyses({ id: 'p1', page: 2 })).resolves.toEqual({ id: 'p1', page: 2 });
      await expect(client.remove({ id: 'p1' })).resolves.toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
