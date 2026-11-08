---
title: Client
---

# Client

## `createClient()`

```ts
import { createClient } from '@polycanal/core';
import { fetchRest } from '@polycanal/rest';

const server = createClient(contract, {
  drivers: [fetchRest({ baseUrl: '/api' })],
  interceptors: [logging],                                   // every call
  operations: { households: { interceptors: [tenant] } },   // one operation or a whole namespace
});
```

- `drivers` : implémentations des drivers, sous forme de tableau ou d'objet. Chaque binding est transporté par le
  driver dont le nom correspond à son `driver` (`'rest'` pour les bindings `rest.*`).
- `interceptors` et `operations` : voir les [intercepteurs](./interceptors.md).
- `send` : ce qu'envoie un argument valide, voir [ce qu'envoie un appel](#ce-quenvoie-un-appel).
- `validator` : exécute chaque schéma du contrat, voir les [options de validation](#options-de-validation).
- `mapError` : transforme un échec en erreur propre à l'application, voir [convertir les erreurs](#convertir-les-erreurs).

Le client reproduit l'arbre du contrat : les actions deviennent des méthodes, les événements des poignées.

## Appeler une action

```ts
const user = await server.users.get({ id: 'u1' });
await server.households.list();                       // no input: no argument
await server.projects.analyses();                     // only optional fields: argument optional
await server.users.get({ id: 'u1' }, { signal, context: { retry: true }, interceptors: [trace] });
```

Un appel :

1. valide l'argument avec le schéma d'input, puis l'envoie tel qu'il a été donné (voir
   [ce qu'envoie un appel](#ce-quenvoie-un-appel)) ;
2. construit la requête native, la fait passer par la chaîne d'intercepteurs et l'envoie ;
3. lit la réponse : un succès est validé avec le schéma d'output puis renvoyé, une erreur est validée avec le schéma
   `errors` correspondant puis levée.

Options d'appel :

| Option               | Rôle                                                                            |
|----------------------|---------------------------------------------------------------------------------|
| `signal`             | `AbortSignal` qui annule la requête                                             |
| `context`            | Données libres visibles des intercepteurs et des drivers                        |
| `interceptors`       | Intercepteurs de cet appel seulement, typés avec la requête native du driver    |
| `onUploadProgress`   | Appelé pendant l'envoi du corps de la requête, voir [progression](#progression) |
| `onDownloadProgress` | Appelé pendant la réception de la réponse, voir [progression](#progression)     |

## Progression

```ts
const controller = new AbortController();

await server.listings.addPhoto(
  { id: 'l1', photo },
  {
    signal: controller.signal, // controller.abort() cancels the upload
    onUploadProgress: ({ loaded, total, files }) => render(loaded, total, files),
    onDownloadProgress: ({ loaded, total }) => render(loaded, total),
  },
);
```

- `onUploadProgress` reçoit les octets envoyés pour toute la requête (`total` vaut `undefined` quand il est inconnu)
  et, pour un [corps multipart](./rest.md#envoi-de-fichiers), la progression estimée de chaque fichier dans l'ordre
  du corps (`field`, `name`, `loaded`, `total`). À la fin de l'envoi, chaque fichier est complet.
- `onDownloadProgress` reçoit les octets reçus ; `total` vient de `Content-Length` et vaut `undefined` quand il est
  absent ou que la réponse est compressée.
- Un intercepteur qui rejoue la requête refait remonter la progression depuis zéro.
- Un driver qui ne sait pas mesurer ignore ces options.

Avec `fetchRest()` :

- Dans un navigateur, un appel avec `onUploadProgress` part avec `XMLHttpRequest`, seule API qui remonte les octets
  envoyés. L'option `fetch` ne s'y applique pas, et seul `credentials: 'include'` est pris en compte
  (`withCredentials`).
- Sans `XMLHttpRequest` (Node, Bun, ou `fetchRest({ XMLHttpRequest: null })`), le corps est sérialisé une fois
  (`total` exact) puis envoyé en flux à `fetch` à travers un compteur d'octets. Il mesure ce que `fetch` a lu, un peu
  en avance sur ce que le réseau a envoyé : la progression est approximative mais réelle.
- `onDownloadProgress` lit le corps de la réponse morceau par morceau, avec `fetch` ou `XMLHttpRequest`.
- `signal` annule la requête dans tous les cas ; l'appel est rejeté avec la raison de l'annulation comme cause.

## Événements

```ts
const unsubscribe = server.notifications.subscribe((notification) => show(notification), {
  onError: (error) => console.warn(error), // invalid messages and transport failures
});

await server.chat.publish({ text: 'hello' });
```

Les messages publiés sont validés avant l'envoi, les messages reçus avant d'atteindre l'écouteur.

## Ce qu'envoie un appel

Le serveur revalide ce qu'il reçoit, avec les mêmes schémas : un client front n'est pas le seul à pouvoir l'appeler.
Par défaut (`send: 'raw'`), un argument valide est donc envoyé tel que l'appelant l'a donné, limité aux champs déclarés,
et le serveur applique une seule fois les transformations et les valeurs par défaut. Les exécuter des deux côtés les
appliquerait deux fois : `z.number().transform((euros) => euros * 100)` changerait 12 en 1200 côté client, puis en
120000 côté serveur.

Quand le serveur ne revalide pas (une API tierce), `send: 'parsed'` envoie la sortie des schémas, pour tout le client
ou pour certaines opérations :

```ts
createClient(contract, {
  drivers,
  operations: { partners: { send: 'parsed' } }, // one operation or a whole namespace
});
```

Jusqu'au `send()` du driver, un appel s'exécute de façon synchrone quand ses schémas le sont : la requête part pendant
l'appel, et un test peut l'attendre juste après l'appel, sans patienter.

## Options de validation

Standard Schema valide une valeur sans options : les réglages d'une librairie, comme les messages d'erreur de Zod, ne
peuvent pas l'atteindre. `validator` remplace la façon dont chaque schéma s'exécute (champs d'entrée, réponses, corps
d'erreur, messages d'événements) :

```ts
import { zodValidator } from '@polycanal/zod';

const server = createClient(contract, {
  drivers: [fetchRest({ baseUrl: '/api' })],
  validator: zodValidator({ error: frenchMessage }), // what schema.safeParse(value, params) takes
});
```

`zodValidator()` parse les schémas Zod avec ces options et laisse les schémas des autres librairies à Standard Schema.
N'importe quelle fonction `(schema, value) => result` convient, pour une autre librairie.

## Convertir les erreurs

Tout appel en échec rejette avec une `PolycanalError` (voir les [erreurs](./errors.md)). Quand l'application a son
propre type d'erreur, `mapError` la convertit une seule fois pour tous les appels d'actions et publications
d'événements :

```ts
const server = createClient(contract, {
  drivers: [fetchRest({ baseUrl: '/api' })],
  mapError: (error) => (error.kind === 'input' ? new FormError(error.issues) : error),
});
```

Les erreurs qui ne sont pas des `PolycanalError` (levées par un intercepteur, par exemple) sont relancées telles quelles.
Le `onError` de `subscribe()` reçoit toujours la `PolycanalError`.
