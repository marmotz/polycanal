---
"@polycanal/rest": minor
"@polycanal/angular": minor
---

`angularRest()` takes an `httpContext` option to give each request an `HttpContext` built from its call, and lets
`HttpClient` serialize and parse JSON bodies, so Angular interceptors see objects as with a direct `HttpClient` call.
`HttpSender` receives the action call as a third argument, and a sender can return an already decoded `body`.
