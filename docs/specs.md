# Polycanal: initial specification

> Scoping document produced during a design session. Place it at the root of the repo (or rename it to `CLAUDE.md`) to
> start a Claude Code session. The state of the art and the per-framework discovery points were verified on 2026-11-08
> (sources at the end of the document). Project name: **Polycanal** (npm package `polycanal`, available as of
> 2026-11-08). npm organization [`@polycanal`](https://www.npmjs.com/org/polycanal) created, GitHub repository
> [`marmotz/polycanal`](https://github.com/marmotz/polycanal) (`git@github.com:marmotz/polycanal.git`).

## 1. Vision

An **agnostic** TypeScript library that sits between a server and a front end, and that:

- **describes** what the server exposes (REST, GraphQL, WebSocket, SSE, Redis pub/sub...), without ever dictating how
  the server must be written;
- **generates** types and validation schemas, usable on both the back end **and** the front end;
- **provides, on the front end,** a typed object/namespace giving access to every action, whatever the transport, for
  example `server.auth.login({ ... })`, with validation of everything sent and received;
- lets you think in terms of **"channels"** (pushing data, fetching data, emitting or listening to events) rather than
  endpoints.

**Design priority (decided):** the library is first and foremost a **unified client in front of an existing back
end**. Exposing the same contract over several transports is a possible consequence, not the starting point.

### Non-negotiable principles

1. **The server stays free.** Whether the developer uses REST, GraphQL or RPC, the library adapts, not the other way
   around. It does not define the contract the server must implement; it *describes and consumes* it.
2. **Do not reinvent the wheel.** Reuse REST, GraphQL, WebSocket, SSE, Redis pub/sub, OpenAPI, AsyncAPI.
3. **Front-end agnostic:** compatible with Angular, React, etc. No framework imposed.
4. **Back-end agnostic:** not specific to Nest, Express, etc. A system of adapters/drivers.
5. **Debuggable in the browser console.** No opaque transport format. Readable REST, WebSocket messages in plain JSON.
6. **Zod validation to start with**, but behind a validation driver system that allows switching (see §5).
7. **No RPC.** No constraint on the server or the front end beyond describing / configuring the library. The transport
   remains the native protocol, visible as-is in the Network tab.
8. **Progressive adoption.** On a server exposing 10 endpoints, describing a single one, generating what it needs and
   calling only that one through the library must work, without touching the other 9 or the code that calls them.

### Concrete target projects

The library is validated against two families of real-world projects. Adapter implications are detailed in §7.

**1. Express + Angular** (one existing production project)

- Back end: Express 4, routes declared with `@reflet/express` 2.0 decorators (`@Router`, `@Get`, `@Use`, `@Body`,
  `@Query`...) and mounted through `register(app, [...])`.
- Validation: `class-validator`; `@Body()` payloads are often typed inline, without any runtime schema.
- Real time: socket.io with a Redis adapter.
- Front end: Angular.

**2. NestJS + Angular** (several existing projects, same pattern)

- Monorepo (Bun workspaces) with a back-end app, one or more Angular apps (client, admin) and a **shared package**
  holding Zod schemas and the types inferred from them. Both sides import it: this is already the shared contract of §9.
- Back end: NestJS 11-12 on `@nestjs/platform-express` (Express 5), Zod 4.
- Request validation: a custom `ZodValidationPipe` instantiated per parameter,
  `@Body(new ZodValidationPipe(LoginSchema)) body: LoginInput`. No global pipe, no `nestjs-zod`. Query and path
  parameters are often read raw (`@Query('page') page: string`) and parsed by hand.
- Responses: mostly typed by the handler return type only; some projects add a `@ZodResponse(schema)` decorator
  (`SetMetadata` under a custom key).
- Front end: Angular 22, handwritten services over `HttpClient` (`Observable` or `firstValueFrom`), one method per
  endpoint, URLs built by string concatenation, cookies sent with `withCredentials`. Response types come from the shared
  package but are only asserted (`http.get<T>()`), never validated.
- Real time: none so far (no SSE, no WebSocket gateway).

## 2. State of the art (verified on 2026-11-08)

No library found covers the vision exactly. The closest ones:

| Tool                  | What it does                                                                                                                                                                                                                | Why it is not enough                                                                                                        |
|-----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| **oRPC**              | Contract (`@orpc/contract`), server, typed client, OpenAPI generation, adapters (Next, Hono, Express, Fastify, Workers, Lambda...), "Standard Server" layer, pub/sub (memory/Redis/Upstash), Zod/Valibot/ArkType validators | Contract-first: the server must be written with oRPC. No GraphQL                                                            |
| **tRPC v11**          | Typed RPC, SSE or WebSocket subscriptions, Standard Schema protocol, community Nest adapter                                                                                                                                 | Imposes its server model, RPC format hard to read in the console                                                            |
| **ts-rest**           | Contract-first REST, typed client, Standard Schema since 3.53                                                                                                                                                               | **Archived, no longer maintained.** Contract-first: forces the server to implement the contract                             |
| **Zodios**            | Typed REST client/server from Zod schemas                                                                                                                                                                                   | Dormant: last commits in October 2023, bots only                                                                            |
| **Hono RPC**          | Typed client inferred from the `AppType` exported by the server. On the wire: standard REST/JSON                                                                                                                            | Hono-specific, requires exporting the app type and chaining routes                                                          |
| **HyperFetch**        | Unified REST / GraphQL / Firebase / WebSocket / SSE client                                                                                                                                                                  | Client side only, nothing on the server side                                                                                |
| **WunderGraph**       | The BFF SDK (composition of heterogeneous APIs) was abandoned in favor of Cosmo                                                                                                                                             | Cosmo only does GraphQL federation. Off topic                                                                               |
| **Feathers channels** | Server-side groups of connections, joined on condition, receiving published events                                                                                                                                          | A server broadcasting mechanism, requires a real-time transport (Socket.io), Feathers model. Not a client description model |
| **AsyncAPI 3.0**      | Specification for event-driven APIs: `channels` decoupled from `operations` (`action: send \| receive`)                                                                                                                     | Not a library: it is a **description format**, to be used as an import source for event channels                            |

**Identified gap:** a transport-independent channel model, with pluggable drivers, that *describes* an existing server
rather than dictating its shape, with events (WS/SSE/pub-sub) on the same level as requests. The abandonment of ts-rest
and Zodios leaves the "typed REST" space without any maintained non-RPC player.

**Decision:** RPC and contract-first approaches (oRPC, tRPC, ts-rest) are ruled out, including as a base or as a
spike. The main reason is that they **contradict principle 1**: the server must be written with their router, or
implement their contract, for the client to work. They cannot be placed in front of an existing back end without
rewriting it. Network readability is only a secondary argument: tRPC uses its own format, but oRPC (through its
`OpenAPIHandler`) and Hono RPC produce readable REST, and are still unsuitable for the principle 1 reason.

## 3. Architecture

```
 Description sources             Internal model            Generated outputs
 ┌────────────────────┐      ┌──────────────────┐      ┌─────────────────────────┐
 │ Manual config      │      │                  │      │ Schemas (Zod first)     │
 │ Decorators         │ ───▶ │ Normalized model │ ───▶ │ TS types (back + front) │
 │ OpenAPI (import)   │      │ (channels, types,│      │ `server.x.y()` client   │
 │ AsyncAPI (import)  │      │  relations)      │      │ Transport drivers       │
 │ GraphQL schema     │      │                  │      └─────────────────────────┘
 │ Introspection      │      │                  │
 └────────────────────┘      └──────────────────┘
```

The **normalized internal model** is the core of the library. Drivers are adapters:

- **input**: read a description (config, decorators, OpenAPI, AsyncAPI, GraphQL SDL, framework introspection) and
  produce the model;
- **output**: implement the client-side transport (fetch, graphql, ws, sse...) from the model;
- **validation**: implement validation and schema generation for a given library (see §5).

### Source priority

**Config has the highest priority.** Decorators (and introspection) complete the model but **can never modify what the
config declares**. In case of conflict, the config wins and the library reports it.

Decorators are not specific to Nest: other ecosystems use them too (for example `@reflet/express` on Express, see §7).
The library therefore provides generic decorators, plus adapters able to read the metadata of existing decorators.

### Pivot: the runtime schema, not the TS type

TypeScript types are erased at compile time, so no framework exposes them at runtime. There are only three ways to
recover them:

1. a **runtime schema** (Zod, JSON Schema) from which the type is inferred: **chosen approach**;
2. static analysis through the TS compiler API (powerful but heavy and brittle);
3. an external standard (OpenAPI, AsyncAPI), itself generated from (1) or (2).

OpenAPI is therefore not an alternative to introspection but one **exchange format / import source** among others.

### Inference and code generation

Both coexist, depending on the source (decided):

- **contract written in TS** (config or decorators with Zod schemas): **pure inference**, no build step;
- **imported contract** (OpenAPI, AsyncAPI, GraphQL SDL): **code generation** is unavoidable, since these sources are
  not TS. Readable `.ts` files are generated, containing schemas for the chosen validation library (Zod to start with).

### Output of discovery and config (decided)

During development, config and decorators (completed by introspection) describe the endpoints: their names, their
parameters, their responses and their types. From that description, the library **infers** what can be inferred and
**generates** the rest, depending on the source (see above). The result is the types and the validators (Zod at first)
the front end and the back end use to type, validate and format what they send and receive.

### Driver interfaces (implemented in `@polycanal/core`)

- **Binding** (`TransportBinding`): plain data produced by a driver package, carried by each operation: `driver` name,
  channel `family`, accepted input `sources`, and `requires`, the input fields the binding needs by wire name (REST
  path parameters). `requires` is checked at compile time and when the action is defined; a source listed in it is
  closed (a field can only use it explicitly if its wire name is required).
- **Transport driver** (`TransportDriver`): client-side implementation selected by the binding's `driver` name.
  - Actions: `prepare(call)` builds the native request (body encoded by the codec), `send(request)` carries it through
    the interceptor chain and rejects only on transport failures, `read(response)` turns it into an outcome
    (`{ ok: true, body }` or `{ ok: false, key, body }`, `key` being the HTTP status for REST). The client validates
    the input before `prepare` and the outcome after `read`.
  - Events: `publish(call, message)` and `subscribe(call, listener, onError)`; the client validates both directions.
  - Interceptors: `(request, next, context) => Promise<response>`, typed by the driver's native request and response.
- **Codec**: text based for now (`encode(value) => string`, `decode(text) => unknown`); `jsonCodec` is the default.
- **Validation driver** (`ValidationDriver`): runtime validation goes through Standard Schema for every library, so a
  validation driver only generates schema source code from JSON Schema (`generate`), and optionally converts its
  schemas to JSON Schema (`toJsonSchema`). `toJsonSchema()` in the core uses Standard JSON Schema, and turns schemas
  accepting only `undefined` (`z.void()`, no body) into the `x-polycanal-void` marker that JSON Schema cannot express.
- **Errors**: `PolycanalError` with `kind` (`input`, `output`, `server`, `transport`), `operation`, `driver`, `key`,
  `data` (error body, validated when the action declares a schema for it), `issues`, `response`, `cause`.

### Code generation (implemented in `@polycanal/codegen`)

- A **contract description** (`ContractDescription`) is the serializable form of a contract: operations with their
  binding and JSON Schemas, plus named schemas referenced as `#/schemas/<name>`. Server adapters and importers produce
  it; `describeContract(contract)` builds it from a contract written in TS (input side of the schemas for what is sent,
  output side for what is received).
- `generateContractSource(description, { validation, bindings })` writes a readable TS file: imports, named schemas as
  exported constants (recursive ones through lazy references), then `defineContract()`. Schemas are generated by the
  validation driver (`zodDriver` from `@polycanal/zod`), bindings by the driver packages' emitters
  (`restBindingEmitter`).
- `mergeDescriptions(config, discovered)` applies the source priority of §3: config operations always win, and
  disagreements are reported (same id with another route, same route under another id).
- `@polycanal/openapi`: `importOpenApi(document)` (OpenAPI 3.0 and 3.1, JSON) and `generateFromOpenApi(document)`, also
  available as `polycanal-openapi <openapi.json> <output.ts>`. Operations are named after their first tag and their
  `operationId`; object request bodies are spread into `body` fields, other bodies become a root `body` field; what
  cannot be described (cookies, non-JSON bodies, HEAD) is skipped with a warning.

## 4. Channel model

Two families, with different operations:

- **Action channel**: request/response operations, **named freely after what the server exposes, never constrained to
  CRUD** (decided). If the server has a REST endpoint `foobar` configured as `POST`, then `server.foobar(...)` (syntax
  not final) sends a `POST` with its data in the body. Natural mapping: REST (method + path), GraphQL
  (query/mutation), WebSocket (messages correlated by id).
- **Event channel**: `publish / subscribe`.
  Natural mapping: WebSocket, SSE, GraphQL subscriptions, Redis pub/sub. **No direct equivalent in REST**: the compiler
  must reject it for a REST driver.

Each driver **declares the channel types it supports**. An operation a driver cannot carry is a compile error.
Transport specifics (HTTP status codes, cache, headers) go through **driver-specific options**, to avoid the
lowest-common-denominator trap.

### Body codecs (decided)

The encoding of request and response bodies goes through **codec drivers**, like everything else. A codec declares its
content type and knows how to encode a value into a body and decode a received body. Only a **JSON codec** is provided
at first, and it is the default. Codecs can be configured or overridden per driver, per channel or per operation, so
that other formats (form data, files, text...) can be added later without touching the core.

### Contract definition

`defineContract()` (name not final) holds **everything needed to call an endpoint**: how to reach it, its parameters
and their schemas, where each parameter goes, the schema of its response, and options. Its shape determines the call
signature on the front end.

#### Design (decided; names not final)

Three ideas:

1. **The call signature is transport-agnostic.** An action takes a single object and returns its `output`. The caller
   never deals with path, query or body: the contract maps each field of that object onto the native protocol, through
   `input()`.
2. **The transport binding is separate from the schemas.** Each operation carries a `transport` binding, a plain
   description produced by a driver package (`rest.patch(...)`). It says how `input` is split onto the native
   protocol. The binding contains no transport code: the implementation (`fetch`, Angular `HttpClient`...) is chosen
   when creating the client.
3. **The contract is a tree of plain objects.** Nesting gives the namespaces (`server.households.list()`). Contracts
   can be split per file and composed, and a contract with a single operation is valid (progressive adoption).

```ts
import { action, defineContract, event, input } from '@polycanal/core';
import { rest } from '@polycanal/rest';
import { ws } from '@polycanal/ws';
import { z } from 'zod';

export const householdsContract = defineContract({
  list: action({
    transport: rest.get('/households'),
    output: z.array(HouseholdSummarySchema),
  }),
  updateMemberRole: action({
    transport: rest.patch('/user/:userId'),
    input: input({
      householdId: z.string(), // shorthand: default rules, so the body for a PATCH
      userId: { source: 'path', schema: z.string() },
      toUserId: { source: 'body', alias: 'userId', schema: z.string() }, // sent as body.userId
      role: HouseholdRoleSchema,
    }),
    output: z.void(),
  }),
  analyses: action({
    transport: rest.get('/projects/:id/analyses'),
    input: input({
      id: z.string(),
      page: z.number().int().default(1),
      limit: z.number().int().default(10),
    }),
    output: PaginatedAnalysesSchema,
  }),
  importMembers: action({
    transport: rest.post('/households/:id/members/import'),
    input: input({
      id: z.string(),
      members: { source: 'body', root: true, schema: z.array(MemberImportSchema) }, // the whole body is an array
    }),
    output: ImportReportSchema,
  }),
});

export const contract = defineContract({
  auth: {
    login: action({
      transport: rest.post('/auth/login'),
      input: LoginRequestSchema, // an existing object schema: every field follows the default rules
      output: LoginResponseSchema,
      errors: { 401: InvalidCredentialsSchema }, // typed error bodies, carried by PolycanalError
    }),
  },
  households: householdsContract,
  notifications: event({
    transport: ws.event('notification'),
    receive: NotificationSchema,
  }),
  chat: event({
    transport: ws.event('chat:message'),
    send: ChatMessageSchema,
    receive: ChatMessageSchema,
  }),
});
```

Operation fields:

| Field       | Applies to | Role                                                                                       |
|-------------|------------|--------------------------------------------------------------------------------------------|
| `transport` | both       | Driver binding (required). Its options are typed by the driver                             |
| `input`     | action     | `input({...})` field map, or an object schema. Omitted: the action takes no argument       |
| `output`    | action     | Schema of the response                                                                     |
| `errors`    | action     | Schemas of error bodies, keyed by a driver-defined key (HTTP status for REST)              |
| `send`      | event      | Schema of published messages. Omitted: no `publish()` on the client                        |
| `receive`   | event      | Schema of received messages. Omitted: no `subscribe()` on the client                       |
| `codec`     | both       | Body codec override (default: the driver's, JSON at first)                                 |
| `meta`      | both       | Free description (summary, tags, deprecation) for docs and OpenAPI / AsyncAPI export       |

`input()` takes a map of fields, keyed by their name in the call. Each field is either:

- **a schema** (shorthand): the field follows the transport's default rules;
- **a descriptor** `{ schema, source?, alias?, root? }`:
  - `source`: where the field goes. Allowed values are defined by the transport binding and type-checked (REST:
    `'path' | 'query' | 'body' | 'header'`);
  - `alias`: its name on the wire, when it differs from its name in the call. This solves collisions, for example a
    `userId` in the path and another `userId` in the body;
  - `root`: the field value is the whole body (array or non-object body). At most one root field, and then no other
    `body` field.

Each field schema can come from any Standard Schema compliant library: `input()` composes them, so the core does not
depend on Zod. Passing an existing object schema directly (`input: LoginRequestSchema`) remains possible, to reuse the
schemas of a shared package: every field then follows the default rules.

REST binding rules (`rest.get / post / put / patch / delete (path, options?)`):

- **path parameters** come from the `:name` segments of the path. Each one must match an `input` field (by wire name)
  whose source is `path` or default; this is checked at compile time (template literal types);
- **default rules**: a field whose name matches a path segment goes to the path; the others go to the query string
  for `GET` and `DELETE`, to the body for `POST`, `PUT` and `PATCH`;
- **binding options**: `status` (expected success status), `codec`.

The server can also describe the same contract with decorators instead of config; both produce the same internal
model (§3).

Target front-end usage:

```ts
import { createClient } from 'polycanal';
import { fetchRest } from '@polycanal/rest';
import { contract } from '@my-app/shared';

const server = createClient(contract, {
  drivers: { rest: fetchRest({ baseUrl: '/api' }) }, // or angularRest() from @polycanal/angular
});

const session = await server.auth.login({ email: 'ada@example.com', password: '...' }); // POST /auth/login
await server.households.updateMemberRole({ householdId: 'h1', userId: 'u1', toUserId: 'u2', role: 'admin' });
// PATCH /user/u1, body { householdId: 'h1', userId: 'u2', role: 'admin' }
const page = await server.households.analyses({ id: 'p1', page: 2 }); // GET ...?page=2&limit=10
const unsubscribe = server.notifications.subscribe((notification) => { /* typed */ });
server.chat.publish({ text: 'hello' });
```

A driver that does not support a channel family rejects it at compile time: an `event()` bound with `rest.*` does
not exist, since `@polycanal/rest` exposes no event binding.

### Front-end integration (decided)

- The core client returns **Promises**, to stay framework-agnostic.
- **`@polycanal/angular`** provides a transport driver based on Angular's `HttpClient`, so that the application's
  existing Angular interceptors keep applying, and possibly helpers based on signals or `httpResource`.

Implemented: `createClient(contract, { drivers, interceptors, operations })` in the core; `fetchRest()` in
`@polycanal/rest` (and `restTransport(sender)` to plug any HTTP client); `angularRest(http)` / `injectAngularRest()`
and `actionResource(server.x.y, { params })` (an Angular `resource()` reloaded when its params change) in
`@polycanal/angular`. REST request bodies and query values: `undefined` and `null` are skipped, arrays repeat the
query key, dates are sent as ISO strings, objects in a path, query or header as JSON. Responses whose content type is
not the codec's are kept as text.

### WebSocket: describing the existing format

WebSocket has no native convention for create/patch/delete. In line with principle 1, the WS driver **describes the
message format the server already uses** (event name, envelope, optional correlation field), through a configurable
mapping. It does not impose a format on the server. Example: a socket.io back end emitting named events with a JSON
payload must be describable as-is.

The library offers a **default** convention, only usable when the server has none: plain JSON such as
`{ channel, action, id, payload }`, with a correlation identifier for responses. In every case, messages remain
readable in the Network tab, ideally with a small devtool.

## 5. Validation

### What Standard Schema covers (verified)

[Standard Schema](https://standardschema.dev/) is a set of TS interfaces, not a library. A compliant schema exposes a
`~standard` property with:

- `version` (`1`), `vendor` (library name), optional `types` (inferred `input` / `output`);
- `validate(value)`, synchronous or asynchronous, returning either `{ value }` or `{ issues }` (each issue has a
  `message` and an optional `path`).

Standard Schema **only covers two things: validating a value and inferring its type**. It does not allow converting a
schema to JSON Schema. That conversion belongs to a companion spec, **Standard JSON Schema**, which adds
`~standard.jsonSchema.input()` / `.output()`. It is implemented by Zod 4.2+, ArkType 2.1.28 and Valibot (through
`@valibot/to-json-schema` 1.5+).

Consequence: to **export** the model to OpenAPI or AsyncAPI (which are JSON Schema), a schema must implement both
interfaces. For validation alone (sent and received data), Standard Schema is enough.

### The three uses of a schema, and what can be abstracted

| Use                                        | Possible abstraction                        |
|--------------------------------------------|---------------------------------------------|
| Validate a value (on send, on receive)     | Yes, through Standard Schema                |
| Export to JSON Schema (OpenAPI / AsyncAPI) | Yes, through Standard JSON Schema           |
| **Generate** a schema from an import       | No: library-specific code has to be written |

The third point is the limit of the abstraction. When importing an OpenAPI document, a `.ts` file containing *concrete*
schemas (`z.object({ ... })` or `v.object({ ... })`) has to be produced. No common interface allows writing that code
in a neutral way.

### Decision: everything is validated

**Everything that goes through the library is validated, in both directions:** parameters before sending, responses
on receipt, events published and received. Nothing reaches the server or the application code unchecked.

### Decision: validation drivers

- One **validation driver** per library, with two roles: validating at runtime (relying on Standard Schema when the
  library supports it) and generating schema code during an import.
- **Zod is the first driver.** Others (Valibot, ArkType...) can be added without touching the core.
- Schemas handwritten by the developer can come from any Standard Schema compliant library, without a dedicated
  driver.
- Generation must produce **runtime schemas**, not just types, since validation is required in both directions.

## 6. GraphQL

The front end must be able to **select fields and relations**, and the return type must reflect the selection. This is
feasible: the selection is an object literal, and TypeScript can infer its exact type (an approach already used by
gql.tada and GraphQL Code Generator).

Typing sketch, **known to be incorrect, to be revisited when building the GraphQL driver**:

```ts
type Select<T> = {
  [K in keyof T]?: T[K] extends object | undefined ? boolean | Select<NonNullable<T[K]>> : boolean;
};

type Result<T, S> = {
  [K in keyof S & keyof T as S[K] extends false | undefined ? never : K]: S[K] extends true ? T[K] : Result<NonNullable<T[K]>, S[K]>;
};

declare function query<T, const S extends Select<T>>(sel: S): Promise<Result<T, S>>;

// select { firstName, lastName } => { firstName: string; lastName: string }  (no password)
```

Known flaws of this sketch:

- arrays are not unwrapped: `Post[] extends object` is true, so `Select<Post[]>` targets the keys of an array instead
  of those of `Post`;
- object leaf types (`Date`, etc.) are mistaken for relations;
- `Result` is not homomorphic and loses the optional / nullable nature of fields.

Points of attention:

- Circular relations are not a problem: the result type is bounded by the selection, which is finite.
- GraphQL requires a **domain model with relations** (`User → Post[]`) in addition to channels: to be integrated into
  the internal model.
- GraphQL input types only support unions through `@oneOf`, merged into the spec on 2025-09-01 (RFC #825) and
  supported by GraphQL.js 16+. The generated Zod must remain expressible within this limit (discriminated unions →
  `@oneOf`).
- **Late / optional** driver: start with REST.

## 7. Route and type discovery per framework

Verified on 2026-11-08:

| Framework | Routes                                                                                                                                    | Payload types / schemas                                                                           |
|-----------|-------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| NestJS    | Yes, at runtime: `DiscoveryService.getControllers()` / `getProviders()`, `DiscoveryService.createDecorator()`, filtering by `metadataKey` | Partial: DTOs as classes, or Zod through `nestjs-zod`                                             |
| Fastify   | Yes, `onRoute` hook (receives `method`, `url`, `schema`...)                                                                               | Yes if the user declares JSON schemas (`routeOptions.schema`)                                     |
| Hono      | Yes: `showRoutes()` (`hono/dev`) and the `hono routes` CLI resolve routes from the actual instance                                        | Only through validation middlewares (`zValidator`, `zod-openapi`)                                 |
| Express   | Possible, see below                                                                                                                       | Not natively. Through the metadata of a decorator library or through the library's own decorators |

**Next.js** is out of scope for now: it is not a full-fledged back-end server.

### Express

Express offers no public API to list routes, but two approaches are workable:

1. **Walking the router stack after mounting.** In Express 4, the stack is reachable through `app._router.stack`
   (internal, undocumented property). Express 5 reintroduces `app.router` as a reference to the base router. This walk
   depends on internal structures: one adapter per major version is needed, covered by tests.
2. **Reading the metadata of a decorator library.** This is the most reliable approach when the project uses one.

For the Express + Angular target (§1): `@reflet/express` stores its metadata with `reflect-metadata` under private,
non-exported `Symbol` keys (`route`, `router`...). The adapter will have to either find them through reflection
(brittle), rely on approach 1, or require one of the library's decorators in addition. Since `@Body()` payloads have no
runtime schema, schemas must be attached to them (decorator or config).

### NestJS

For the NestJS + Angular target (§1): routes come from `DiscoveryService`. Request schemas are already present at
runtime, as instances of the project's `ZodValidationPipe` stored by Nest in each handler's `__routeArguments__`
metadata (`ROUTE_ARGS_METADATA`, with its `pipes`). The pipe is project-specific, so the adapter needs a configurable
way to extract the schema from a pipe instance, or the project switches to a pipe provided by the library. Response
schemas exist only where a decorator such as `@ZodResponse` is used; elsewhere they must be attached (decorator or
config).

Implemented in `@polycanal/nest`:

- `discoverNestContract(app, options)` walks the controllers of a created application (not listening): method, paths
  (global prefix included), `@HttpCode`, and the route arguments. Pipe schemas are found by `schemaOf` (default: the
  first Standard Schema property of the pipe, which matches `new ZodValidationPipe(schema)`). A whole `@Body()` or
  `@Query()` object schema is spread into fields; a non-object body becomes a root `body` field. `@Param('x')`,
  `@Query('x')` and `@Headers('x')` without pipe are described as strings (with a warning, except path parameters).
  Path parameters not read by the handler are still described. A name used by two sources keeps it for the path and
  is prefixed for the other (`bodyUserId`, aliased to `userId`).
- Progressive adoption: by default only handlers decorated with `@Endpoint({ output, errors, input, name, namespace,
  meta })` are described; `include: 'all'` describes every route that has a response schema. `outputOf` reads response
  schemas from project decorators (e.g. `@ZodResponse`). `@EndpointNamespace()` overrides the default namespace (the
  static segments of the controller path); the operation name defaults to the handler name.
- The report lists undescribed routes, skipped routes with their reason (no response schema, wildcard path...),
  warnings, and the conflicts with the `config` contract, which has the priority.
- `generateNestContract(app, { output })` runs the discovery and writes the front-end contract (Zod by default), to be
  called from a development script.

### Decision

Two distinct roles for framework adapters:

1. **Route discovery**: through introspection when the framework allows it;
2. **Schema attachment**: decorators provided by the library (usable with Nest, Express + a decorator library, etc.),
   middleware for Hono, or import of an existing OpenAPI document.

**Manual config** is the common denominator (works everywhere) and has priority (§3); introspection is a per-adapter
convenience, not a dependency.

**Design bonus:** compare the routes actually exposed with those declared in the contract and report discrepancies
(undescribed endpoint, declaration without a route).

## 8. Server side: what "generating types" means

The library provides **payload and handler types** that the developer uses in their Nest controllers, Express routes,
etc. Nothing automatically checks that a handler complies with the contract, unless the return type is constrained. Do
not promise more.

## 9. Shared contract

The contract shared between back end and front end lives either in a **package** or in a **directory**, as the
developer chooses. Its location and name are configurable. The front end must never import server code: only the
contract. For an external non-TS back end, the contract is generated (§3).

## 10. Client middlewares: hooks and interceptors

No specific authentication abstraction. Instead, a client-side **interceptor chain**, shared by all drivers, with
extension points specific to each one. It must at least allow:

- **injecting** headers or parameters (token, WS `connectionParams`, tenant context...);
- **intercepting errors** (401 → token refresh then replay, error normalization);
- **issuing requests** from an interceptor (refresh, prerequisites);
- **transforming** requests and responses;
- applying **globally, per driver, per channel or per call**.

Implemented as middlewares around the driver's `send`, `(request, next, context) => Promise<response>`. Order, outermost
first: `createClient({ interceptors })`, the driver's `interceptors`, `createClient({ operations: { '<id or
namespace>': { interceptors } } })` (shorter prefixes first), then the call's `{ interceptors }`. Calling `next` again
replays the request; errors thrown by an interceptor propagate unchanged, so it can normalize them.

### Errors (decided)

The library throws **its own exception** (`PolycanalError`, name not final) carrying structured data that can be handled
programmatically: error kind (validation of the parameters, validation of the response, transport, server error...),
channel and operation, HTTP status when relevant, validation issues, raw response.

## 11. Proposed starting plan

1. **Internal model**: define the normalized format (channels, channel types, schemas, optional relations)
   independently of Zod, through Standard Schema.
2. **Driver interfaces**: transport (what a driver declares it supports, how it serializes) and validation (runtime
   validation, code generation).
3. **REST driver**: input through manual config (then OpenAPI), `fetch` output, typed proxy client
   `server.foobar(...)`, interceptor chain, `@polycanal/angular` driver based on `HttpClient`.
4. **Nest adapter** (concrete target: the NestJS + Angular projects): discovery through `DiscoveryService`, reading of
   the existing Zod pipes, schema attachment decorators, generation for the front end.
5. **Express adapter** (concrete target: the Express 4 + `@reflet/express` back end of the Express + Angular project):
   route discovery + the same decorators.
6. **WebSocket driver** (including socket.io) + event channels, mapping of the existing format, AsyncAPI import.
7. **GraphQL driver** (domain model + selection typing, to be fixed, see §6).
8. Hono, Fastify, etc. adapters.

## 12. Tooling and packaging (decided)

- **Tooling:** Bun (workspaces, package manager), tsup (build), Vitest (tests), Biome (lint and format), changesets
  (versioning and releases).
- **Packages:** `polycanal` (entry point re-exporting the core), `@polycanal/core`, `@polycanal/rest`, `@polycanal/zod`,
  `@polycanal/codegen` (contract descriptions and source generation), `@polycanal/openapi` (OpenAPI import and the
  `polycanal-openapi` CLI), `@polycanal/nest`, `@polycanal/express`, `@polycanal/angular`, then `@polycanal/ws` and
  `@polycanal/graphql`. Driver and adapter packages live under the `@polycanal/*` scope (npm organization created on
  2026-11-08).
- **Module format: ESM only.** Every supported Node version (22.12+ and 24) loads ESM from CommonJS through
  `require(esm)`, so CommonJS projects such as a default NestJS build keep working. Constraint: no top-level `await` in
  published code, since `require(esm)` rejects it.
- **Runtimes:** Node and Bun on the back end, browsers for what is generated for the front end.
- **License:** MIT.

## 13. Open questions

- `@reflet/express` adapter: reflection on private metadata, walking the Express stack, or the library's decorators in
  addition?
- Socket.io: its protocol (Engine.io) is not raw WebSocket. Dedicated driver or an option of the WS driver?
- `@reflet/express` adapter: reflection on private metadata, walking the Express stack, or the library's decorators in
  addition?
- Socket.io: its protocol (Engine.io) is not raw WebSocket. Dedicated driver or an option of the WS driver?

## Sources (verified on 2026-11-08)

- [ts-rest (GitHub)](https://github.com/ts-rest/ts-rest)
- [Zodios, commit history](https://github.com/ecyrbe/zodios/commits/main)
- [WunderGraph answers](https://wundergraph.com/answers)
- [Feathers channels](https://feathersjs.com/api/channels)
- [AsyncAPI 3.0.0 release notes](https://www.asyncapi.com/blog/release-notes-3.0.0)
- [Hono RPC](https://hono.dev/docs/guides/rpc)
- [Hono dev helper](https://github.com/honojs/website/blob/main/docs/helpers/dev.md)
- [Standard Schema](https://standardschema.dev/)
- [Standard JSON Schema](https://standardschema.dev/json-schema)
- [Fastify hooks](https://fastify.dev/docs/latest/Reference/Hooks/)
- [Nest DiscoveryService](https://github.com/nestjs/docs.nestjs.com/blob/master/content/fundamentals/discovery-service.md)
- [GraphQL RFC #825 (OneOf)](https://rfcs.graphql.org/rfcs/825/)
- [Express 5, what's new](https://betterstack.com/community/guides/scaling-nodejs/express-5-new-features/)
