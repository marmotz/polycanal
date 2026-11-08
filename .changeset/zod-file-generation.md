---
"@polycanal/zod": minor
---

The generator emits `z.file()` for a binary string (`type: 'string'` with `format: 'binary'`, with or without
`contentEncoding`, OpenAPI 3.0 included), with `.min()` / `.max()` from `minLength` / `maxLength` and `.mime([...])`
from `contentMediaType` or an `anyOf` of `contentMediaType`, so a `z.file()` schema round-trips through JSON Schema.
