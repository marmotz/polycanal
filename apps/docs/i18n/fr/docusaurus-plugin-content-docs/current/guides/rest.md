---
title: REST
---

# REST

`@polycanal/rest` décrit des endpoints REST et les transporte avec `fetch`.

## Bindings

```ts
import { rest } from '@polycanal/rest';

rest.get('/households');
rest.post('/auth/login', { status: 200 });
rest.put('/users/:id');
rest.patch('/households/:householdId/members/:userId');
rest.delete('/households/:id', { status: [200, 204] });
```

- Les paramètres de chemin sont des segments `:name`. Chacun doit correspondre à un champ de l'input, ce qui est
  vérifié à la compilation et à la définition de l'action.
- `status` liste les codes de succès. Par défaut : tout statut 2xx. Tout autre statut est une erreur serveur.
- `body: 'multipart'` envoie les champs du body en `multipart/form-data` (voir [Envoi de fichiers](#envoi-de-fichiers)).
  Interdit sur `GET` et `DELETE`.
- `response: 'blob'` livre une réponse de succès sous forme de `File` (voir [Réponses binaires](#réponses-binaires)).

## Règles de répartition

Chaque champ de l'input va à un seul endroit de la requête :

1. sa `source` explicite, s'il en a une ;
2. sinon le **chemin**, si son nom réseau est un paramètre de chemin ;
3. sinon la **query string** pour `GET` et `DELETE`, le **body** pour `POST`, `PUT` et `PATCH`.

Les valeurs sont écrites ainsi :

| Valeur         | Chemin, query string, en-tête                                              | Body          |
|----------------|----------------------------------------------------------------------------|---------------|
| `undefined`    | Ignorée                                                                    | Ignorée       |
| `null`         | Ignorée                                                                    | Conservée     |
| Tableau        | Query : la clé est répétée (`tags=a&tags=b`). En-tête : jointes par `, `   | Encodé        |
| `Date`         | Chaîne ISO                                                                 | Encodée       |
| Objet          | JSON                                                                       | Encodé        |
| Champ racine   | Ses entrées sont étalées (query, en-têtes)                                 | Tout le body  |

Le body est encodé par le codec (JSON par défaut) et envoyé avec son `Content-Type` ; chaque requête envoie un en-tête
`Accept` avec le type de média du codec. Les noms d'en-têtes sont en minuscules.

## Envoi de fichiers

Avec `body: 'multipart'`, les champs du body sont envoyés dans un `FormData` au lieu d'être encodés par le codec. Un
champ fichier a pour valeur un `Blob` ou un `File`, et se déclare avec un schéma de fichier :

```ts
action({
  transport: rest.post('/listings/:id/photos', { body: 'multipart' }),
  input: input({
    id: z.string(), // chemin
    cover: z.file().mime(['image/jpeg']), // un fichier
    photos: z.array(z.file().max(5_000_000)), // plusieurs fichiers sous un même nom
    title: z.string(), // champ texte
    price: z.number(),
  }),
  output: z.void(),
});
```

- Un fichier est ajouté tel quel, avec son nom ; un tableau donne une part par élément, sous le même nom.
- Les valeurs texte s'écrivent comme dans la query string : chaînes telles quelles, dates en chaîne ISO, nombres et
  booléens avec `String()`, objets en JSON. `undefined` et `null` sont ignorés.
- Aucun en-tête `Content-Type` n'est posé : le client HTTP l'ajoute avec la frontière.
- Un champ racine en body est refusé : chaque part doit avoir un nom.
- Les fichiers sont validés côté client comme les autres champs, avant l'envoi de la requête.

`HttpRequest.body` vaut une `string`, un `FormData` ou `undefined` : un interceptor qui lit le body doit tester son type.

`multipartParts(formData)` et `fileProgress(parts, loaded, total)` estiment la progression de chaque fichier à partir
des octets envoyés pour toute la requête, pour les drivers qui remontent `onUploadProgress`.

## Réponses binaires

Avec `response: 'blob'`, la requête accepte tout type de média (`Accept: */*`) et une réponse de succès est livrée sous
forme de `File` : son type vient de `Content-Type`, son nom du `filename` de `Content-Disposition`, à défaut du dernier
segment du chemin. Déclarez la sortie avec `z.file()`. Les réponses d'erreur restent décodées par le codec.

Pour ces bindings, le sender renvoie le body en `blob` (avec `text: ''`).

## Réponses

- Une réponse dont le content type correspond au codec (ou qui n'en a pas) est décodée ; `application/problem+json`
  correspond à JSON.
- Une réponse d'un autre content type est conservée en texte : une page d'erreur HTML d'un proxy vous parvient comme
  une chaîne.
- Un body vide vaut `undefined`.
- Un body impossible à décoder est une erreur de transport.

## `fetchRest()`

```ts
import { fetchRest } from '@polycanal/rest';

fetchRest({
  baseUrl: 'https://api.example.com', // or '/api', or omitted for the same origin
  headers: () => ({ 'X-Tenant': currentTenant() }), // static object or function called for each request
  credentials: 'include', // cookies to another origin
  fetch: customFetch, // default: global fetch
  XMLHttpRequest: null, // used for upload progress, default: global XMLHttpRequest (see the client guide)
  interceptors: [auth], // see Interceptors
  codec: jsonCodec, // default codec of the driver
});
```

## Un autre client HTTP

`restTransport(send, options)` construit un driver REST autour de n'importe quel client HTTP. `send` reçoit la requête
construite et le signal d'annulation, et renvoie `{ status, headers, text }` :

```ts
import { restTransport } from '@polycanal/rest';

const driver = restTransport(async (request, signal) => {
  const response = await myHttpClient(request.method, request.url, request.headers, request.body, signal);

  return { status: response.status, headers: response.headers, text: response.text };
});
```

`fetchRest()` et le [driver Angular](./angular.md) sont construits ainsi.

## Codecs

Les bodies sont encodés et décodés par un codec. Seul JSON est fourni pour l'instant ; un codec peut être défini par
driver (`fetchRest({ codec })`) ou par action (`action({ codec })`) :

```ts
const textCodec = {
  contentType: 'text/plain',
  encode: (value: unknown) => String(value),
  decode: (text: string) => text,
};
```
