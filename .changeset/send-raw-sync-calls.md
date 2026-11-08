---
"@polycanal/core": minor
---

A valid argument is now sent as the caller gave it, restricted to the declared fields: the server validates it again
with the same schemas and applies the transforms and defaults once, instead of twice. `send: 'parsed'` (on the client
or per operation) keeps sending the output of the schemas, for servers that do not validate again. Up to the driver's
`send()`, a call now runs synchronously when its schemas are, so the request leaves during the call.
`validateJsonResponse()` validates a value as JSON carries it, for server adapters.
