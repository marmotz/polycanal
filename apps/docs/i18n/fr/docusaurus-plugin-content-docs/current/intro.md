---
slug: /
title: Introduction
sidebar_position: 1
---

# Polycanal

**Polycanal** est une bibliothèque TypeScript qui s'intercale entre un serveur et un front. Elle **décrit** ce qu'un
serveur existant expose, et donne au front un **client typé** dont chaque argument et chaque réponse sont **validés** :

```ts
const user = await server.auth.login({ email: 'ada@example.com', password: '...' }); // POST /auth/login
```

:::caution Travail en cours

Polycanal n'est pas encore publié. Cette documentation suit la branche `develop` (version **next**).

:::

## Pourquoi

Les clients typés viennent en général avec un framework serveur : tRPC, oRPC ou ts-rest exigent que le serveur soit
écrit avec leur routeur ou implémente leur contrat. On ne peut pas les poser devant un back-end qui existe déjà.
Polycanal prend le chemin inverse :

- **Le serveur reste libre.** Polycanal décrit les endpoints REST que le serveur a déjà. Il n'impose jamais la façon
  d'écrire le serveur, et les requêtes restent du REST et du JSON standards, lisibles dans l'onglet Réseau du
  navigateur.
- **Tout est validé.** Les paramètres sont validés avant l'envoi, les réponses à la réception. Les schémas viennent de
  n'importe quelle bibliothèque compatible [Standard Schema](https://standardschema.dev/) (Zod, Valibot, ArkType...).
- **Adoption progressive.** Décrivez un endpoint, utilisez-le, et laissez les autres tels quels.
- **Indépendant du framework.** Le client est du TypeScript standard : il renvoie des Promises et envoie ses
  requêtes avec `fetch`. Il fonctionne donc tel quel avec React, Vue, Svelte, Solid, Angular ou du JavaScript sans
  framework (vanilla), dans le navigateur comme dans Node ou Bun. Angular dispose en plus d'une
  [intégration optionnelle](./guides/angular.md) qui passe par `HttpClient`, pour conserver vos intercepteurs.

## Comment

1. **Décrivez** les endpoints dans un contrat, écrit à la main avec `defineContract()`, généré depuis un document
   OpenAPI, ou découvert depuis une application NestJS ou Express.
2. **Créez un client** à partir du contrat, avec un driver de transport : `fetch` partout, ou n'importe quel
   client HTTP que vous branchez (celui pour le `HttpClient` d'Angular est fourni).
3. **Appelez** `server.namespace.operation(input)` : typé, validé, et renvoyant la réponse validée.

Poursuivez avec l'[installation](./getting-started/installation.md) et le
[démarrage rapide](./getting-started/quick-start.md).
