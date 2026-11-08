import 'reflect-metadata';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { action, type ContractTree, createClient, defineContract } from '@polycanal/core';
import { fetchRest, rest } from '@polycanal/rest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AuthController,
  HouseholdsController,
  ProjectsController,
  ZOD_RESPONSE_SCHEMA_KEY,
} from './__fixtures__/app.js';
import { discoverNestContract, type NestDiscoveryOptions } from './discover.js';
import { generateNestContract } from './generate.js';

const outputDir = fileURLToPath(new URL('../.test-output/', import.meta.url));
const outputOf: NestDiscoveryOptions['outputOf'] = (controller, handler) =>
  Reflect.getMetadata(ZOD_RESPONSE_SCHEMA_KEY, controller.prototype[handler]);

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController, HouseholdsController, ProjectsController],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.init();
});

afterAll(async () => {
  await app.close();
  rmSync(outputDir, { recursive: true, force: true });
});

function operation(discovery: ReturnType<typeof discoverNestContract>, id: string) {
  const found = discovery.description.operations.find((candidate) => candidate.path.join('.') === id);

  if (found?.family !== 'action') {
    throw new Error(`no action ${id}`);
  }

  return found;
}

describe('discoverNestContract()', () => {
  it('describes decorated routes only, by default', () => {
    const discovery = discoverNestContract(app);

    expect(discovery.description.operations.map((candidate) => candidate.path.join('.'))).toEqual([
      'auth.login',
      'households.list',
      'households.updateMemberRole',
      'households.remove',
      'households.importMembers',
    ]);
    expect(discovery.report.undescribed.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/auth/logout',
      'GET /api/projects/search',
      'GET /api/projects/raw',
    ]);
    expect(discovery.report.skipped).toEqual([
      {
        route: { controller: 'HouseholdsController', handler: 'broken', method: 'GET', path: '/api/households/broken' },
        reason: 'no response schema (use @Endpoint({ output }) or the outputOf option)',
      },
      {
        route: {
          controller: 'ProjectsController',
          handler: 'analyses',
          method: 'GET',
          path: '/api/projects/:id/analyses',
        },
        reason: 'no response schema (use @Endpoint({ output }) or the outputOf option)',
      },
    ]);
  });

  it('reads the schemas of the existing Zod pipes and the HTTP code', () => {
    expect(operation(discoverNestContract(app), 'auth.login')).toMatchObject({
      binding: { driver: 'rest', method: 'POST', path: '/api/auth/login', status: [200] },
      input: {
        kind: 'fields',
        fields: [
          { name: 'email', source: 'body', required: true, schema: { type: 'string', format: 'email' } },
          { name: 'password', source: 'body', required: true, schema: { type: 'string', minLength: 8 } },
        ],
      },
      output: { type: 'object', required: ['token'] },
      errors: { 401: { type: 'object' } },
    });
  });

  it('keeps path parameters and aliases colliding body fields', () => {
    expect(operation(discoverNestContract(app), 'households.updateMemberRole').input).toEqual({
      kind: 'fields',
      fields: [
        { name: 'householdId', source: 'path', schema: { type: 'string' }, required: true },
        { name: 'userId', source: 'path', schema: { type: 'string' }, required: true },
        { name: 'role', source: 'body', schema: { type: 'string', enum: ['admin', 'member'] }, required: true },
        { name: 'bodyUserId', alias: 'userId', source: 'body', schema: { type: 'string' }, required: true },
      ],
    });
  });

  it('adds path parameters read without key and sends non-object bodies as root', () => {
    const discovery = discoverNestContract(app);

    expect(operation(discovery, 'households.remove')).toMatchObject({
      binding: { method: 'DELETE', path: '/api/households/:id', status: [204] },
      input: { fields: [{ name: 'id', source: 'path', required: true }] },
    });
    expect(operation(discovery, 'households.importMembers').input).toMatchObject({
      fields: [{ name: 'body', source: 'body', root: true, required: true, schema: { type: 'array' } }],
    });
  });

  it('applies decorator overrides, namespaces and reports raw parameters', () => {
    const discovery = discoverNestContract(app, { outputOf });

    expect(operation(discovery, 'work.projects.analyses')).toMatchObject({
      binding: { method: 'GET', path: '/api/projects/:id/analyses' },
      input: {
        fields: [
          { name: 'id', source: 'path' },
          { name: 'x-tenant', source: 'header', required: false, schema: { type: 'string' } },
          { name: 'page', required: false, schema: { type: 'integer' } },
          { name: 'limit', source: 'query', required: false, schema: { type: 'string' } },
        ],
      },
    });
    expect(discovery.report.warnings).toEqual([
      'GET /api/projects/:id/analyses: "x-tenant" has no runtime schema, described as a string',
      'GET /api/projects/:id/analyses: "limit" has no runtime schema, described as a string',
    ]);
  });

  it('describes every route it can with include: all', () => {
    const discovery = discoverNestContract(app, { include: 'all', outputOf });

    expect(operation(discovery, 'work.projects.search').input).toMatchObject({
      fields: [
        { name: 'q', source: 'query', required: true },
        { name: 'tags', source: 'query', required: false },
      ],
    });
    expect(discovery.report.undescribed).toEqual([]);
    expect(discovery.report.skipped.map(({ route, reason }) => `${route.handler}: ${reason}`)).toEqual([
      'logout: no response schema (use @Endpoint({ output }) or the outputOf option)',
      'broken: no response schema (use @Endpoint({ output }) or the outputOf option)',
      'raw: no response schema (use @Endpoint({ output }) or the outputOf option)',
    ]);
  });

  it('gives the config the priority and reports conflicts', () => {
    const config = defineContract({
      auth: {
        login: action({
          transport: rest.post('/api/v2/auth/login'),
          input: z.object({ email: z.string() }),
          output: z.string(),
        }),
      },
    });
    const discovery = discoverNestContract(app, { config });

    expect(operation(discovery, 'auth.login').binding).toMatchObject({ path: '/api/v2/auth/login' });
    expect(discovery.report.conflicts).toEqual([
      { operation: 'auth.login', reason: 'config declares POST /api/v2/auth/login, discovered POST /api/auth/login' },
    ]);
  });

  it('accepts an explicit global prefix and a custom pipe reader', () => {
    const discovery = discoverNestContract(app, { globalPrefix: '', schemaOf: () => undefined });

    expect(operation(discovery, 'households.list').binding).toMatchObject({ path: '/households' });
    expect(operation(discovery, 'auth.login').input).toBeUndefined();
    expect(discovery.report.warnings).toContain(
      'POST /auth/login: whole @Body() without runtime schema, not described',
    );
  });
});

describe('generateNestContract()', () => {
  it('generates a front-end contract that calls the real application', async () => {
    mkdirSync(outputDir, { recursive: true });
    const file = `${outputDir}contract.ts`;
    const { report } = generateNestContract(app, { output: file, outputOf, exportName: 'api' });

    expect(report.skipped.map(({ route }) => route.handler)).toEqual(['broken']);
    expect(readFileSync(file, 'utf8')).toContain('export const api = defineContract({');

    await app.listen(0);
    const { api } = (await import(file)) as { api: ContractTree };
    const server = createClient(api, { drivers: [fetchRest({ baseUrl: await app.getUrl() })] }) as unknown as {
      auth: { login: (input: unknown) => Promise<unknown> };
      households: {
        list: () => Promise<unknown>;
        updateMemberRole: (input: unknown) => Promise<unknown>;
        remove: (input: unknown) => Promise<unknown>;
        importMembers: (input: unknown) => Promise<unknown>;
      };
      work: { projects: { analyses: (input: unknown) => Promise<unknown> } };
    };

    await expect(server.auth.login({ email: 'ada@example.com', password: 'correct-password' })).resolves.toEqual({
      token: 'token-for-ada@example.com',
    });
    await expect(server.auth.login({ email: 'ada@example.com', password: 'wrong-password' })).rejects.toMatchObject({
      kind: 'server',
      key: '401',
      data: { message: 'invalid credentials' },
    });
    await expect(server.auth.login({ email: 'nope', password: 'x' })).rejects.toMatchObject({ kind: 'input' });
    await expect(server.households.list()).resolves.toEqual([{ id: 'h1', name: 'Home' }]);
    await expect(
      server.households.updateMemberRole({ householdId: 'h1', userId: 'u1', bodyUserId: 'u2', role: 'admin' }),
    ).resolves.toEqual({ householdId: 'h1', userId: 'u1', role: 'admin', target: 'u2' });
    await expect(server.households.remove({ id: 'h1' })).resolves.toBeUndefined();
    await expect(server.households.importMembers({ body: ['u1', 'u2'] })).resolves.toEqual({ count: 2 });
    await expect(server.work.projects.analyses({ id: 'p1', page: 3, limit: '5', 'x-tenant': 't1' })).resolves.toEqual({
      id: 'p1',
      page: 3,
      limit: 5,
      tenant: 't1',
    });
  });
});
