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
[`fetchRest()`](./rest.md#fetchrest) plus `withCredentials`.

- HTTP error responses become `server` errors; status 0 (network, CORS) and aborts become `transport` errors.
- Aborting a call (`{ signal }`) cancels the `HttpClient` request.

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
