import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { endpoint, endpointOf } from './endpoint.js';

describe('endpoint()', () => {
  const options = { output: z.string() };

  it('is a middleware that only calls next()', () => {
    const next = vi.fn();

    endpoint(options)({}, {}, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('carries its options', () => {
    expect(endpointOf(endpoint(options))).toBe(options);
    expect(endpointOf(() => {})).toBeUndefined();
    expect(endpointOf('not a function')).toBeUndefined();
  });

  it('is found through wrappers keeping the original in a symbol property', () => {
    const original = endpoint(options);
    const wrapper = Object.assign(() => {}, { [Symbol('original')]: original });

    expect(endpointOf(wrapper)).toBe(options);
  });
});
