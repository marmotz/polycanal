---
title: REST
---

# REST

`@polycanal/rest` describes REST endpoints and carries them with `fetch`.

## Bindings

```ts
import { rest } from '@polycanal/rest';

rest.get('/households');
rest.post('/auth/login', { status: 200 });
rest.put('/users/:id');
rest.patch('/households/:householdId/members/:userId');
rest.delete('/households/:id', { status: [200, 204] });
```

- Path parameters are `:name` segments. Each one must match an input field, which is checked at compile time and when
  the action is defined.
- `status` lists the success status codes. Default: any 2xx status. Any other status is a server error.
- `body: 'multipart'` sends the body fields as `multipart/form-data` (see [File uploads](#file-uploads)). Not allowed
  on `GET` and `DELETE`.
- `response: 'blob'` delivers a success response as a `File` (see [Binary responses](#binary-responses)).

## Mapping rules

Each input field goes to one place of the request:

1. its explicit `source`, when it has one;
2. otherwise the **path**, when its wire name is a path parameter;
3. otherwise the **query string** for `GET` and `DELETE`, the **body** for `POST`, `PUT` and `PATCH`.

Values are written as follows:

| Value              | Path, query string, header                                          | Body          |
|--------------------|---------------------------------------------------------------------|---------------|
| `undefined`        | Skipped                                                             | Skipped       |
| `null`             | Skipped                                                             | Kept          |
| Array              | Query: the key is repeated (`tags=a&tags=b`). Header: joined by `, `| Encoded       |
| `Date`             | ISO string                                                          | Encoded       |
| Object             | JSON                                                                | Encoded       |
| Root field         | Its entries are spread (query, headers)                             | Whole body    |

The body is encoded by the codec (JSON by default) and sent with its `Content-Type`; every request sends an `Accept`
header with the codec's media type. Header names are lowercase.

## File uploads

With `body: 'multipart'`, the body fields are sent as a `FormData` instead of being encoded by the codec. A file field
is a `Blob` or `File` value, declared with a file schema:

```ts
action({
  transport: rest.post('/listings/:id/photos', { body: 'multipart' }),
  input: input({
    id: z.string(), // path
    cover: z.file().mime(['image/jpeg']), // one file
    photos: z.array(z.file().max(5_000_000)), // several files under one name
    title: z.string(), // text field
    price: z.number(),
  }),
  output: z.void(),
});
```

- A file is appended as is, with its name; an array gives one part per item, under the same name.
- Text values are written as in the query string: strings as is, dates as ISO strings, numbers and booleans with
  `String()`, objects as JSON. `undefined` and `null` are skipped.
- No `Content-Type` header is set: the HTTP client adds it with the boundary.
- A root body field is rejected: every part needs a name.
- The files are validated on the client like any other field, before the request is sent.

`HttpRequest.body` is a `string`, a `FormData` or `undefined`: an interceptor that reads the body must check its type.

`multipartParts(formData)` and `fileProgress(parts, loaded, total)` estimate the progress of each file from the bytes
sent for the whole request, for drivers that report `onUploadProgress`.

## Binary responses

With `response: 'blob'`, the request accepts any media type (`Accept: */*`) and a success response is delivered as a
`File`: its type comes from `Content-Type`, its name from the `filename` of `Content-Disposition`, or else the last
segment of the path. Declare the output with `z.file()`. Error responses are still decoded by the codec.

The sender returns the body as `blob` (and `text: ''`) for these bindings.

## Responses

- A response whose content type matches the codec (or has none) is decoded; `application/problem+json` matches JSON.
- A response of another content type is kept as text: an HTML error page from a proxy reaches you as a string.
- An empty body is `undefined`.
- A body that cannot be decoded is a transport error.

## `fetchRest()`

```ts
import { fetchRest } from '@polycanal/rest';

fetchRest({
  baseUrl: 'https://api.example.com', // or '/api', or omitted for the same origin
  headers: () => ({ 'X-Tenant': currentTenant() }), // static object or function called for each request
  credentials: 'include', // cookies to another origin
  fetch: customFetch, // default: global fetch
  interceptors: [auth], // see Interceptors
  codec: jsonCodec, // default codec of the driver
});
```

## Another HTTP client

`restTransport(send, options)` builds a REST driver around any HTTP client. `send` receives the built request and the
abort signal, and returns `{ status, headers, text }`:

```ts
import { restTransport } from '@polycanal/rest';

const driver = restTransport(async (request, signal) => {
  const response = await myHttpClient(request.method, request.url, request.headers, request.body, signal);

  return { status: response.status, headers: response.headers, text: response.text };
});
```

`fetchRest()` and the [Angular driver](./angular.md) are built this way.

## Codecs

Bodies are encoded and decoded by a codec. Only JSON is provided for now; a codec can be set per driver
(`fetchRest({ codec })`) or per action (`action({ codec })`):

```ts
const textCodec = {
  contentType: 'text/plain',
  encode: (value: unknown) => String(value),
  decode: (text: string) => text,
};
```
