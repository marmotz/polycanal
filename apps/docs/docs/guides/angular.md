---
title: Angular
---

# Angular

`@polycanal/angular` carries REST calls through Angular's `HttpClient`, so the application's interceptors
(`withInterceptors()`, `HTTP_INTERCEPTORS`) keep applying, and exposes actions as Angular resources.

```bash
npm install @polycanal/core @polycanal/rest @polycanal/angular
```

## Driver

Create the client in a service, in an injection context:

```ts title="server.service.ts"
import { Injectable } from '@angular/core';
import { createClient } from '@polycanal/core';
import { injectAngularRest } from '@polycanal/angular';
import { contract } from '@my-app/shared';

@Injectable({ providedIn: 'root' })
export class Server {
  readonly api = createClient(contract, {
    drivers: [injectAngularRest({ baseUrl: '/api', withCredentials: true })],
  });
}
```

`angularRest(http, options)` does the same with an explicit `HttpClient`. Options are those of
[`fetchRest()`](./rest.md#fetchrest), plus:

| Option            | Role                                                                                     |
|-------------------|------------------------------------------------------------------------------------------|
| `withCredentials` | Sends cookies to another origin (`withCredentials` of `HttpClient`)                       |
| `httpContext`     | `(call) => HttpContext \| undefined`: the `HttpContext` of each request, for interceptors |

- HTTP error responses become `server` errors; status 0 (network, CORS) and aborts become `transport` errors.
- Aborting a call (`{ signal }`) cancels the `HttpClient` request.

### Bodies

With the default JSON codec, the request body goes to `HttpClient` as a value and the response is parsed by
`HttpClient` itself: the application's Angular interceptors see objects, request and error bodies included, exactly as
with a direct `HttpClient` call. With another codec, bodies are exchanged as text and decoded by the codec.

### `HttpContext`

Angular interceptors often read an `HttpContextToken` set by the caller. `httpContext` builds it from the call: its
operation (`call.operation.id`) and the `context` given to the call.

```ts
const SKIP_LOGIN_REDIRECT = new HttpContextToken<boolean>(() => false);

injectAngularRest({
  httpContext: (call) =>
    call.operation.id === 'auth.login' || call.context['skipLoginRedirect'] === true
      ? new HttpContext().set(SKIP_LOGIN_REDIRECT, true)
      : undefined,
});

await server.users.get({ id: 'u1' }, { context: { skipLoginRedirect: true } });
```

### Errors thrown by Angular interceptors

An Angular interceptor that throws its own error (instead of letting the `HttpErrorResponse` through) makes the call
fail with a `transport` error whose `cause` is that error: every failure of a call stays a `PolycanalError`. To give the
application's error back to the callers, rethrow it from a client interceptor:

```ts
const unwrapAppErrors: AnyInterceptor = async (request, next) => {
  try {
    return await next(request);
  } catch (error) {
    throw isPolycanalError(error, { kind: 'transport' }) && error.cause instanceof AppError ? error.cause : error;
  }
};

createClient(contract, { drivers: [injectAngularRest()], interceptors: [unwrapAppErrors] });
```

### Testing with `HttpTestingController`

The client validates the input asynchronously before sending: the request reaches `HttpTestingController` a few
microtasks after the call. Wait for it before `expectOne()`:

```ts
const pending = server.households.list();
const request = await vi.waitFor(() => backend.expectOne('/api/households'));
request.flush([{ id: 'h1', name: 'Home' }]);
```

The response is validated against the output schema: flush complete bodies.

## Resources

`actionResource()` exposes an action as an Angular `resource()`: it reloads when its params change and aborts the
previous call.

```ts
import { Component, inject, signal } from '@angular/core';
import { actionResource } from '@polycanal/angular';

@Component({ ... })
export class Analyses {
  private readonly server = inject(Server).api;
  readonly page = signal(1);
  readonly projectId = signal<string | undefined>(undefined);

  readonly households = actionResource(this.server.households.list);
  readonly analyses = actionResource(this.server.projects.analyses, {
    // undefined keeps the resource idle
    params: () => (this.projectId() === undefined ? undefined : { id: this.projectId()!, page: this.page() }),
    defaultValue: { items: [], total: 0 },
  });
}
```

Resources are meant for reads. Call mutations directly: `await this.server.households.rename({ ... })`.
