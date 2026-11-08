# Uploads de fichiers : conception technique

Voir [overview.md](overview.md) pour le périmètre produit. Ce document décrit comment le porter dans le code actuel
(`develop`, novembre 2026).

## Vue d'ensemble

| Package              | Changement                                                                                   |
|----------------------|----------------------------------------------------------------------------------------------|
| `@polycanal/core`    | Options d'appel `onUploadProgress` / `onDownloadProgress`, transmises aux drivers             |
| `@polycanal/rest`    | Options de binding `body: 'multipart'` et `response: 'blob'`, encodage multipart, `fetchRest` (XHR, flux compté) |
| `@polycanal/angular` | Corps `FormData`, réponses `Blob`, progression via les événements `HttpClient`                |
| `@polycanal/zod`     | Génération de `z.file()` depuis `format: binary`                                              |
| `@polycanal/nest`    | Découverte de `@UploadedFile()` / `@UploadedFiles()`, pipes de validation des fichiers et des champs texte |
| `@polycanal/express` | Détection de multer, validation des fichiers et des champs texte dans `endpoint()`           |
| `@polycanal/openapi` | Import des corps `multipart/form-data` et des réponses binaires                              |

Un champ fichier se déclare avec un schéma de fichier de la bibliothèque de validation. En Zod 4, `z.file()` porte
déjà les contraintes et se convertit en JSON Schema (vérifié avec `zod@4.6.7`) :

```ts
z.file().max(5_000_000).mime(['image/png', 'image/jpeg'])
// → { type: 'string', format: 'binary', contentEncoding: 'binary', maxLength: 5000000,
//     anyOf: [{ contentMediaType: 'image/png' }, { contentMediaType: 'image/jpeg' }] }
```

C'est cette représentation JSON Schema (`format: binary`, convention OpenAPI) qui circule dans les
`ContractDescription` ([codegen/src/description.ts](../../../packages/codegen/src/description.ts)). Polycanal n'a pas
d'export OpenAPI aujourd'hui (`@polycanal/openapi` ne fait que l'import, [openapi/src/generate.ts](../../../packages/openapi/src/generate.ts)) :
la décision « la génération OpenAPI décrit les fichiers en `format: binary` » se traduit donc par ce format de
description, et s'appliquera tel quel à un futur export.

## Contrat

### Options de binding

[rest/src/binding.ts:16](../../../packages/rest/src/binding.ts) `RestBindingOptions` ne porte que `status`. On ajoute :

```ts
export interface RestBindingOptions {
  readonly status?: number | readonly number[];
  /** Encoding of the request body. Default: the codec (JSON). */
  readonly body?: 'multipart';
  /** Kind of success response body. Default: the codec (JSON). */
  readonly response?: 'blob';
}
```

`RestBinding` ([binding.ts:22](../../../packages/rest/src/binding.ts)) gagne `body: 'multipart' | undefined` et
`response: 'blob' | undefined`, en données pures comme `status`. `binding()` (ligne 55) refuse `body: 'multipart'` sur
`GET` / `DELETE` (`QUERY_METHODS`, ligne 37), où les champs restants vont dans la query.

`restBindingEmitter` ([rest/src/emitter.ts:12](../../../packages/rest/src/emitter.ts)) émet les nouvelles options à
côté de `status` : `rest.post('/photos', { body: 'multipart' })`.

Alternative écartée : des codecs `multipartCodec` / `blobCodec` sur l'action (spec §4). `Codec` est textuel
([core/src/binding.ts:35](../../../packages/core/src/binding.ts), `encode(): string`) et la génération de code n'émet
aucun codec (aucune occurrence de `codec` dans `codegen/src`) ; le binding est déjà émis et décrit.

### Champs fichiers

Rien à changer dans `input()` ([core/src/input.ts](../../../packages/core/src/input.ts)) : un champ fichier est un champ
de source `body` (source par défaut pour `POST` / `PUT` / `PATCH`, [rest/src/request.ts:98](../../../packages/rest/src/request.ts))
dont la valeur est un `Blob`. Les quatre formes décidées sont des champs ordinaires :

```ts
input({
  cover: z.file().mime(['image/jpeg']),             // fichier unique
  photos: z.array(z.file().max(5_000_000)),         // liste dans un champ
  title: z.string(),                                // champ texte
  price: z.number(),
})
```

Plusieurs champs fichiers nommés = plusieurs champs. Un champ `root` en `body` reste refusé en multipart (il faut des
noms de parts) : `buildRequest` lève une `TypeError`.

### Réponses binaires

Avec `response: 'blob'`, le driver livre un `File` (et non un `Blob`), construit depuis le corps reçu, le
`Content-Type` et le `filename` de `Content-Disposition` (défaut : dernier segment du chemin). Le schéma de sortie est
alors `z.file()`, que la génération produit depuis `format: binary`, et le nom du fichier reste disponible.
Alternative écartée : livrer un `Blob` et demander `z.instanceof(Blob)`, qui n'a pas de JSON Schema (pas de génération
possible). Les réponses d'erreur (hors statuts de succès) restent décodées par le codec : elles sont en JSON.

## Core : options de progression

[core/src/client.ts:27](../../../packages/core/src/client.ts) `CallOptions` et [core/src/transport.ts:7](../../../packages/core/src/transport.ts)
`ActionCall` gagnent :

```ts
export interface UploadProgress {
  /** Bytes sent, for the whole request. */
  readonly loaded: number;
  /** Size of the whole request, `undefined` when unknown. */
  readonly total: number | undefined;
  /** Estimated progress of each file, in body order. */
  readonly files: readonly FileProgress[];
}

export interface FileProgress {
  /** Name of the input field (wire name). */
  readonly field: string;
  /** `File.name`, `undefined` for a plain `Blob`. */
  readonly name: string | undefined;
  readonly loaded: number;
  readonly total: number;
}

export interface DownloadProgress {
  readonly loaded: number;
  /** From `Content-Length`, `undefined` when absent (compressed or chunked response). */
  readonly total: number | undefined;
}

// CallOptions and ActionCall
readonly onUploadProgress?: (progress: UploadProgress) => void;
readonly onDownloadProgress?: (progress: DownloadProgress) => void;
```

`ClientRuntime.call()` ([client.ts:247](../../../packages/core/src/client.ts)) recopie les deux callbacks dans
`ActionCall`, comme `signal`. Les types sont transport-agnostiques et restent dans le core ; un driver qui ne sait pas
mesurer ignore ces options. Un interceptor qui rejoue la requête (`next` appelé deux fois) refait remonter la
progression depuis zéro : comportement documenté, pas filtré.

`actionResource()` ([angular/src/resource.ts](../../../packages/angular/src/resource.ts)) laisse passer ces options
comme les autres `CallOptions`.

## REST : construction de la requête

### Types natifs (changement cassant)

[rest/src/http.ts:4](../../../packages/rest/src/http.ts) :

- `HttpRequest.body: string | FormData | undefined` ;
- `RawHttpResponse` gagne `blob?: Blob` (réponses `response: 'blob'`), `text` vaut alors `''`.

Les interceptors qui lisent `request.body` comme une chaîne doivent tester son type. Projet en `0.0.0` : changeset
`minor` sur `@polycanal/rest` et `@polycanal/angular`.

### Encodage multipart

`buildRequest()` ([rest/src/request.ts:19](../../../packages/rest/src/request.ts)) : quand `binding.body === 'multipart'`,
les champs de source `body` (le `Record` `body`, ligne 31) sont encodés dans un `FormData` au lieu de passer par le
codec (lignes 70-75) :

- `Blob` / `File` : `append(wireName, value, value.name)` ;
- tableau : un `append` par élément, sous le même nom (multer `upload.array()` / `FilesInterceptor`) ;
- `string` : tel quel ;
- `Date` : ISO ; nombre, booléen : `String()` ; objet ou tableau non fichier : `JSON.stringify`. La fonction `scalar()`
  (ligne 170) fait déjà exactement cela et est réutilisée ;
- `undefined` / `null` : omis.

Pas d'en-tête `content-type` : le runtime le pose avec la frontière. `accept` reste celui du codec, sauf
`response: 'blob'` (`*/*`). La validation côté client ne change pas : `z.file()` s'exécute avant `prepare()` dans
`ClientRuntime.call()` ([client.ts:288](../../../packages/core/src/client.ts)), donc un fichier hors contraintes
rejette en `PolycanalError` `kind: 'input'` sans requête. En mode `send: 'raw'`, les fichiers passent tels quels (même
objet).

### Décodage

`decode()` ([rest/src/transport.ts:51](../../../packages/rest/src/transport.ts)) : si la réponse porte `blob` et que
le statut est un succès du binding, `body` devient le `File` décrit plus haut ; sinon la logique actuelle s'applique.

## Progression par fichier : estimation

XHR et `HttpClient` ne mesurent que les octets de la requête entière. L'encodeur multipart retient l'ordre des parts et
leur taille utile (taille du `Blob`, longueur UTF-8 du texte) plus une surcharge fixe par part (en-têtes
`Content-Disposition`, nom, frontière : ~`120 + wireName.length + filename.length` octets). Une fonction pure
`fileProgress(parts, loaded, total)` en déduit, pour chaque fichier, `clamp(loaded × estimé/total − début, 0, taille)`,
en remettant l'estimation à l'échelle du `total` réel. Elle vit dans `@polycanal/rest` (partagée par `fetchRest` et
`angularRest`) et se teste seule. Le dernier événement (fin d'envoi) force chaque fichier à `loaded = total`.

## Drivers

### `fetchRest`

[rest/src/fetch.ts:14](../../../packages/rest/src/fetch.ts). Le sender choisit son mécanisme à chaque appel :

| Cas                                       | Mécanisme                                                                     |
|-------------------------------------------|-------------------------------------------------------------------------------|
| pas de `onUploadProgress`                 | `fetch`, corps `FormData` passé tel quel                                      |
| `onUploadProgress`, `XMLHttpRequest` dispo | XHR : `xhr.upload.onprogress`, `responseType` `blob` ou `text`, `withCredentials` si `credentials: 'include'`, `signal` → `xhr.abort()` puis rejet avec `signal.reason` |
| `onUploadProgress`, pas de XHR (Node, Bun) | `fetch` avec un corps en flux compté : `new Response(formData)` donne le corps sérialisé et son `content-type` avec frontière, `blob.size` le total exact ; le flux `blob.stream()` traverse un `TransformStream` qui compte les octets lus, envoyé avec `duplex: 'half'` |

`onDownloadProgress` ne nécessite pas XHR : avec `fetch`, le corps est lu via `response.body.getReader()` en comptant
les octets (`total` depuis `content-length`) ; avec XHR, `xhr.onprogress`. Les en-têtes de réponse XHR sont lus via
`getAllResponseHeaders()` et mis en minuscules, comme le chemin `fetch` (lignes 23-26).

`FetchRestOptions` gagne `XMLHttpRequest?: typeof XMLHttpRequest` (défaut : le global), pour les tests et pour forcer le
flux compté (`XMLHttpRequest: null`). L'option `fetch` ne s'applique pas au chemin XHR : documenté.

Le flux compté mesure ce que `fetch` a consommé, pas ce qui a quitté le socket : la progression avance un peu en avance
sur le réseau. Accepté (décision produit : « approximatif mais réel »).

### `angularRest`

[angular/src/rest.ts:48](../../../packages/angular/src/rest.ts) `httpClientSender` :

- corps `FormData` : passé tel quel à `HttpClient` (chemin non JSON, ligne 71), `jsonBody()` (ligne 98) ne doit jamais
  le parser ;
- `response: 'blob'` : `responseType: 'blob'` ;
- avec un callback de progression : `reportProgress: true`, `observe: 'events'` ; `HttpEventType.UploadProgress` →
  `onUploadProgress` (via `fileProgress`), `HttpEventType.DownloadProgress` → `onDownloadProgress`,
  `HttpEventType.Response` → `resolve`. Sans callback, `observe: 'response'` comme aujourd'hui.

Les interceptors Angular de l'application voient le `FormData`, comme avec un appel `HttpClient` direct.

## Serveur : NestJS

### Découverte

[nest/src/discover.ts:30](../../../packages/nest/src/discover.ts) `PARAM_TYPES` gagne `FILE: 8` et `FILES: 9`
(`RouteParamtypes` de `@nestjs/common@12.1.3`). Les noms de champs passés à `FileInterceptor('photo')` sont dans une
closure du mixin (`platform-express/multer/interceptors/file.interceptor.js`) : illisibles. `describeRoute()` (ligne 255) :

- `FILE` : nom = la clé de `@UploadedFile('photo')` (`argument.data`), schéma = celui du pipe (`context.schemaOf`,
  ligne 286). Sans clé ni entrée `@Endpoint({ input })`, avertissement et pas de champ ;
- `FILES` : la valeur est un tableau (`FilesInterceptor`) ou un objet de tableaux (`FileFieldsInterceptor`). Les champs
  viennent du schéma du pipe (`filesPipe({ photos: …, cover: … })`, un champ par clé) ou de `@Endpoint({ input })` ;
- dès qu'un `FILE` / `FILES` est vu, le binding est émis avec `body: 'multipart'`.

`@Endpoint({ input })` ([nest/src/decorators.ts:16](../../../packages/nest/src/decorators.ts)) reste la façon de
déclarer ou de remplacer un champ (`fields.replace`, ligne 313).

### Validation

Nouveau module `nest/src/files.ts`, exporté :

- `filePipe(schema)` : pipe pour `@UploadedFile(filePipe(PhotoSchema))`. Convertit le fichier multer en `File`
  (`buffer` en stockage mémoire ; `fs.openAsBlob(path)` en stockage disque, sans tout charger), valide avec le schéma
  et renvoie le fichier multer d'origine (le handler ne change pas). Échec : `BadRequestException` avec les issues ;
- `filesPipe(schemaOrFields)` : même chose pour `@UploadedFiles()`, avec un schéma de tableau ou une map par champ ;
- `multipartBodyPipe(schema)` : pour `@Body(multipartBodyPipe(ListingSchema))`. Valide chaque champ texte tel quel,
  puis, sur échec, retente avec `JSON.parse` de la valeur ; renvoie la sortie du schéma. Un code postal `"75001"`
  reste une chaîne, `"12.5"` devient `12.5` si le schéma attend un nombre.

Chaque pipe expose son schéma en propriété : `defaultSchemaOf()` (ligne 504) le trouve déjà, donc la découverte n'a
rien de plus à lire. Alternative écartée : dériver `limits` / `fileFilter` multer et `ParseFilePipe` du schéma (pas
de conversion en `File`, mais deux sources de vérité et pas de `mime` exact côté multer).

## Serveur : Express

### Découverte

[express/src/discover.ts:48](../../../packages/express/src/discover.ts) : multer ne garde pas les noms de champs, mais
son middleware s'appelle `multerMiddleware` (`multer@2.4.0`, `lib/make-middleware.js:65`). Une route dont un handler
porte ce nom avant le marqueur `endpoint()` reçoit `body: 'multipart'`. Les champs fichiers sont ceux de
`endpoint({ input })` (`z.file()`), lus par `describeInput()` (ligne 110). Avertissements : multer sans champ fichier
déclaré ; `endpoint()` placé avant multer (il ne verrait pas `req.file`).

### Validation

`endpoint()` ([express/src/endpoint.ts:38](../../../packages/express/src/endpoint.ts)) appelle aujourd'hui seulement
`checkResponses()` puis `next()`. Pour une entrée qui contient des champs fichiers, il valide en plus, avant `next()` :

- `req.file` / `req.files` (tableau ou objet de tableaux), convertis en `File` comme côté Nest ;
- les champs texte de `req.body`, avec le même repli `JSON.parse`, et remplace `req.body` par la sortie des schémas.

Échec : réponse `400` `{ message, issues }`, `next()` non appelé. Toujours actif pour ces routes (pas d'opt-in comme
`validateResponses()`) : c'est la validation décidée. La conversion et le repli `JSON.parse` sont partagés avec Nest :
ils vont dans `@polycanal/core` (`multerFileToFile()`, `validateMultipartFields()`), à côté de `validateJsonResponse()`
([core/src/response.ts](../../../packages/core/src/response.ts)), sans dépendre de multer (type structurel
`{ buffer?, path?, originalname, mimetype, size }`).

## Génération de schémas Zod

[zod/src/generate.ts](../../../packages/zod/src/generate.ts) :

- `base()` traite `anyOf` / `oneOf` (ligne 69) avant le type : un schéma `type: 'string', format: 'binary'` doit être
  reconnu avant, sinon ses `anyOf` de `contentMediaType` deviennent une union ;
- fichier : `z.file()`, `.min(minLength)`, `.max(maxLength)`, `.mime([...])` depuis `contentMediaType` (direct ou
  `anyOf`) ;
- OpenAPI 3.0 `format: binary` sans `contentEncoding` : même traitement.

## Import OpenAPI

[openapi/src/import.ts](../../../packages/openapi/src/import.ts) :

- `bodyFields()` (ligne 171) : si le corps n'a pas de contenu JSON mais un `multipart/form-data`, ses propriétés
  deviennent des champs `body` et le binding reçoit `body: 'multipart'`. L'objet `encoding.<champ>.contentType` donne
  une contrainte `contentMediaType`. Les corps `multipart` non objet sont ignorés avec avertissement (`SkipOperation`) ;
- `responses()` (ligne 208) : un succès sans JSON mais avec `application/octet-stream`, `image/*`, `application/pdf`…
  dont le schéma est `format: binary` donne `response: 'blob'` et une sortie fichier ;
- `convertSchema()` (ligne 258) recopie déjà `format`, `contentMediaType` et `maxLength` : rien à changer.

## Conséquences vérifiées

- `HttpRequest.body` élargi : `angularRest.jsonBody()` et tout interceptor applicatif qui fait `JSON.parse(request.body)`
  doivent tester le type. Les tests de `rest/src/request.test.ts` et `angular/src/rest.test.ts` restent valides pour le
  JSON.
- `RestBinding` gagne deux propriétés : les tests qui comparent un binding entier (`toEqual`) dans `rest`, `nest`,
  `express`, `openapi` et `codegen` doivent les inclure (`undefined`).
- `ActionCall` gagne deux propriétés optionnelles : les drivers tiers compilent sans changement.
- Rien ne change pour les routes JSON : pas de `body: 'multipart'`, pas de validation d'entrée ajoutée côté serveur.

## Tests

- `rest` : encodage multipart (quatre formes, valeurs texte, refus `root` et `GET`), `fileProgress`, émission des
  options, `fetchRest` avec XHR factice, avec flux compté, `onDownloadProgress`, annulation, réponse `File`.
- `core` : propagation des callbacks dans `ActionCall`, `multerFileToFile`, `validateMultipartFields`.
- `angular` : `FormData`, `responseType: 'blob'`, événements de progression avec `HttpTestingController`.
- `zod` : `z.file()` généré, contraintes, ordre `anyOf`.
- `nest` : découverte `FILE` / `FILES` avec et sans clé, pipes (mémoire, disque, issues, repli JSON).
- `express` : détection de `multerMiddleware`, avertissements d'ordre, validation 400.
- `openapi` : fixture multipart et réponse binaire.
- Documentation : guides client, NestJS, Express (FR et EN) ; changesets par package.

## Découpage en tâches d'implémentation

| Issue | Tâche | Dépend de |
|-------|-------|-----------|
| [#1](https://github.com/marmotz/polycanal/issues/1) | core : options d'appel `onUploadProgress` / `onDownloadProgress` | — |
| [#2](https://github.com/marmotz/polycanal/issues/2) | zod : générer `z.file()` depuis `format: binary` | — |
| [#3](https://github.com/marmotz/polycanal/issues/3) | core : helpers serveur `multerFileToFile` et `validateMultipartFields` | — |
| [#4](https://github.com/marmotz/polycanal/issues/4) | rest : bindings multipart / blob, encodage `FormData` et estimation par fichier | #1 |
| [#5](https://github.com/marmotz/polycanal/issues/5) | rest : `fetchRest`, progression d'envoi (XHR, flux compté) et de téléchargement | #1, #4 |
| [#6](https://github.com/marmotz/polycanal/issues/6) | angular : `FormData`, réponses blob et progression dans `angularRest` | #1, #4 |
| [#7](https://github.com/marmotz/polycanal/issues/7) | nest : découverte de `@UploadedFile(s)` et pipes de validation multipart | #4, #3 |
| [#8](https://github.com/marmotz/polycanal/issues/8) | express : détection de multer et validation multipart dans `endpoint()` | #4, #3 |
| [#9](https://github.com/marmotz/polycanal/issues/9) | openapi : import des corps multipart et des réponses binaires | #4, #2 |
