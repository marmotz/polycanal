import { describe, expect, it } from 'vitest';
import { jsonCodec, matchesContentType } from './codec.js';

describe('jsonCodec', () => {
  it('encodes and decodes JSON', () => {
    expect(jsonCodec.contentType).toBe('application/json');
    expect(jsonCodec.encode({ id: 1, tags: ['a'] })).toBe('{"id":1,"tags":["a"]}');
    expect(jsonCodec.decode('{"id":1}')).toEqual({ id: 1 });
  });

  it('decodes an empty body to undefined', () => {
    expect(jsonCodec.decode('')).toBeUndefined();
    expect(jsonCodec.decode('  \n')).toBeUndefined();
  });

  it('throws on invalid JSON', () => {
    expect(() => jsonCodec.decode('{')).toThrow(SyntaxError);
  });
});

describe('matchesContentType()', () => {
  it.each([
    ['application/json', true],
    ['application/json; charset=utf-8', true],
    ['Application/JSON', true],
    ['application/problem+json', true],
    ['text/plain', false],
    ['application/jsonp', false],
    ['', false],
    [null, false],
  ])('%s matches application/json: %s', (header, expected) => {
    expect(matchesContentType(header, 'application/json')).toBe(expected);
  });
});
