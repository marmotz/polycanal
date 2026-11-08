---
title: NestJS
---

# NestJS

`@polycanal/nest` découvre les routes d'une application NestJS et génère le contrat du front. Les schémas des requêtes
sont lus dans les pipes que l'application utilise déjà ; ce qui ne peut pas être découvert se rattache avec
`@Endpoint()`.

```bash
npm install --save-dev @polycanal/nest
```

## Marquer les endpoints

Seuls les handlers décorés avec `@Endpoint()` sont décrits : un projet peut adopter Polycanal une route à la fois.

```ts
import { Endpoint } from '@polycanal/nest';

@Controller('auth')
export class LoginController {
  @Post('login')
  @HttpCode(200)
  @Endpoint({ output: LoginResponseSchema, errors: { 401: InvalidCredentialsSchema } })
  login(@Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest) {
    // ...
  }
}
```

| Option de `@Endpoint()` | Rôle                                                                                   |
|-------------------------|----------------------------------------------------------------------------------------|
| `output`                | Schéma de la réponse. Obligatoire, sauf si `outputOf` en trouve un                     |
| `errors`                | Schémas des corps d'erreur, par statut HTTP                                            |
| `input`                 | Champs à ajouter ou remplacer (`{ page: z.coerce.number() }`), comme dans `input()` ; un champ racine remplace les champs découverts dans sa source |
| `name`                  | Nom de l'opération. Par défaut : le nom du handler                                     |
| `namespace`             | Namespace. Par défaut : `@EndpointNamespace()` ou les segments fixes du chemin du controller |
| `meta`                  | Description libre                                                                      |

## Générer

Générez le contrat avec la [CLI](./cli.md), depuis un `polycanal.config.ts` dont la source est `nestSource()` :

```ts
source: nestSource({ app: () => NestFactory.create(AppModule, { preview: true, logger: false }) }),
```

`preview: true` construit le graphe des modules sans créer de provider : rien ne se connecte à une base de données. Les
schémas trouvés dans les `schemaModules` configurés sont importés par le contrat généré, et un corps validé par l'un
d'eux reste un champ racine `body` entier.

`generateNestContract(app, options)` et `discoverNestContract(app, options)` restent disponibles pour des scripts
personnalisés ; leur option `resolveSchema` est celle qu'utilise la CLI pour importer les schémas.

## Ce qui est découvert

- La méthode, les chemins (préfixe global compris) et `@HttpCode()`, qui devient le statut de succès du binding.
- `@Body()` et `@Query()` avec un pipe : le schéma du pipe, étalé en champs quand c'est un objet ; un body qui n'est
  pas un objet devient un champ racine `body`.
- `@Param('x')`, `@Query('x')`, `@Headers('x')` : un champ chacun, avec le schéma du pipe, ou décrit comme une chaîne
  sans pipe (avec un avertissement, sauf pour les paramètres de chemin, qui sont des chaînes par nature).
- Les paramètres de chemin que le handler ne lit pas sont décrits quand même.
- Un nom utilisé par deux sources le garde pour le chemin et prend un préfixe pour l'autre (`bodyUserId`, envoyé comme
  `userId`).

Les pipes sont lus par `schemaOf` : par défaut, la première propriété propre du pipe qui est un Standard Schema, ce
qui correspond à l'usage courant `new ZodValidationPipe(schema)`.

## Options

| Option         | Rôle                                                                                    |
|----------------|-----------------------------------------------------------------------------------------|
| `include`      | `'decorated'` (par défaut) ou `'all'` (toutes les routes qui ont un schéma de réponse)  |
| `outputOf`     | Lit les schémas de réponse d'un décorateur du projet, par exemple `@ZodResponse()`      |
| `schemaOf`     | Lit le schéma d'un pipe personnalisé                                                    |
| `config`       | Contrat écrit en TS : ses opérations l'emportent toujours, les conflits sont signalés   |
| `globalPrefix` | Préfixe global, quand il ne peut pas être lu dans l'application                         |

```ts
generateNestContract(app, {
  include: 'all',
  outputOf: (controller, handler) => Reflect.getMetadata('zodResponseSchema', controller.prototype[handler]),
});
```

## Rapport

`report` liste les routes `undescribed` (non décorées), les routes `skipped` et la raison (pas de schéma de réponse,
chemin à joker...), les `warnings`, et les `conflicts` avec la config. `discoverNestContract(app, options)` renvoie la
description et le rapport sans générer de code.
