import { describe, expect, it } from 'vitest';
import { isPolycanalError, PolycanalError } from './errors.js';

describe('PolycanalError', () => {
  const cause = new TypeError('fetch failed');
  const error = new PolycanalError<{ reason: string }>('auth.login failed', {
    kind: 'server',
    operation: 'auth.login',
    driver: 'rest',
    key: '401',
    data: { reason: 'invalid credentials' },
    response: { status: 401 },
    cause,
  });

  it('carries structured details', () => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PolycanalError');
    expect(error.message).toBe('auth.login failed');
    expect(error).toMatchObject({
      kind: 'server',
      operation: 'auth.login',
      driver: 'rest',
      key: '401',
      data: { reason: 'invalid credentials' },
      issues: undefined,
      response: { status: 401 },
    });
    expect(error.cause).toBe(cause);
  });

  it('is recognized by isPolycanalError(), with optional filters', () => {
    expect(isPolycanalError(error)).toBe(true);
    expect(isPolycanalError(error, { kind: 'server' })).toBe(true);
    expect(isPolycanalError(error, { key: 401 })).toBe(true);
    expect(isPolycanalError(error, { kind: 'server', key: '401' })).toBe(true);
    expect(isPolycanalError(error, { kind: 'input' })).toBe(false);
    expect(isPolycanalError(error, { key: 404 })).toBe(false);
    expect(isPolycanalError(new Error('other'))).toBe(false);
  });
});
