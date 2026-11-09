---
"@polycanal/openapi": minor
---

The OpenAPI import reads `multipart/form-data` request bodies: an object body is spread into `body` fields with a
`body: 'multipart'` binding, and `encoding.<field>.contentType` becomes the `contentMediaType` of file parts, so they
generate `z.file().mime([...])`. A binary 2xx response (`format: binary`, or a binary media type without schema)
gives a `response: 'blob'` binding and a `z.file()` output. Multipart bodies that are not objects, or on `GET` /
`DELETE` operations, are skipped with a warning.
