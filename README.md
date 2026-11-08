# Polycanal

A typed, transport-agnostic client in front of an existing back end (REST, GraphQL, WebSocket, SSE, pub/sub...). It
describes what the server exposes, without dictating how the server is written, and validates everything sent and
received.

Work in progress. See [the specification](docs/specs.md).

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

## Development

```bash
bun install
bun run test
bun run typecheck
bun run lint
bun run build
```

## License

[MIT](LICENSE)
