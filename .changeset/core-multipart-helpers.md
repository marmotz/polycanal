---
"@polycanal/core": minor
---

Add the server helpers `multerFileToFile()` and `validateMultipartFields()`. The first converts an uploaded multer
file (in memory or on disk) to a web `File` so that file schemas can check it; it loads `node:fs` only at run time, so
browser bundles are unaffected. The second validates the text fields of a multipart body, retrying a failing value
parsed as JSON (`"12.5"` passes a number schema, `"75001"` stays a string).
