---
title: CLI
---

# CLI

`polycanal generate` writes the front-end contracts described by a configuration file. The generated files are
contracts written like by hand: they import the runtime schemas the server validates with, so a contract generated
from decorators is used, and validates, exactly like a handwritten one.

```bash
npm install --save-dev @polycanal/cli
```

## Configuration

`polycanal.config.ts`, next to the server code:

```ts title="apps/api/polycanal.config.ts"
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { defineConfig } from '@polycanal/cli';
import { nestSource } from '@polycanal/nest';
import * as shared from '@my-app/shared';
import { AppModule } from './src/app.module';

export default defineConfig({
  source: nestSource({ app: () => NestFactory.create(AppModule, { preview: true, logger: false }) }),
  schemaModules: { '@my-app/shared': shared },
  outputs: [
    { file: '../web/src/app/api/contract.generated.ts' },
    { file: '../admin/src/app/api/contract.generated.ts', include: ['admin'], exportName: 'adminContract' },
  ],
});
```

| Option             | Role                                                                                         |
|--------------------|----------------------------------------------------------------------------------------------|
| `source`           | Where the contract comes from: `nestSource()` from `@polycanal/nest`                          |
| `schemaModules`    | Modules the generated files import schemas from, keyed by the specifier the front end uses   |
| `outputs`          | Files to write, relative to the configuration file                                           |
| `allowRegenerated` | Accepts schemas no module exports (see below). Default: `false`                               |
| `validation`       | Validation library of generated schemas. Default: Zod                                        |
| `bindings`         | Binding emitters of other drivers (REST is included)                                         |

Each output takes a `file`, an optional `exportName` (default `contract`) and an optional `include`: operation ids or
namespace prefixes to keep, to generate one contract per front-end application.

## Imported schemas

Every schema the source finds (request pipes, `@Endpoint()` responses and fields) is looked up, by identity, among the
exports of `schemaModules`. A schema found there is imported by the generated file; a request body or query described
by such a schema is kept whole as a root `body` (or `query`) field, so that its object-level rules apply:

```ts
import { listingSchema, updateListingSchema } from '@my-app/shared';

update: action({
  transport: rest.patch('/projects/:projectId/listings/:listingId'),
  input: input({
    projectId: { source: 'path', schema: idSchema },
    listingId: { source: 'path', schema: idSchema },
    body: { source: 'body', root: true, schema: updateListingSchema },
  }),
  output: listingSchema,
}),
```

A schema exported by no module would have to be generated from its JSON Schema, losing what JSON Schema cannot express
(transforms, refinements, custom messages): the generation fails and lists it. Export it from a shared module, or set
`allowRegenerated: true` to accept the loss, reported as warnings.

## Commands

```bash
polycanal generate                     # polycanal.config.{ts,mts,js,mjs} of the current directory
polycanal generate --config other.ts
polycanal generate --check             # writes nothing, fails when a file is not up to date (CI)
```

The configuration is loaded with `import()`. A TypeScript configuration needs a runtime that loads TypeScript: Bun, or
Node 22.18+ (type stripping). A Nest application using decorators needs Bun (`bun --bun polycanal generate`) or a loader
such as `tsx`.

`generate(config, { root, check })` from `@polycanal/cli` does the same programmatically.
