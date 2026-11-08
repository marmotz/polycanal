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
| `output`             | Response schema. Required unless `outputOf` finds one                                |
| `errors`             | Error body schemas by HTTP status                                                    |
| `input`              | Fields to add or replace (`{ page: z.coerce.number() }`), as in `input()`            |
| `name`               | Operation name. Default: the handler name                                            |
| `namespace`          | Namespace. Default: `@EndpointNamespace()` or the static segments of the controller path |
| `meta`               | Free description                                                                     |

## Generating

Run discovery from a development script; the application does not need to listen:

```ts title="scripts/generate-contract.ts"
import { NestFactory } from '@nestjs/core';
import { generateNestContract } from '@polycanal/nest';
import { AppModule } from '../src/app.module';

const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix('api');

const { report } = generateNestContract(app, { output: '../shared/src/contract.generated.ts' });
console.log(report);

await app.close();
```

## What is discovered

- Method, paths (global prefix included) and `@HttpCode()`, which becomes the binding's success status.
- `@Body()` and `@Query()` with a pipe: the pipe's schema, spread into fields when it is an object; a non-object body
  becomes a root `body` field.
- `@Param('x')`, `@Query('x')`, `@Headers('x')`: one field each, with the pipe's schema, or described as a string
  without pipe (with a warning, except for path parameters, which are strings by nature).
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
