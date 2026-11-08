# Polycanal

A typed, transport-agnostic client in front of an existing back end (REST, GraphQL, WebSocket, SSE, pub/sub...). It
describes what the server exposes, without dictating how the server is written, and validates everything sent and
received.

Work in progress. See [the documentation](apps/docs) (`bun run docs`) and [the specification](docs/specs.md).

## Packages

| Package               | Role                                                                          |
|-----------------------|-------------------------------------------------------------------------------|
| `polycanal`           | Entry point, re-exports the core                                              |
| `@polycanal/core`     | Contract model, typed client, interceptors, driver interfaces, errors         |
| `@polycanal/rest`     | REST bindings (`rest.get()`...), request mapping, `fetchRest()` driver        |
| `@polycanal/angular`  | `HttpClient`-based REST driver, `actionResource()`                            |
| `@polycanal/zod`      | Zod validation driver (schema code generation)                                |
| `@polycanal/codegen`  | Contract descriptions and TypeScript source generation                        |
| `@polycanal/openapi`  | OpenAPI 3 import and `polycanal-openapi` CLI                                  |
| `@polycanal/nest`     | NestJS route discovery, `@Endpoint()` decorators, contract generation         |
| `@polycanal/express`  | Express 4/5 route discovery, `endpoint()` markers, contract generation        |

## Development

```bash
bun install
bun run test
bun run typecheck
bun run lint
bun run build
bun run docs        # documentation site in English, http://localhost:3000/polycanal/
bun run docs:fr     # in French (the dev server serves one locale at a time)
bun run build:docs  # static site with every locale, in apps/docs/build
```

## License

[MIT](LICENSE)
