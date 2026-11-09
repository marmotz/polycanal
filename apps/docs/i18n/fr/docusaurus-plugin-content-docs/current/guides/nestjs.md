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
| `output`                | Schéma de la réponse. Obligatoire, sauf si `outputOf` en trouve un. TypeScript vérifie le type de retour du handler par rapport à lui |
| `errors`                | Schémas des corps d'erreur, par statut HTTP                                            |
| `input`                 | Champs à ajouter ou remplacer (`{ page: z.coerce.number() }`), comme dans `input()` ; un champ racine remplace les champs découverts dans sa source |
| `name`                  | Nom de l'opération. Par défaut : le nom du handler                                     |
| `namespace`             | Namespace. Par défaut : `@EndpointNamespace()` ou les segments fixes du chemin du controller |
| `meta`                  | Description libre                                                                      |

## Vérifier les réponses

Avec un `output`, TypeScript refuse un handler dont le type de retour ne correspond pas au type d'entrée du schéma (une
`Date` est acceptée là où JSON transporte une chaîne). Un handler qui répond par `@Res()` ne retourne rien : il lui faut
un `// @ts-expect-error` ou pas d'`output`.

À l'exécution, `EndpointOutputInterceptor` valide ce que répond chaque handler `@Endpoint()` avant que la réponse parte,
telle que le client la lira (après JSON) :

```ts
import { EndpointOutputInterceptor } from '@polycanal/nest';

app.useGlobalInterceptors(
  new EndpointOutputInterceptor({ onInvalid: process.env.NODE_ENV === 'production' ? 'log' : 'throw' }),
);
```

| `onInvalid`          | Une réponse qui ne correspond pas                                            |
|----------------------|------------------------------------------------------------------------------|
| `'throw'` (défaut)   | Journalisée et remplacée par une erreur 500 : les tests et le dev la voient  |
| `'log'`              | Journalisée et envoyée quand même                                            |
| fonction             | Appelée avec `{ route, issues, value }` ; ce qu'elle lève remplace la réponse |

Son option `outputOf` lit les schémas de réponse depuis un décorateur du projet, comme l'option de découverte.

## Envoi de fichiers

Les fichiers envoyés se valident avec des schémas de fichier (`z.file()`) par trois pipes. Chacun expose son schéma :
la découverte décrit alors la route avec un corps multipart (`body: 'multipart'` sur le binding).

```ts
import { filePipe, filesPipe, multipartBodyPipe } from '@polycanal/nest';

@Post('listings')
@UseInterceptors(FilesInterceptor('photos'))
@Endpoint({ output: ListingSchema })
create(
  @UploadedFiles(filesPipe(z.array(z.file().mime(['image/jpeg'])), { field: 'photos' })) photos: Express.Multer.File[],
  @Body(multipartBodyPipe(z.object({ title: z.string(), price: z.number() }))) body: { title: string; price: number },
) {}
```

| Pipe | Pour | Vérifie |
|------|------|---------|
| `filePipe(schema, { field? })` | `@UploadedFile()` | Le fichier, converti en `File` web |
| `filesPipe(schema, { field? })` | `@UploadedFiles()` | La liste (`FilesInterceptor()`) ou l'objet de listes (`FileFieldsInterceptor()`) |
| `filesPipe({ cover, photos })` | `@UploadedFiles()` avec `FileFieldsInterceptor()` | Chaque champ ; un champ dont le schéma n'est pas une liste reçoit son fichier seul |
| `multipartBodyPipe(schema)` | `@Body()` | Les champs texte, chacun parsé en JSON quand il échoue en chaîne (`"12.5"` passe `z.number()`, `"75001"` reste une chaîne) |

Les fichiers sont convertis depuis le stockage mémoire, ou ouverts depuis le stockage disque sans être lus en entier.
Le handler reçoit toujours les fichiers multer inchangés, et le pipe du body renvoie la sortie du schéma. Un échec
répond `400` avec `{ message, issues }`.

Les noms de champs passés à `FileInterceptor()` et à ses variantes sont illisibles : donnez-les avec l'option `field`,
ou déclarez le champ avec `@Endpoint({ input })`. `filesPipe()` avec une map de schémas, ou avec un schéma objet, nomme
ses champs par leurs clés. Sans nom, le fichier est laissé hors du contrat avec un avertissement. Une clé passée à
`@UploadedFile('x')` sert aussi de nom de champ, mais Nest lit alors `req.x` au lieu de `req.file`.

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
- `@UploadedFile()` et `@UploadedFiles()` : des champs body nommés comme décrit dans
  [envoi de fichiers](#envoi-de-fichiers), et un binding multipart. Une telle route doit utiliser `POST`, `PUT` ou `PATCH`,
  sinon elle est ignorée.
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
