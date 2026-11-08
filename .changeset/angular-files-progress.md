---
"@polycanal/angular": minor
---

`angularRest()` passes multipart bodies to `HttpClient` as `FormData`, reads `response: 'blob'` bindings with
`responseType: 'blob'` (resolved to a `File`), and reports `onUploadProgress` and `onDownloadProgress` from the
`HttpClient` progress events (`reportProgress`), with the estimated progress of each uploaded file. Upload progress
needs the `XMLHttpRequest` backend (`withXhr()`). Without a progress callback, requests are unchanged.
