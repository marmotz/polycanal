---
title: NestJS
---

# NestJS

`@polycanal/nest` discovers the routes of a NestJS application and generates the front-end contract. Request schemas
are read from the pipes the application already uses; what cannot be discovered is attached with `@Endpoint()`.

```bash
npm install --save-dev @polycanal/nest
```

## Marking endpoints

Only handlers decorated with `@Endpoint()` are described, so a project can adopt Polycanal one route at a time:

```ts
import { Endpoint } from '@polycanal/nest';

@Controller('auth')
export class LoginController {
  @Post('login')
  @HttpCode(200)
  @Endpoint({ output: LoginResponseSchema, errors: { 401: InvalidCredentialsSchema } })
  login(@Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest) {
    // ...
  }
}
```

| `@Endpoint()` option | Role                                                                                 |
|----------------------|--------------------------------------------------------------------------------------|
| `output`             | Response schema. Required unless `outputOf` finds one. TypeScript checks the handler's return type against it |
| `errors`             | Error body schemas by HTTP status                                                    |
| `input`              | Fields to add or replace (`{ page: z.coerce.number() }`), as in `input()`; a root field replaces the fields discovered in its source |
| `name`               | Operation name. Default: the handler name                                            |
| `namespace`          | Namespace. Default: `@EndpointNamespace()` or the static segments of the controller path |
| `meta`               | Free description                                                                     |

## Checking responses

With an `output`, TypeScript refuses a handler whose return type does not match the input type of the schema (a `Date`
is accepted where JSON carries a string). A handler answering through `@Res()` returns nothing: it needs a
`// @ts-expect-error` or no `output`.

At runtime, `EndpointOutputInterceptor` validates what each `@Endpoint()` handler answers before it leaves, as the
client will read it (after JSON):

```ts
import { EndpointOutputInterceptor } from '@polycanal/nest';

app.useGlobalInterceptors(
  new EndpointOutputInterceptor({ onInvalid: process.env.NODE_ENV === 'production' ? 'log' : 'throw' }),
);
```

| `onInvalid`        | A response that does not match                                         |
|--------------------|------------------------------------------------------------------------|
| `'throw'` (default) | Logged and replaced by a 500 error: tests and development catch it    |
| `'log'`            | Logged and sent anyway                                                 |
| function           | Called with `{ route, issues, value }`; what it throws replaces the response |

Its `outputOf` option reads response schemas from a project decorator, like the discovery option.

## File uploads

Uploaded files are validated with file schemas (`z.file()`) through three pipes. Each one exposes its schema, so
discovery describes the route as a multipart body (`body: 'multipart'` on the binding).

```ts
import { filePipe, filesPipe, multipartBodyPipe } from '@polycanal/nest';

@Post('listings')
@UseInterceptors(FilesInterceptor('photos'))
@Endpoint({ output: ListingSchema })
create(
  @UploadedFiles(filesPipe(z.array(z.file().mime(['image/jpeg'])), { field: 'photos' })) photos: Express.Multer.File[],
  @Body(multipartBodyPipe(z.object({ title: z.string(), price: z.number() }))) body: { title: string; price: number },
) {}
```

| Pipe | For | Checks |
|------|-----|--------|
| `filePipe(schema, { field? })` | `@UploadedFile()` | The file, converted to a web `File` |
| `filesPipe(schema, { field? })` | `@UploadedFiles()` | The list (`FilesInterceptor()`) or the object of lists (`FileFieldsInterceptor()`) |
| `filesPipe({ cover, photos })` | `@UploadedFiles()` with `FileFieldsInterceptor()` | Each field; a field whose schema is not a list receives its single file |
| `multipartBodyPipe(schema)` | `@Body()` | The text fields, each parsed as JSON when it fails as a string (`"12.5"` passes `z.number()`, `"75001"` stays a string) |

Files are converted from memory storage or opened from disk storage without being read whole. The handler still
receives the multer files unchanged, and the body pipe returns the schema's output. A failure answers `400` with
`{ message, issues }`.

The field names given to `FileInterceptor()` and its siblings cannot be read: pass them with the `field` option, or
declare the field with `@Endpoint({ input })`. `filesPipe()` with a map of schemas, or with an object schema, names its
fields by their keys. Without a name, the file is left out of the contract with a warning. A key given to
`@UploadedFile('x')` is also read as the field name, but Nest then reads `req.x` instead of `req.file`.

## Generating

Generate the contract with the [CLI](./cli.md), from a `polycanal.config.ts` whose source is `nestSource()`:

```ts
source: nestSource({ app: () => NestFactory.create(AppModule, { preview: true, logger: false }) }),
```

`preview: true` builds the module graph without creating any provider: nothing connects to a database. Schemas found in
the configured `schemaModules` are imported by the generated contract, and a body validated by one of them stays a
whole root `body` field.

`generateNestContract(app, options)` and `discoverNestContract(app, options)` stay available for custom scripts; their
`resolveSchema` option is what the CLI uses to import schemas.

## What is discovered

- Method, paths (global prefix included) and `@HttpCode()`, which becomes the binding's success status.
- `@Body()` and `@Query()` with a pipe: the pipe's schema, spread into fields when it is an object; a non-object body
  becomes a root `body` field.
- `@Param('x')`, `@Query('x')`, `@Headers('x')`: one field each, with the pipe's schema, or described as a string
  without pipe (with a warning, except for path parameters, which are strings by nature).
- `@UploadedFile()` and `@UploadedFiles()`: body fields named as described in [File uploads](#file-uploads), and a
  multipart binding. Such a route must use `POST`, `PUT` or `PATCH`, otherwise it is skipped.
- Path parameters the handler does not read are still described.
- A name used by two sources keeps it for the path and is prefixed for the other (`bodyUserId`, sent as `userId`).

Pipes are read by `schemaOf`: by default, the first own property of the pipe that is a Standard Schema, which matches
the usual `new ZodValidationPipe(schema)`.

## Options

| Option         | Role                                                                                    |
|----------------|-----------------------------------------------------------------------------------------|
| `include`      | `'decorated'` (default) or `'all'` (every route that has a response schema)             |
| `outputOf`     | Reads response schemas from a project decorator, e.g. `@ZodResponse()`                  |
| `schemaOf`     | Reads the schema of a custom pipe                                                       |
| `config`       | Contract written in TS: its operations always win, conflicts are reported               |
| `globalPrefix` | Global prefix, when it cannot be read from the application                              |

```ts
generateNestContract(app, {
  include: 'all',
  outputOf: (controller, handler) => Reflect.getMetadata('zodResponseSchema', controller.prototype[handler]),
});
```

## Report

`report` lists `undescribed` routes (not decorated), `skipped` routes and why (no response schema, wildcard path...),
`warnings`, and `conflicts` with the config. `discoverNestContract(app, options)` returns the description and the report
without generating code.
