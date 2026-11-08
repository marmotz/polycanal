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

Le client reproduit l'arbre du contrat : les actions deviennent des méthodes, les événements des poignées.

## Appeler une action

```ts
const user = await server.users.get({ id: 'u1' });
await server.households.list();                       // no input: no argument
await server.projects.analyses();                     // only optional fields: argument optional
await server.users.get({ id: 'u1' }, { signal, context: { retry: true }, interceptors: [trace] });
```

Un appel :

1. valide l'argument avec le schéma d'input, et envoie la valeur validée (valeurs par défaut et transformations
   appliquées) ;
2. construit la requête native, la fait passer par la chaîne d'intercepteurs et l'envoie ;
3. lit la réponse : un succès est validé avec le schéma d'output puis renvoyé, une erreur est validée avec le schéma
   `errors` correspondant puis levée.

Options d'appel :

| Option         | Rôle                                                                            |
|----------------|---------------------------------------------------------------------------------|
| `signal`       | `AbortSignal` qui annule la requête                                             |
| `context`      | Données libres visibles des intercepteurs et des drivers                        |
| `interceptors` | Intercepteurs de cet appel seulement, typés avec la requête native du driver    |

## Événements

```ts
const unsubscribe = server.notifications.subscribe((notification) => show(notification), {
  onError: (error) => console.warn(error), // invalid messages and transport failures
});

await server.chat.publish({ text: 'hello' });
```

Les messages publiés sont validés avant l'envoi, les messages reçus avant d'atteindre l'écouteur.
