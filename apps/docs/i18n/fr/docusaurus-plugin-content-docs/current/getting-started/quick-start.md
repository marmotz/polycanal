---
title: Démarrage rapide
---

# Démarrage rapide

Cet exemple décrit trois endpoints d'une API REST existante et les appelle depuis un client typé.

## 1. Décrire les endpoints

Un contrat est un arbre d'objets simples : l'imbrication donne les namespaces, les feuilles sont les opérations.
Chaque action indique comment elle est transportée (`transport`), ce qu'elle reçoit (`input`) et ce qu'elle renvoie
(`output`).

```ts title="contract.ts"
import { action, defineContract, input } from '@polycanal/core';
import { rest } from '@polycanal/rest';
import { z } from 'zod';

const HouseholdSchema = z.object({ id: z.string(), name: z.string() });

export const contract = defineContract({
  auth: {
    login: action({
      transport: rest.post('/auth/login'),
      input: z.object({ email: z.email(), password: z.string() }),
      output: z.object({ token: z.string() }),
      errors: { 401: z.object({ message: z.string() }) },
    }),
  },
  households: {
    list: action({
      transport: rest.get('/households'),
      output: z.array(HouseholdSchema),
    }),
    rename: action({
      transport: rest.patch('/households/:id'),
      input: input({ id: z.string(), name: z.string().min(1) }),
      output: HouseholdSchema,
    }),
  },
});
```

Le contrat n'importe aucun code serveur : placez-le dans un package ou un répertoire partagé entre le back et le front.

## 2. Créer le client

```ts title="server.ts"
import { createClient } from '@polycanal/core';
import { fetchRest } from '@polycanal/rest';
import { contract } from './contract';

export const server = createClient(contract, {
  drivers: [fetchRest({ baseUrl: 'https://api.example.com' })],
});
```

## 3. L'appeler

```ts
const { token } = await server.auth.login({ email: 'ada@example.com', password: 'secret' });
// POST https://api.example.com/auth/login  {"email":"ada@example.com","password":"secret"}

const households = await server.households.list();
// GET https://api.example.com/households

const home = await server.households.rename({ id: 'h1', name: 'Home' });
// PATCH https://api.example.com/households/h1  {"name":"Home"}
```

- `id` va dans le chemin parce que `/households/:id` le déclare ; les autres champs d'un `PATCH` vont dans le body.
  Voir les [règles du binding REST](../guides/rest.md).
- Les arguments et les valeurs de retour sont typés à partir des schémas. Un paramètre de chemin manquant est une
  erreur de compilation.
- Un argument invalide lève une `PolycanalError` de type `input` avant tout envoi ; une réponse invalide en lève une
  de type `output`. Voir [les erreurs](../guides/errors.md).

## Pour aller plus loin

- Répartissez les champs explicitement (chemin, query, body, en-têtes, alias) avec [`input()`](../guides/contracts.md).
- Ajoutez l'authentification avec les [intercepteurs](../guides/interceptors.md).
- Générez le contrat au lieu de l'écrire : depuis [OpenAPI](../guides/code-generation.md),
  [NestJS](../guides/nestjs.md) ou [Express](../guides/express.md).
