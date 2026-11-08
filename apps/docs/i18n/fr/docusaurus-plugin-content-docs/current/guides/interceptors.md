---
title: Intercepteurs
---

# Intercepteurs

Il n'y a pas d'abstraction d'authentification : les intercepteurs la couvrent, comme les en-têtes, les nouvelles
tentatives, la normalisation des erreurs et la transformation des réponses. Un intercepteur enveloppe l'envoi de la
requête native :

```ts
type Interceptor<TRequest, TResponse> = (
  request: TRequest,
  next: (request: TRequest) => Promise<TResponse>,
  context: InterceptorContext, // { call, driver }
) => Promise<TResponse>;
```

Pour les drivers REST, la requête est une `HttpRequest` (`method`, `url`, `headers`, `body`) et la réponse une
`HttpResponse` (`status`, `headers`, `text`, `body` décodé).

## Niveaux et ordre

Du plus externe au plus interne :

1. `createClient(contract, { interceptors })` : tous les appels ;
2. les `interceptors` du driver (`fetchRest({ interceptors })`) : tous les appels transportés par ce driver ;
3. `createClient(contract, { operations: { 'households': { interceptors } } })` : un identifiant d'opération ou un
   préfixe de namespace, les préfixes les plus courts d'abord ;
4. les `{ interceptors }` de l'appel.

Les intercepteurs globaux et par opération voient tous les drivers, leur type de requête n'est donc pas précisé ; les
intercepteurs de driver et d'appel sont typés avec la requête et la réponse du driver.

## Injecter un token

```ts
import { type HttpRequest, type HttpResponse, withHeaders } from '@polycanal/rest';
import type { Interceptor } from '@polycanal/core';

const bearer: Interceptor<HttpRequest, HttpResponse> = (request, next) =>
  next(withHeaders(request, { Authorization: `Bearer ${tokens.access}` }));
```

## Rafraîchir un token et rejouer

Rappeler `next` renvoie la requête. Un intercepteur peut aussi appeler le client lui-même :

```ts
const refresh: Interceptor<HttpRequest, HttpResponse> = async (request, next) => {
  const response = await next(withHeaders(request, { Authorization: `Bearer ${tokens.access}` }));

  if (response.status !== 401) {
    return response;
  }

  tokens = await server.auth.refresh({ refreshToken: tokens.refresh });

  return next(withHeaders(request, { Authorization: `Bearer ${tokens.access}` }));
};
```

Ne placez pas l'appel de rafraîchissement lui-même derrière cet intercepteur, sinon un rafraîchissement en échec
boucle : enregistrez l'intercepteur par opération, ou ignorez-le selon `context.call.operation.id`.

## Transformer une réponse

```ts
const unwrap: Interceptor<HttpRequest, HttpResponse> = async (request, next) => {
  const response = await next(request);

  return { ...response, body: (response.body as { data: unknown }).data }; // the output schema sees `data`
};
```

## Erreurs

Les erreurs levées par le driver arrivent aux intercepteurs sous forme de `PolycanalError` de type `transport`. Les
erreurs levées par un intercepteur se propagent telles quelles : un intercepteur peut donc les convertir dans les types
d'erreur de l'application.
