---
title: Client
---

# Client

## `createClient()`

```ts
import { createClient } from '@polycanal/core';
import { fetchRest } from '@polycanal/rest';

const server = createClient(contract, {
  drivers: [fetchRest({ baseUrl: '/api' })],
  interceptors: [logging],                                   // every call
  operations: { households: { interceptors: [tenant] } },   // one operation or a whole namespace
});
```

- `drivers`: driver implementations, as an array or an object. Each binding is carried by the driver whose name
  matches its `driver` (`'rest'` for `rest.*` bindings).
- `interceptors` and `operations`: see [interceptors](./interceptors.md).
- `send`: what a valid argument sends, see [what a call sends](#what-a-call-sends).
- `validator`: runs every schema of the contract, see [validation options](#validation-options).
- `mapError`: turns a failure into the application's own error, see [mapping errors](#mapping-errors).

The client mirrors the contract tree: actions become methods, events become handles.

## Calling an action

```ts
const user = await server.users.get({ id: 'u1' });
await server.households.list();                       // no input: no argument
await server.projects.analyses();                     // only optional fields: argument optional
await server.users.get({ id: 'u1' }, { signal, context: { retry: true }, interceptors: [trace] });
```

A call:

1. validates the argument with the input schema, then sends it as given (see [what a call sends](#what-a-call-sends));
2. builds the native request, runs it through the interceptor chain and sends it;
3. reads the response: a success is validated with the output schema and returned, an error is validated with the
   matching `errors` schema and thrown.

Call options:

| Option         | Role                                                                     |
|----------------|--------------------------------------------------------------------------|
| `signal`       | `AbortSignal` cancelling the request                                     |
| `context`      | Free data visible to interceptors and drivers                            |
| `interceptors` | Interceptors of this call only, typed with the driver's native request   |

## Events

```ts
const unsubscribe = server.notifications.subscribe((notification) => show(notification), {
  onError: (error) => console.warn(error), // invalid messages and transport failures
});

await server.chat.publish({ text: 'hello' });
```

Published messages are validated before sending, received messages before reaching the listener.

## What a call sends

The server validates what it receives again, with the same schemas: a front-end client is not the only one that can
call it. So by default (`send: 'raw'`), a valid argument is sent as the caller gave it, restricted to the declared
fields, and the server applies the transforms and defaults once. Running them on both sides would apply them twice:
`z.number().transform((euros) => euros * 100)` would turn 12 into 1200 on the client, then into 120000 on the server.

When the server does not validate again (a third-party API), `send: 'parsed'` sends the output of the schemas, for the
whole client or for some operations:

```ts
createClient(contract, {
  drivers,
  operations: { partners: { send: 'parsed' } }, // one operation or a whole namespace
});
```

Up to the driver's `send()`, a call runs synchronously when its schemas are: the request leaves during the call, so
tests can expect it right after calling, without waiting.

## Validation options

Standard Schema validates a value without options, so library settings such as Zod's error messages cannot reach it.
`validator` replaces the way every schema runs (input fields, responses, error bodies, event messages):

```ts
import { zodValidator } from '@polycanal/zod';

const server = createClient(contract, {
  drivers: [fetchRest({ baseUrl: '/api' })],
  validator: zodValidator({ error: frenchMessage }), // what schema.safeParse(value, params) takes
});
```

`zodValidator()` parses Zod schemas with these options and leaves the schemas of other libraries to Standard Schema.
Any function `(schema, value) => result` fits, for another library.

## Mapping errors

Every failed call rejects with a `PolycanalError` (see [errors](./errors.md)). When the application has its own error
type, `mapError` converts it once for every action call and event publication:

```ts
const server = createClient(contract, {
  drivers: [fetchRest({ baseUrl: '/api' })],
  mapError: (error) => (error.kind === 'input' ? new FormError(error.issues) : error),
});
```

Errors that are not a `PolycanalError` (thrown by an interceptor, for instance) are rethrown untouched. The `onError`
of `subscribe()` still receives the `PolycanalError`.
