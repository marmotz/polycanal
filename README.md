# Polycanal

A typed, transport-agnostic client in front of an existing back end (REST, GraphQL, WebSocket, SSE, pub/sub...). It
describes what the server exposes, without dictating how the server is written, and validates everything sent and
received.

Work in progress. See [the specification](docs/specs.md).

## Packages

| Package           | Role                                                                 |
|-------------------|----------------------------------------------------------------------|
| `polycanal`       | Entry point, re-exports the core                                     |
| `@polycanal/core` | Contract model: `defineContract`, `action`, `event`, `input`, `toModel` |

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
