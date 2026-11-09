---
"@polycanal/express": minor
---

Support file uploads behind multer: discovery recognizes the multer middleware of a route and describes a multipart
body (`body: 'multipart'`) with the `z.file()` fields of `endpoint({ input })`, and reports a `warnings` list (multer
without file field, `endpoint()` before multer). `endpoint()` validates the uploaded files and the text fields of
`req.body` (parsed as JSON when needed) before the handler, replaces `req.body` with the schemas' output, and answers
`400` with `{ message, issues }` on failure.
