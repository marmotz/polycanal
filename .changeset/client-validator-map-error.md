---
"@polycanal/core": minor
"@polycanal/zod": minor
---

`createClient()` takes a `validator`, which runs every schema of the contract (input fields included), and a
`mapError`, which turns the `PolycanalError` of a failed call or publication into the application's own error.
`@polycanal/zod` exports `zodValidator(params)`, which parses Zod schemas with parse options such as error messages.
