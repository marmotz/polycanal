---
title: Express
---

# Express

`@polycanal/express` découvre les routes d'une application Express 4 ou 5 et génère le contrat du front.

```bash
npm install --save-dev @polycanal/express
```

## Marquer les endpoints

`endpoint()` est un middleware qui ne fait rien d'autre que porter les schémas d'une route. Seules les routes marquées
sont décrites.

```ts
import { endpoint } from '@polycanal/express';

app.post(
  '/auth/login',
  endpoint({ name: 'login', namespace: 'auth', input: LoginSchema, output: SessionSchema, errors: { 401: ErrorSchema } }),
  login,
);
```

Avec `@reflet/express`, rattachez-le avec `@Use()` :

```ts
@Router('/households')
export class HouseholdsRouter {
  @Patch('/:id/members/:userId')
  @Use(
    endpoint({
      name: 'updateMemberRole',
      namespace: 'households',
      input: {
        id: z.string(),
        userId: { source: 'path', schema: z.string() },
        toUserId: { source: 'body', alias: 'userId', schema: z.string() },
        role: RoleSchema,
      },
      output: MemberSchema,
    }),
  )
  updateMemberRole(@Params('id') id: string, @Params('userId') userId: string, @Body() body: RoleBody) {
    // ...
  }
}
```

| Option de `endpoint()` | Rôle                                                                                   |
|------------------------|----------------------------------------------------------------------------------------|
| `output`               | Schéma de la réponse. Obligatoire                                                      |
| `input`                | Champs (comme dans `input()`) ou schéma objet. Les paramètres de chemin non décrits sont ajoutés comme chaînes |
| `errors`               | Schémas des corps d'erreur, par statut HTTP                                            |
| `status`               | Codes de succès                                                                        |
| `name`, `namespace`    | Emplacement dans le contrat. Nom par défaut : construit à partir de la méthode et du chemin (`getHouseholdsById`) |
| `meta`                 | Description libre                                                                      |

## Vérifier les réponses

`validateResponses(app)` fait valider à chaque route `endpoint()` ce qu'elle répond avec `res.json()` (ou `res.send()`
d'un objet) avant que la réponse parte, telle que le client la lira (après JSON) :

```ts
import { validateResponses } from '@polycanal/express';

validateResponses(app, { onInvalid: process.env.NODE_ENV === 'production' ? 'log' : 'throw' });
```

`onInvalid` vaut `'throw'` (défaut : journalisée et remplacée par une erreur 500), `'log'` (journalisée et envoyée quand
même) ou une fonction appelée avec `{ route, issues, value }` avant l'envoi de la réponse.

## Générer

```ts title="scripts/generate-contract.ts"
import { generateExpressContract } from '@polycanal/express';
import { createApp } from '../src/app';

const { report } = generateExpressContract(createApp(), { output: '../shared/src/contract.generated.ts' });
console.log(report);
```

L'application n'a besoin que de ses routes montées ; elle n'a pas besoin d'écouter.
`discoverExpressContract(app, { config })` renvoie la description et le rapport (`undescribed`, `skipped`,
`conflicts`) sans générer de code.

## Express 5

Express 5 ne conserve pas le chemin de montage des sous-routeurs (`app.use('/api', router)`). Enregistrez-les avant le
montage :

```ts
import express from 'express';
import { recordMountPaths } from '@polycanal/express';

recordMountPaths(express); // once, before building the application
```

Express 4 n'a besoin de rien : les chemins de montage sont reconstruits depuis les expressions régulières du routeur.
`recordMountPaths()` fonctionne aussi avec Express 4.

## Limites

- Les routes déclarées avec une expression régulière ou plusieurs chemins sont ignorées.
- Les sous-applications montées avec `app.use(autreApp)` cachent leurs routes : montez plutôt des routeurs.
