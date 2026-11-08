---
title: CLI
---

# CLI

`polycanal generate` écrit les contrats front-end décrits par un fichier de configuration. Les fichiers générés sont
des contrats écrits comme à la main : ils importent les schémas runtime avec lesquels le serveur valide, si bien qu'un
contrat généré depuis des décorateurs s'utilise, et valide, exactement comme un contrat écrit à la main.

```bash
npm install --save-dev @polycanal/cli
```

## Configuration

`polycanal.config.ts`, à côté du code serveur :

```ts title="apps/api/polycanal.config.ts"
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { defineConfig } from '@polycanal/cli';
import { nestSource } from '@polycanal/nest';
import * as shared from '@my-app/shared';
import { AppModule } from './src/app.module';

export default defineConfig({
  source: nestSource({ app: () => NestFactory.create(AppModule, { preview: true, logger: false }) }),
  schemaModules: { '@my-app/shared': shared },
  outputs: [
    { file: '../web/src/app/api/contract.generated.ts' },
    { file: '../admin/src/app/api/contract.generated.ts', include: ['admin'], exportName: 'adminContract' },
  ],
});
```

| Option             | Rôle                                                                                          |
|--------------------|-----------------------------------------------------------------------------------------------|
| `source`           | D'où vient le contrat : `nestSource()` de `@polycanal/nest`                                   |
| `schemaModules`    | Modules dont les fichiers générés importent les schémas, par le spécificateur qu'utilise le front |
| `outputs`          | Fichiers à écrire, relatifs au fichier de configuration                                       |
| `allowRegenerated` | Accepte les schémas qu'aucun module n'exporte (voir plus bas). Défaut : `false`               |
| `validation`       | Bibliothèque de validation des schémas générés. Défaut : Zod                                  |
| `bindings`         | Émetteurs de bindings d'autres drivers (REST est inclus)                                      |

Chaque sortie prend un `file`, un `exportName` optionnel (défaut `contract`) et un `include` optionnel : ids
d'opérations ou préfixes de namespaces à garder, pour générer un contrat par application front-end.

## Schémas importés

Chaque schéma trouvé par la source (pipes des requêtes, réponses et champs de `@Endpoint()`) est cherché, par
identité, parmi les exports de `schemaModules`. Un schéma trouvé est importé par le fichier généré ; un corps ou une
query décrit par un tel schéma est gardé entier, comme champ racine `body` (ou `query`), pour que ses règles sur
l'objet entier s'appliquent :

```ts
import { listingSchema, updateListingSchema } from '@my-app/shared';

update: action({
  transport: rest.patch('/projects/:projectId/listings/:listingId'),
  input: input({
    projectId: { source: 'path', schema: idSchema },
    listingId: { source: 'path', schema: idSchema },
    body: { source: 'body', root: true, schema: updateListingSchema },
  }),
  output: listingSchema,
}),
```

Un schéma qu'aucun module n'exporte devrait être généré depuis son JSON Schema, en perdant ce que JSON Schema ne sait
pas exprimer (transformations, raffinements, messages personnalisés) : la génération échoue et le liste. Exportez-le
depuis un module partagé, ou passez `allowRegenerated: true` pour accepter la perte, signalée en avertissements.

## Commandes

```bash
polycanal generate                     # polycanal.config.{ts,mts,js,mjs} du répertoire courant
polycanal generate --config other.ts
polycanal generate --check             # n'écrit rien, échoue si un fichier n'est pas à jour (CI)
```

La configuration est chargée par `import()`. Une configuration TypeScript demande un runtime qui charge TypeScript :
Bun, ou Node 22.18+ (suppression des types). Une application Nest à décorateurs demande Bun
(`bun --bun polycanal generate`) ou un loader comme `tsx`.

`generate(config, { root, check })` de `@polycanal/cli` fait la même chose depuis du code.
