---
title: Installation
---

# Installation

Polycanal is split into small packages under the `@polycanal/*` scope. Install the core, the REST driver and a schema
library:

```bash
npm install @polycanal/core @polycanal/rest zod
```

Add the packages you need on top:

| Need                                         | Package              |
|----------------------------------------------|----------------------|
| Angular `HttpClient` driver and resources    | `@polycanal/angular` |
| Generate a contract from an OpenAPI document | `@polycanal/openapi` |
| Generate a contract from a NestJS app        | `@polycanal/nest`    |
| Generate a contract from an Express app      | `@polycanal/express` |

The `polycanal` package re-exports `@polycanal/core`.

## Requirements

- **ESM only.** Node 22.12+ and Bun load the packages from ESM and, through `require(esm)`, from CommonJS projects
  (a default NestJS build, for example).
- **Runtimes:** Node and Bun on the back end, any modern browser on the front end.
- **TypeScript:** use `moduleResolution` set to `bundler`, `node16` or `nodenext`, so that the package `exports` are
  resolved.
- **Schemas:** any library implementing [Standard Schema](https://standardschema.dev/). Code generation needs
  [Standard JSON Schema](https://standardschema.dev/json-schema) too, which Zod 4.2+ implements.
