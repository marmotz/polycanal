---
title: Angular
---

# Angular

`@polycanal/angular` fait passer les appels REST par le `HttpClient` d'Angular, pour que les intercepteurs de
l'application (`withInterceptors()`, `HTTP_INTERCEPTORS`) continuent de s'appliquer, et expose les actions sous forme
de ressources Angular.

```bash
npm install @polycanal/core @polycanal/rest @polycanal/angular
```

## Driver

Créez le client dans un service, dans un contexte d'injection :

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

`angularRest(http, options)` fait la même chose avec un `HttpClient` explicite. Les options sont celles de
[`fetchRest()`](./rest.md#fetchrest), plus `withCredentials`.

- Les réponses HTTP en erreur deviennent des erreurs `server` ; le statut 0 (réseau, CORS) et les annulations
  deviennent des erreurs `transport`.
- Annuler un appel (`{ signal }`) annule la requête `HttpClient`.

## Ressources

`actionResource()` expose une action sous forme de `resource()` Angular : elle se recharge quand ses paramètres
changent et annule l'appel précédent.

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

Les ressources sont faites pour la lecture. Appelez directement les mutations :
`await this.server.households.rename({ ... })`.
