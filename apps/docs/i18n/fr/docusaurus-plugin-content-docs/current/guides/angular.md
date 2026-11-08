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
[`fetchRest()`](./rest.md#fetchrest), plus :

| Option            | Rôle                                                                                         |
|-------------------|----------------------------------------------------------------------------------------------|
| `withCredentials` | Envoie les cookies vers une autre origine (`withCredentials` de `HttpClient`)                 |
| `httpContext`     | `(call) => HttpContext \| undefined` : le `HttpContext` de chaque requête, pour les intercepteurs |

- Les réponses HTTP en erreur deviennent des erreurs `server` ; le statut 0 (réseau, CORS) et les annulations
  deviennent des erreurs `transport`.
- Annuler un appel (`{ signal }`) annule la requête `HttpClient`.

### Corps

Avec le codec JSON par défaut, le corps de la requête est passé à `HttpClient` sous forme de valeur et la réponse est
lue par `HttpClient` lui-même : les intercepteurs Angular de l'application voient des objets, corps d'erreur compris,
exactement comme avec un appel direct à `HttpClient`. Avec un autre codec, les corps sont échangés en texte et décodés
par le codec.

Un [corps multipart](./rest.md#envoi-de-fichiers) est passé à `HttpClient` sous forme de `FormData` : les intercepteurs
Angular voient le `FormData`, et le navigateur pose son `Content-Type` avec la frontière. Un binding
[`response: 'blob'`](./rest.md#réponses-binaires) est demandé avec `responseType: 'blob'` et se résout en `File` ; ses
réponses en erreur restent décodées en JSON.

### Progression

Avec [`onUploadProgress` ou `onDownloadProgress`](./client.md#progression), la requête est envoyée avec
`reportProgress: true` et les événements de progression de `HttpClient` (`UploadProgress`, `DownloadProgress`)
alimentent les callbacks, avec la progression estimée de chaque fichier d'un corps multipart. Au début de la réponse,
chaque fichier est complet. Sans callback, aucun événement de progression n'est demandé.

```ts
await server.listings.addPhoto({ id: 'l1', photo }, { onUploadProgress: ({ loaded, total }) => render(loaded, total) });
```

Seul le backend `XMLHttpRequest` de `HttpClient` remonte les octets envoyés. Avec le backend `fetch` (le défaut de
`provideHttpClient()` dans Angular 22), `onUploadProgress` n'est pas appelé : fournir `HttpClient` avec `withXhr()` pour l'obtenir.
`onDownloadProgress` fonctionne avec les deux backends.

```ts
provideHttpClient(withXhr(), withInterceptors([...]));
```

### `HttpContext`

Les intercepteurs Angular lisent souvent un `HttpContextToken` posé par l'appelant. `httpContext` le construit à partir
de l'appel : son opération (`call.operation.id`) et le `context` passé à l'appel.

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

### Erreurs levées par les intercepteurs Angular

Un intercepteur Angular qui lève sa propre erreur (au lieu de laisser passer la `HttpErrorResponse`) fait échouer
l'appel avec une erreur `transport` dont la `cause` est cette erreur : tout échec d'un appel reste une `PolycanalError`.
Pour rendre l'erreur de l'application aux appelants, relancez-la depuis un intercepteur du client :

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

### Tester avec `HttpTestingController`

Le client valide l'entrée de façon asynchrone avant l'envoi : la requête arrive dans `HttpTestingController` quelques
microtâches après l'appel. Attendez-la avant `expectOne()` :

```ts
const pending = server.households.list();
const request = await vi.waitFor(() => backend.expectOne('/api/households'));
request.flush([{ id: 'h1', name: 'Home' }]);
```

La réponse est validée par le schéma de sortie : envoyez des corps complets.

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
