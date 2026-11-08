---
"@polycanal/nest": minor
"@polycanal/express": minor
---

Responses are checked on the server. `@Endpoint({ output })` makes TypeScript refuse a handler whose return type does
not match the response schema, and `EndpointOutputInterceptor` validates each answer at runtime (`onInvalid`: `'throw'`,
`'log'` or a function). On Express, `validateResponses(app)` does the same for every `endpoint()` route.
