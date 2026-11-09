---
"@polycanal/nest": minor
---

Support file uploads. Discovery reads `@UploadedFile()` and `@UploadedFiles()` and describes the route with a multipart
body (`body: 'multipart'`). The new pipes `filePipe()`, `filesPipe()` and `multipartBodyPipe()` validate the uploaded
files with file schemas (`z.file()`) and the text fields of the body, parsing them as JSON when needed; they answer
`400` with the issues and expose their schema to discovery. Since `FileInterceptor()` field names cannot be read, the
pipes take a `field` option.
