---
"@polycanal/rest": minor
"@polycanal/angular": minor
---

REST bindings accept `body: 'multipart'` and `response: 'blob'`, emitted by `restBindingEmitter`. A multipart binding
sends its body fields as `FormData` (files as is, one part per array item, text values like the query string); a blob
binding delivers a success response as a `File` named from `Content-Disposition`. `multipartParts()` and
`fileProgress()` estimate the progress of each file of a multipart body.

Breaking: `HttpRequest.body` is now `string | FormData | undefined`, and `RawHttpResponse` gains `blob`. Interceptors
that read `request.body` as a string must check its type. `angularRest()` passes a `FormData` body to `HttpClient`
as is.
