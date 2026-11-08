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

The client mirrors the contract tree: actions become methods, events become handles.

## Calling an action

```ts
const user = await server.users.get({ id: 'u1' });
await server.households.list();                       // no input: no argument
await server.projects.analyses();                     // only optional fields: argument optional
await server.users.get({ id: 'u1' }, { signal, context: { retry: true }, interceptors: [trace] });
```

A call:

1. validates the argument with the input schema, and sends the validated value (defaults and transforms applied);
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
