---
title: Quick start
---

# Quick start

This example describes three endpoints of an existing REST API and calls them from a typed client.

## 1. Describe the endpoints

A contract is a tree of plain objects: nesting gives namespaces, leaves are operations. Each action says how it is
carried (`transport`), what it takes (`input`) and what it returns (`output`).

```ts title="contract.ts"
import { action, defineContract, input } from '@polycanal/core';
import { rest } from '@polycanal/rest';
import { z } from 'zod';

const HouseholdSchema = z.object({ id: z.string(), name: z.string() });

export const contract = defineContract({
  auth: {
    login: action({
      transport: rest.post('/auth/login'),
      input: z.object({ email: z.email(), password: z.string() }),
      output: z.object({ token: z.string() }),
      errors: { 401: z.object({ message: z.string() }) },
    }),
  },
  households: {
    list: action({
      transport: rest.get('/households'),
      output: z.array(HouseholdSchema),
    }),
    rename: action({
      transport: rest.patch('/households/:id'),
      input: input({ id: z.string(), name: z.string().min(1) }),
      output: HouseholdSchema,
    }),
  },
});
```

The contract imports no server code: put it in a package or a directory shared by the back end and the front end.

## 2. Create the client

```ts title="server.ts"
import { createClient } from '@polycanal/core';
import { fetchRest } from '@polycanal/rest';
import { contract } from './contract';

export const server = createClient(contract, {
  drivers: [fetchRest({ baseUrl: 'https://api.example.com' })],
});
```

## 3. Call it

```ts
const { token } = await server.auth.login({ email: 'ada@example.com', password: 'secret' });
// POST https://api.example.com/auth/login  {"email":"ada@example.com","password":"secret"}

const households = await server.households.list();
// GET https://api.example.com/households

const home = await server.households.rename({ id: 'h1', name: 'Home' });
// PATCH https://api.example.com/households/h1  {"name":"Home"}
```

- `id` goes to the path because `/households/:id` declares it; the other fields of a `PATCH` go to the body. See the
  [REST binding rules](../guides/rest.md).
- Arguments and return values are typed from the schemas. A missing path parameter is a compile error.
- An invalid argument throws a `PolycanalError` of kind `input` before anything is sent; an invalid response throws one
  of kind `output`. See [errors](../guides/errors.md).

## Next steps

- Map fields explicitly (path, query, body, headers, aliases) with [`input()`](../guides/contracts.md).
- Add authentication with [interceptors](../guides/interceptors.md).
- Generate the contract instead of writing it: from [OpenAPI](../guides/code-generation.md),
  [NestJS](../guides/nestjs.md) or [Express](../guides/express.md).
