---
title: Architecture
---

# Architecture

```
 Description sources             Internal model            Outputs
 ┌────────────────────┐      ┌──────────────────┐      ┌─────────────────────────┐
 │ Contract in TS     │      │                  │      │ Typed client            │
 │ Decorators/markers │ ───▶ │ Normalized model │ ───▶ │ Generated contracts     │
 │ OpenAPI (import)   │      │ (operations,     │      │ (types + schemas)       │
 │ Introspection      │      │  schemas)        │      │                         │
 └────────────────────┘      └──────────────────┘      └─────────────────────────┘
```

## Canaux

Polycanal parle de canaux plutôt que d'endpoints. Il en existe deux familles :

- les **actions** : des opérations requête/réponse, nommées librement d'après ce que le serveur expose ;
- les **événements** : des canaux `publish` / `subscribe`.

Chaque driver déclare la famille qu'il transporte : un `event()` ne peut pas utiliser un binding REST, c'est une
erreur de compilation.

## Le modèle interne

`toModel(contract)` aplatit un contrat en ses opérations, chacune avec un identifiant (`households.list`), son binding,
ses schémas et la répartition des champs de son input. Les drivers, générateurs et exporteurs consomment ce modèle.

## Inférence ou génération

- Un contrat écrit en TS s'utilise tel quel : les types sont inférés depuis les schémas, sans étape de build.
- Un contrat issu d'un document OpenAPI ou d'un serveur est **généré** en TypeScript avec des schémas d'exécution, car
  la validation a besoin de schémas, pas seulement de types.

## Priorité des sources

Quand un adaptateur serveur découvre des routes, un contrat écrit en TS (la config) a la priorité la plus haute : les
opérations découvertes peuvent le compléter mais jamais modifier ce qu'il déclare, et chaque désaccord est signalé.

## Contrat partagé

Le contrat vit dans un package ou un répertoire partagé entre le back et le front. Le front importe le contrat, jamais
du code serveur. Les adaptateurs serveur ne tournent que pendant le développement, pour générer ce contrat.
