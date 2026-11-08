---
"@polycanal/nest": patch
---

Discovery reads the controllers from the application's own container instead of `@nestjs/core` tokens, so it works
when another copy of Nest is resolved (linked package, several Nest versions). A root field given to `@Endpoint()`
replaces the fields discovered in its source.
