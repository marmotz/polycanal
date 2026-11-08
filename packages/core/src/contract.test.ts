import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { restLike, wsLike } from './__fixtures__/bindings.js';
import { defineContract, toModel } from './contract.js';
import { action, event } from './definition.js';
import { ContractDefinitionError } from './errors.js';
import { input } from './input.js';

const HouseholdSchema = z.object({ id: z.string(), name: z.string() });

const householdsContract = defineContract({
  list: action({ transport: restLike('GET', '/households'), output: z.array(HouseholdSchema) }),
  updateMemberRole: action({
    transport: restLike('PATCH', '/user/:userId'),
    input: input({
      householdId: z.string(),
      userId: { source: 'path', schema: z.string() },
      toUserId: { source: 'body', alias: 'userId', schema: z.string() },
      role: z.enum(['admin', 'member']),
    }),
    output: z.void(),
  }),
});

const contract = defineContract({
  auth: {
    login: action({
      transport: restLike('POST', '/auth/login'),
      input: z.object({ email: z.string(), password: z.string() }),
      output: z.object({ token: z.string() }),
      errors: { 401: z.object({ reason: z.string() }) },
    }),
  },
  households: householdsContract,
  notifications: event({ transport: wsLike('notification'), receive: z.object({ text: z.string() }) }),
});

describe('defineContract()', () => {
  it('returns the tree unchanged', () => {
    expect(contract.households).toBe(householdsContract);
    expect(contract.auth.login.kind).toBe('action');
  });

  it('accepts a contract with a single operation', () => {
    expect(() =>
      defineContract({ ping: action({ transport: restLike('GET', '/ping'), output: z.void() }) }),
    ).not.toThrow();
  });

  it('locates errors in the tree', () => {
    const create = () => defineContract({ auth: { login: 'POST /auth/login' } } as never);

    expect(create).toThrow(ContractDefinitionError);
    expect(create).toThrow('auth.login: expected an action, an event or a namespace object');

    try {
      create();
    } catch (error) {
      expect((error as ContractDefinitionError).path).toEqual(['auth', 'login']);
      expect((error as ContractDefinitionError).reason).toBe('expected an action, an event or a namespace object');
    }
  });

  it.each([
    ['an empty name', { '': {} }, ': names must be non-empty'],
    ['a dotted name', { 'auth.login': {} }, 'auth.login: names must be non-empty and must not contain "."'],
  ])('rejects %s', (_, tree, message) => {
    expect(() => defineContract(tree as never)).toThrow(message);
  });

  it('rejects class instances and arrays as namespaces', () => {
    expect(() => defineContract({ dates: new Date() } as never)).toThrow('dates: expected an action');
    expect(() => defineContract({ list: [] } as never)).toThrow('list: expected an action');
  });
});

describe('toModel()', () => {
  it('flattens the contract into operations, in declaration order', () => {
    const model = toModel(contract);

    expect(model.operations.map(({ family, id, path }) => ({ family, id, path }))).toEqual([
      { family: 'action', id: 'auth.login', path: ['auth', 'login'] },
      { family: 'action', id: 'households.list', path: ['households', 'list'] },
      { family: 'action', id: 'households.updateMemberRole', path: ['households', 'updateMemberRole'] },
      { family: 'event', id: 'notifications', path: ['notifications'] },
    ]);
  });

  it('exposes the field mapping of input() and leaves plain object schemas opaque', () => {
    const [login, list, updateMemberRole] = toModel(contract).operations;

    expect(login?.family === 'action' && login.input?.fields).toBeUndefined();
    expect(login?.family === 'action' && Object.keys(login.errors)).toEqual(['401']);
    expect(list?.family === 'action' && list.input).toBeUndefined();
    expect(
      updateMemberRole?.family === 'action' &&
        updateMemberRole.input?.fields?.map(({ name, wireName, source }) => [name, wireName, source]),
    ).toEqual([
      ['householdId', 'householdId', undefined],
      ['userId', 'userId', 'path'],
      ['toUserId', 'userId', 'body'],
      ['role', 'role', undefined],
    ]);
  });

  it('keeps the event schemas', () => {
    const notifications = toModel(contract).operations[3];

    expect(notifications).toMatchObject({ family: 'event', send: undefined, transport: { name: 'notification' } });
    expect(notifications?.family === 'event' && notifications.receive).toBe(contract.notifications.receive);
  });

  it('checks the tree it is given', () => {
    expect(() => toModel({ broken: 42 } as never)).toThrow('broken: expected an action');
  });
});
