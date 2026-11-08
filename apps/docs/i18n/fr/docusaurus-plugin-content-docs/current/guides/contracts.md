---
title: Contrats
---

# Contrats

Un contrat décrit ce qu'un serveur expose. C'est du TypeScript ordinaire : les types sont inférés depuis les schémas,
sans étape de build.

## `defineContract()`

```ts
import { defineContract } from '@polycanal/core';

export const householdsContract = defineContract({
  list: action({ ... }),
  updateMemberRole: action({ ... }),
});

export const contract = defineContract({
  auth: { login: action({ ... }) },   // nested object: namespace
  households: householdsContract,      // contracts compose
  notifications: event({ ... }),
});
```

- L'imbrication donne les namespaces du client : `server.households.list()`.
- Les contrats peuvent être découpés par fichier puis composés. Un contrat d'une seule opération est valide, ce qui
  permet d'adopter Polycanal un endpoint à la fois.
- Les noms ne doivent être ni vides ni contenir de `.` : le chemin pointé (`households.list`) est l'identifiant de
  l'opération.
- `defineContract()` vérifie l'arbre et lève une `ContractDefinitionError` qui localise l'élément fautif.

## `action()`

Une opération requête/réponse, nommée librement d'après ce que le serveur expose (sans se limiter au CRUD).

```ts
action({
  transport: rest.post('/auth/login', { status: 200 }),
  input: LoginRequestSchema,
  output: LoginResponseSchema,
  errors: { 401: InvalidCredentialsSchema },
  meta: { summary: 'Log in', tags: ['auth'] },
});
```

| Champ       | Rôle                                                                                       |
|-------------|--------------------------------------------------------------------------------------------|
| `transport` | Binding produit par un package de driver (`rest.get()`, `rest.post()`...). Obligatoire     |
| `input`     | Champs décrits avec `input({...})`, ou schéma objet. Absent : l'action ne prend pas d'argument |
| `output`    | Schéma de la réponse. Utilisez `z.void()` pour une réponse vide                            |
| `errors`    | Schémas des corps d'erreur, par statut HTTP pour REST                                      |
| `codec`     | Codec du body propre à l'action (par défaut : JSON)                                        |
| `meta`      | Description libre (`summary`, `description`, `tags`, `deprecated`)                         |

## `input()`

`input()` décrit l'argument unique d'une action champ par champ, avec la destination de chaque champ dans le
transport. La signature d'appel reste un objet à plat.

```ts
updateMemberRole: action({
  transport: rest.patch('/user/:userId'),
  input: input({
    householdId: z.string(),                                            // default rules
    userId: { source: 'path', schema: z.string() },                     // explicit source
    toUserId: { source: 'body', alias: 'userId', schema: z.string() },  // sent as body.userId
    role: HouseholdRoleSchema,
  }),
  output: z.void(),
}),

await server.households.updateMemberRole({ householdId: 'h1', userId: 'u1', toUserId: 'u2', role: 'admin' });
// PATCH /user/u1  {"householdId":"h1","userId":"u2","role":"admin"}
```

Un champ est soit un schéma (forme courte : les règles par défaut du transport s'appliquent), soit un descripteur :

| Clé du descripteur | Rôle                                                                                      |
|--------------------|-------------------------------------------------------------------------------------------|
| `schema`           | Schéma du champ, depuis n'importe quelle bibliothèque Standard Schema                     |
| `source`           | Destination du champ. REST : `'path'`, `'query'`, `'body'` ou `'header'`. Vérifiée au typage |
| `alias`            | Nom envoyé sur le réseau, quand il diffère du nom dans l'appel                            |
| `root`             | La valeur constitue tout le contenu de sa source (un body tableau, par exemple). Exige `source` |

Règles vérifiées à la définition du contrat (et, quand c'est possible, à la compilation) :

- une `source` doit être prise en charge par le binding ;
- un champ racine doit déclarer sa source, et aucun autre champ ne peut utiliser cette source ;
- deux champs ne peuvent pas avoir le même nom réseau dans la même source ;
- les champs exigés par le binding (paramètres de chemin REST) doivent exister, avec la bonne source ou sans source.

Les champs dont le schéma accepte `undefined` (`.optional()`, `.default()`) sont optionnels à l'appel. Quand tous les
champs le sont, l'argument lui-même peut être omis.

Passer un schéma objet existant (`input: LoginRequestSchema`) fonctionne aussi : chaque clé suit les règles par défaut.
Ses clés ne sont comparées aux paramètres de chemin qu'à la compilation.

## `event()`

Un canal d'événements, transporté par un driver d'événements (WebSocket, SSE...). Au moins `send` ou `receive` est
obligatoire.

```ts
notifications: event({ transport: ws.event('notification'), receive: NotificationSchema }),
chat: event({ transport: ws.event('chat:message'), send: ChatMessageSchema, receive: ChatMessageSchema }),
```

Le client n'expose `publish()` que si `send` existe, et `subscribe()` que si `receive` existe.

:::note

Aucun driver d'événements n'est encore disponible : le modèle et le client gèrent les événements, le driver WebSocket
est prévu.

:::

## Inférer les types

```ts
import type { ActionInputOf, ActionOutputOf, EventReceiveOf } from '@polycanal/core';

type LoginInput = ActionInputOf<typeof contract.auth.login>;
type Households = ActionOutputOf<typeof contract.households.list>;
```
