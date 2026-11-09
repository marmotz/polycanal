---
title: Express
---

# Express

`@polycanal/express` discovers the routes of an Express 4 or 5 application and generates the front-end contract.

```bash
npm install --save-dev @polycanal/express
```

## Marking endpoints

`endpoint()` is a middleware that does nothing but carry the schemas of a route. Only marked routes are described.

```ts
import { endpoint } from '@polycanal/express';

app.post(
  '/auth/login',
  endpoint({ name: 'login', namespace: 'auth', input: LoginSchema, output: SessionSchema, errors: { 401: ErrorSchema } }),
  login,
);
```

With `@reflet/express`, attach it with `@Use()`:

```ts
@Router('/households')
export class HouseholdsRouter {
  @Patch('/:id/members/:userId')
  @Use(
    endpoint({
      name: 'updateMemberRole',
      namespace: 'households',
      input: {
        id: z.string(),
        userId: { source: 'path', schema: z.string() },
        toUserId: { source: 'body', alias: 'userId', schema: z.string() },
        role: RoleSchema,
      },
      output: MemberSchema,
    }),
  )
  updateMemberRole(@Params('id') id: string, @Params('userId') userId: string, @Body() body: RoleBody) {
    // ...
  }
}
```

| `endpoint()` option | Role                                                                                   |
|---------------------|----------------------------------------------------------------------------------------|
| `output`            | Response schema. Required                                                              |
| `input`             | Field map (as in `input()`) or object schema. Undescribed path parameters are added as strings |
| `errors`            | Error body schemas by HTTP status                                                      |
| `status`            | Success status codes                                                                   |
| `name`, `namespace` | Location in the contract. Default name: from the method and the path (`getHouseholdsById`) |
| `meta`              | Free description                                                                       |

## Checking responses

`validateResponses(app)` makes every `endpoint()` route validate what it answers with `res.json()` (or `res.send()` of
an object) before it leaves, as the client will read it (after JSON):

```ts
import { validateResponses } from '@polycanal/express';

validateResponses(app, { onInvalid: process.env.NODE_ENV === 'production' ? 'log' : 'throw' });
```

`onInvalid` is `'throw'` (default: logged and replaced by a 500 error), `'log'` (logged and sent anyway) or a function
called with `{ route, issues, value }` before the response is sent.

## File uploads

A route behind multer takes a multipart body. Declare its file fields with file schemas (`z.file()`, or a list of them)
in `endpoint({ input })`, and place `endpoint()` after multer:

```ts
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

app.post(
  '/listings',
  upload.array('photos'),
  endpoint({
    input: { photos: z.array(z.file().mime(['image/jpeg'])), title: z.string(), price: z.number() },
    output: ListingSchema,
  }),
  createListing,
);
```

Discovery recognizes the multer middleware on the route and describes a multipart body (`body: 'multipart'` on the
binding). File fields declared without multer on the route (multer mounted on the application) are described the same
way.

Before calling the handler, `endpoint()` validates:

- the uploaded files (`req.file`, or `req.files` as a list or an object of lists), converted to web `File`s from memory
  storage or opened from disk storage without being read whole;
- the text fields of `req.body`, which multer always delivers as strings: each one is parsed as JSON when it fails as a
  string (`"12.5"` passes `z.number()`, `"75001"` stays a string). `req.body` is replaced by the schemas' output.

A failure answers `400` with `{ message, issues }`: `Invalid uploaded files` when a file is concerned, `Invalid
multipart body` otherwise. The handler still reads the multer files from `req.file` / `req.files`.

The report warns about multer without a declared file field, and about `endpoint()` placed before multer (it would not
see the files). Uploads on `GET` or `DELETE` routes are skipped.

## Generating

```ts title="scripts/generate-contract.ts"
import { generateExpressContract } from '@polycanal/express';
import { createApp } from '../src/app';

const { report } = generateExpressContract(createApp(), { output: '../shared/src/contract.generated.ts' });
console.log(report);
```

The application only needs its routes mounted; it does not need to listen. `discoverExpressContract(app, { config })`
returns the description and the report (`undescribed`, `skipped`, `warnings`, `conflicts`) without generating code.

## Express 5

Express 5 does not keep the mount path of sub-routers (`app.use('/api', router)`). Record them before mounting:

```ts
import express from 'express';
import { recordMountPaths } from '@polycanal/express';

recordMountPaths(express); // once, before building the application
```

Express 4 needs nothing: mount paths are rebuilt from the router's regular expressions. `recordMountPaths()` works with
Express 4 too.

## Limits

- Routes declared with a regular expression or several paths are skipped.
- Sub-applications mounted with `app.use(otherApp)` hide their routes: mount routers instead.
