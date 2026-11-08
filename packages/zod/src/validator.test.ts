import { action, createClient, defineContract, input, type StandardSchemaV1 } from '@polycanal/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodValidator } from './validator.js';

const french = zodValidator({ error: () => 'Valeur invalide.' });

describe('zodValidator()', () => {
  it('parses Zod schemas with the given params', async () => {
    const result = (await french(z.object({ age: z.number() }), { age: 'x' })) as StandardSchemaV1.FailureResult;

    expect(result.issues).toEqual([{ message: 'Valeur invalide.', path: ['age'] }]);
  });

  it('keeps the messages a schema gives itself', async () => {
    const result = (await french(z.string().min(1, 'Obligatoire.'), '')) as StandardSchemaV1.FailureResult;

    expect(result.issues[0]?.message).toBe('Obligatoire.');
  });

  it('returns the parsed value, transforms applied', async () => {
    expect(await french(z.string().trim(), '  a ')).toEqual({ value: 'a' });
  });

  it('parses schemas with async refinements', async () => {
    const schema = z.string().refine(async (value) => value === 'ok');

    expect(await french(schema, 'ok')).toEqual({ value: 'ok' });
    expect(await french(schema, 'ko')).toEqual({ issues: [{ message: 'Valeur invalide.', path: [] }] });
  });

  it('leaves the schemas of other libraries to Standard Schema', async () => {
    const other: StandardSchemaV1<string> = {
      '~standard': { version: 1, vendor: 'other', validate: () => ({ issues: [{ message: 'other' }] }) },
    };

    expect(await french(other, 'x')).toEqual({ issues: [{ message: 'other' }] });
  });

  it('gives its messages to the client, input() fields included', async () => {
    const contract = defineContract({
      users: {
        get: action({
          transport: { driver: 'none', family: 'action' } as never,
          input: input({ id: z.number() }),
          output: z.unknown(),
        }),
      },
    });
    const server = createClient(contract, {
      drivers: [
        {
          name: 'none',
          action: { prepare: () => ({}), send: () => ({}), read: () => ({ ok: true, body: 1 }) },
        } as never,
      ],
      validator: french,
    });

    await expect(server.users.get({ id: 'x' as never })).rejects.toMatchObject({
      kind: 'input',
      issues: [{ message: 'Valeur invalide.', path: ['id'] }],
    });
  });
});
