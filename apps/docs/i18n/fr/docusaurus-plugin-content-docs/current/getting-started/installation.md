---
title: Installation
---

# Installation

Polycanal est découpé en petits packages sous le scope `@polycanal/*`. Installez le cœur, le driver REST et une
bibliothèque de schémas :

```bash
npm install @polycanal/core @polycanal/rest zod
```

Ajoutez ensuite les packages dont vous avez besoin :

| Besoin                                         | Package              |
|------------------------------------------------|----------------------|
| Driver `HttpClient` d'Angular et ressources    | `@polycanal/angular` |
| Générer un contrat depuis un document OpenAPI  | `@polycanal/openapi` |
| Générer un contrat depuis une app NestJS       | `@polycanal/nest`    |
| Générer un contrat depuis une app Express      | `@polycanal/express` |

Le package `polycanal` réexporte `@polycanal/core`.

## Prérequis

- **ESM uniquement.** Node 22.12+ et Bun chargent les packages depuis de l'ESM et, grâce à `require(esm)`, depuis des
  projets CommonJS (un build NestJS par défaut, par exemple).
- **Environnements :** Node et Bun côté back, tout navigateur récent côté front.
- **TypeScript :** utilisez un `moduleResolution` à `bundler`, `node16` ou `nodenext`, pour que les `exports` des
  packages soient résolus.
- **Schémas :** n'importe quelle bibliothèque implémentant [Standard Schema](https://standardschema.dev/). La
  génération de code demande aussi [Standard JSON Schema](https://standardschema.dev/json-schema), implémenté par
  Zod 4.2+.
