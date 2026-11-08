---
title: Packages
---

# Packages

| Package              | Content                                                                                  |
|----------------------|------------------------------------------------------------------------------------------|
| `polycanal`          | Entry point, re-exports `@polycanal/core`                                                |
| `@polycanal/core`    | `defineContract`, `action`, `event`, `input`, `createClient`, interceptors, driver interfaces, `PolycanalError`, `toModel`, `toJsonSchema`, `jsonCodec` |
| `@polycanal/rest`    | `rest.*` bindings, request mapping, `fetchRest()`, `restTransport()`, `restBindingEmitter` |
| `@polycanal/angular` | `angularRest()`, `injectAngularRest()`, `actionResource()`                               |
| `@polycanal/zod`     | `zodDriver`, Zod 4 code generation from JSON Schema                                      |
| `@polycanal/codegen` | Contract descriptions, `describeContract()`, `mergeDescriptions()`, `generateContractSource()` |
| `@polycanal/openapi` | `importOpenApi()`, `generateFromOpenApi()`, the `polycanal-openapi` CLI                  |
| `@polycanal/nest`    | `@Endpoint()`, `@EndpointNamespace()`, `nestSource()`, `discoverNestContract()`, `generateNestContract()` |
| `@polycanal/cli`     | The `polycanal generate` command, `defineConfig()`, `generate()`                          |
| `@polycanal/express` | `endpoint()`, `listRoutes()`, `recordMountPaths()`, `discoverExpressContract()`, `generateExpressContract()` |

Planned: `@polycanal/ws` (WebSocket and socket.io events, AsyncAPI import), `@polycanal/graphql`.

The full API is generated from the sources in the **API** section.
