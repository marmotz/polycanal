---
"@polycanal/rest": minor
---

`fetchRest()` reports `onUploadProgress` and `onDownloadProgress`, and sends `FormData` bodies and reads `blob`
responses. With `onUploadProgress`, the request is sent with `XMLHttpRequest` when there is one (browsers), or
otherwise streamed to `fetch` through a byte counter (Node, Bun); the new `XMLHttpRequest` option replaces the global
one, `null` forcing the counted stream. `onDownloadProgress` reads the response body chunk by chunk. Cancelling with
`signal` aborts the request in every case.
