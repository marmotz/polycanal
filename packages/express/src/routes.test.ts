import express4 from 'express';
import express5 from 'express5';
import { describe, expect, it } from 'vitest';
import { listRoutes, pathFromRegexp, recordMountPaths } from './routes.js';

const noop = (_request: unknown, _response: unknown) => {};

function build(express: typeof express4) {
  const app = express();
  const households = express.Router();
  const members = express.Router();
  members.put('/:userId', noop);
  households.get('/', noop);
  households.get('/:id', noop);
  households.use('/:id/members', members);
  app.use(express.json());
  app.use('/api/households', households);
  app.post('/auth/login', noop);
  app.get(/^\/legacy/, noop);
  app.route('/both').get(noop).delete(noop);

  return app;
}

const summary = (app: object) =>
  listRoutes(app).map(({ method, path, problem }) => `${method} ${path ?? `? (${problem})`}`);

describe('listRoutes()', () => {
  it('lists the routes of Express 4, rebuilding mount paths from their regular expressions', () => {
    expect(summary(build(express4))).toEqual([
      'GET /api/households',
      'GET /api/households/:id',
      'PUT /api/households/:id/members/:userId',
      'POST /auth/login',
      'GET ? (pattern or multiple paths are not supported)',
      'GET /both',
      'DELETE /both',
    ]);
  });

  it('reports unknown mount paths on Express 5 until they are recorded', () => {
    expect(summary(build(express5 as unknown as typeof express4))).toEqual([
      'GET ? (mount path unknown: call recordMountPaths(express) before mounting routers)',
      'GET ? (mount path unknown: call recordMountPaths(express) before mounting routers)',
      'PUT ? (mount path unknown: call recordMountPaths(express) before mounting routers)',
      'POST /auth/login',
      'GET ? (pattern or multiple paths are not supported)',
      'GET /both',
      'DELETE /both',
    ]);
  });

  it('lists the routes of Express 5 once mount paths are recorded', () => {
    recordMountPaths(express5);
    recordMountPaths(express5);

    expect(summary(build(express5 as unknown as typeof express4))).toEqual([
      'GET /api/households',
      'GET /api/households/:id',
      'PUT /api/households/:id/members/:userId',
      'POST /auth/login',
      'GET ? (pattern or multiple paths are not supported)',
      'GET /both',
      'DELETE /both',
    ]);
  });

  it('works on Express 4 with recorded mount paths too', () => {
    recordMountPaths(express4);

    expect(summary(build(express4))).toContain('PUT /api/households/:id/members/:userId');
  });

  it('keeps the handlers of each route', () => {
    const app = express4();
    const auth = (_request: unknown, _response: unknown, next: () => void) => next();
    app.get('/x', auth, noop);

    expect(listRoutes(app)[0]?.handlers).toEqual([auth, noop]);
  });

  it('returns nothing for an application without routes', () => {
    expect(listRoutes(express4())).toEqual([]);
    expect(listRoutes(express5())).toEqual([]);
  });
});

describe('pathFromRegexp()', () => {
  it.each<[RegExp, { name: string }[], string | undefined]>([
    [/^\/api\/households\/?(?=\/|$)/i, [], '/api/households'],
    [/^\/a(?:\/([^/]+?))\/b\/?(?=\/|$)/i, [{ name: 'id' }], '/a/:id/b'],
    [/^\/a(?:\/([^/]+?))(?:\/([^/]+?))\/?(?=\/|$)/i, [{ name: 'x' }, { name: 'y' }], '/a/:x/:y'],
    [/^\/v1\.0\/?(?=\/|$)/i, [], '/v1.0'],
    [/^\/files\/(.*)\/?(?=\/|$)/i, [], undefined],
    [/^\/a(?:\/([^/]+?))\/?(?=\/|$)/i, [], undefined],
  ])('%s → %s', (regexp, keys, expected) => {
    expect(pathFromRegexp(regexp, keys)).toBe(expected);
  });

  it('handles the root mount', () => {
    expect(pathFromRegexp(Object.assign(/^\/?(?=\/|$)/i, { fast_slash: true }), [])).toBe('');
  });
});
