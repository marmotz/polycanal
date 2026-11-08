import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateJsonResponse } from './response.js';

describe('validateJsonResponse()', () => {
  it('validates the value as JSON carries it', async () => {
    const schema = z.object({ at: z.string() });

    expect(await validateJsonResponse(schema, { at: new Date('2026-11-08T10:00:00.000Z') })).toEqual({
      value: { at: '2026-11-08T10:00:00.000Z' },
    });
  });

  it('reports what does not match', async () => {
    const result = (await validateJsonResponse(z.object({ id: z.number() }), { id: 'x' })) as StandardSchemaV1Failure;

    expect(result.issues[0]?.path).toEqual(['id']);
  });

  it('validates an absent body as undefined', async () => {
    expect(await validateJsonResponse(z.void(), undefined)).toEqual({ value: undefined });
  });
});

type StandardSchemaV1Failure = { issues: readonly { path?: readonly unknown[] }[] };
