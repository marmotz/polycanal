---
title: Packages
---

# Packages

| Package              | Contenu                                                                                  |
|----------------------|------------------------------------------------------------------------------------------|
| `polycanal`          | Point d'entrée, réexporte `@polycanal/core`                                              |
| `@polycanal/core`    | `defineContract`, `action`, `event`, `input`, `createClient`, intercepteurs, interfaces des drivers, `PolycanalError`, `toModel`, `toJsonSchema`, `jsonCodec` |
| `@polycanal/rest`    | Bindings `rest.*`, répartition des requêtes, `fetchRest()`, `restTransport()`, `restBindingEmitter` |
| `@polycanal/angular` | `angularRest()`, `injectAngularRest()`, `actionResource()`                               |
| `@polycanal/zod`     | `zodDriver`, génération de code Zod 4 depuis JSON Schema                                 |
| `@polycanal/codegen` | Descriptions de contrat, `describeContract()`, `mergeDescriptions()`, `generateContractSource()` |
| `@polycanal/openapi` | `importOpenApi()`, `generateFromOpenApi()`, la commande `polycanal-openapi`              |
| `@polycanal/nest`    | `@Endpoint()`, `@EndpointNamespace()`, `nestSource()`, `discoverNestContract()`, `generateNestContract()` |
| `@polycanal/cli`     | La commande `polycanal generate`, `defineConfig()`, `generate()`                          |
| `@polycanal/express` | `endpoint()`, `listRoutes()`, `recordMountPaths()`, `discoverExpressContract()`, `generateExpressContract()` |

Prévus : `@polycanal/ws` (événements WebSocket et socket.io, import AsyncAPI), `@polycanal/graphql`.

L'API complète est générée depuis les sources dans la section **API** (en anglais).
