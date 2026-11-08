---
title: Contracts
---

# Contracts

A contract describes what a server exposes. It is plain TypeScript: types are inferred from the schemas, no build step
is involved.

## `defineContract()`

```ts
import { defineContract } from '@polycanal/core';

export const householdsContract = defineContract({
  list: action({ ... }),
  updateMemberRole: action({ ... }),
});

export const contract = defineContract({
  auth: { login: action({ ... }) },   // nested object: namespace
  households: householdsContract,      // contracts compose
  notifications: event({ ... }),
});
```

- Nesting gives the namespaces of the client: `server.households.list()`.
- Contracts can be split per file and composed. A contract with a single operation is valid, which allows adopting
  Polycanal one endpoint at a time.
- Names must be non-empty and must not contain `.`: the dotted path (`households.list`) is the operation id.
- `defineContract()` checks the tree and throws a `ContractDefinitionError` locating the faulty element.

## `action()`

A request/response operation, named freely after what the server exposes (not limited to CRUD).

```ts
action({
  transport: rest.post('/auth/login', { status: 200 }),
  input: LoginRequestSchema,
  output: LoginResponseSchema,
  errors: { 401: InvalidCredentialsSchema },
  meta: { summary: 'Log in', tags: ['auth'] },
});
```

| Field       | Role                                                                                   |
|-------------|----------------------------------------------------------------------------------------|
| `transport` | Binding produced by a driver package (`rest.get()`, `rest.post()`...). Required        |
| `input`     | `input({...})` field map, or an object schema. Omitted: the action takes no argument   |
| `output`    | Schema of the response. Use `z.void()` for an empty response                           |
| `errors`    | Schemas of error bodies, keyed by HTTP status for REST                                 |
| `codec`     | Body codec override (default: JSON)                                                    |
| `meta`      | Free description (`summary`, `description`, `tags`, `deprecated`)                      |

## `input()`

`input()` describes the single argument of an action field by field, with where each field goes on the transport.
The call signature stays one flat object.

```ts
updateMemberRole: action({
  transport: rest.patch('/user/:userId'),
  input: input({
    householdId: z.string(),                                            // default rules
    userId: { source: 'path', schema: z.string() },                     // explicit source
    toUserId: { source: 'body', alias: 'userId', schema: z.string() },  // sent as body.userId
    role: HouseholdRoleSchema,
  }),
  output: z.void(),
}),

await server.households.updateMemberRole({ householdId: 'h1', userId: 'u1', toUserId: 'u2', role: 'admin' });
// PATCH /user/u1  {"householdId":"h1","userId":"u2","role":"admin"}
```

A field is either a schema (shorthand: the transport's default rules apply) or a descriptor:

| Descriptor key | Role                                                                                         |
|----------------|----------------------------------------------------------------------------------------------|
| `schema`       | Schema of the field, from any Standard Schema library                                        |
| `source`       | Where the field goes. REST: `'path'`, `'query'`, `'body'` or `'header'`. Type-checked        |
| `alias`        | Name on the wire, when it differs from the name in the call                                  |
| `root`         | The value is the whole content of its source (e.g. an array body). Requires `source`         |

Rules checked when the contract is defined (and, where possible, at compile time):

- a `source` must be supported by the binding;
- a root field must declare its source, and no other field can use that source;
- two fields cannot have the same wire name in the same source;
- the binding's required fields (REST path parameters) must exist, with the right source or none.

Fields whose schema accepts `undefined` (`.optional()`, `.default()`) are optional in the call. When every field is
optional, the argument itself can be omitted.

Passing an existing object schema (`input: LoginRequestSchema`) also works: every key follows the default rules. Its keys
are checked against path parameters at compile time only.

## `event()`

An event channel, carried by an event driver (WebSocket, SSE...). At least one of `send` and `receive` is required.

```ts
notifications: event({ transport: ws.event('notification'), receive: NotificationSchema }),
chat: event({ transport: ws.event('chat:message'), send: ChatMessageSchema, receive: ChatMessageSchema }),
```

The client exposes `publish()` only when `send` exists and `subscribe()` only when `receive` exists.

:::note

No event driver is available yet: the model and the client support events, the WebSocket driver is planned.

:::

## Inferring types

```ts
import type { ActionInputOf, ActionOutputOf, EventReceiveOf } from '@polycanal/core';

type LoginInput = ActionInputOf<typeof contract.auth.login>;
type Households = ActionOutputOf<typeof contract.households.list>;
```
