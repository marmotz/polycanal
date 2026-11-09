# Uploads de fichiers

**Statut** : terminé — voir [technical.md](technical.md)

## Contexte

Le premier test d'intégration de Polycanal dans un projet réel (clam, NestJS + Angular) a montré que les routes
d'envoi de fichiers (photos d'une annonce, en multipart avec progression) ne peuvent pas passer par le client
Polycanal : elles restent sur le client HTTP maison du projet. Tant que les uploads ne sont pas couverts, une migration
complète vers Polycanal est impossible.

## Objectif

Pouvoir décrire, générer, appeler et valider de bout en bout une action qui envoie ou reçoit des fichiers, avec la
progression de l'envoi et du téléchargement, de la même façon quel que soit le framework front.

## Décisions actées

### Contrat

- Un contrat déclare un champ de fichier dans `input()` (`File` / `Blob`) et un encodage multipart sur le binding REST.
- Formes couvertes dès la première version : fichier unique, liste de fichiers dans un champ, plusieurs champs
  fichiers nommés, et fichiers mêlés à des champs texte dans le même corps multipart.
- Un contrat peut aussi déclarer une réponse binaire (fichier reçu en `Blob`).
- Les contraintes de fichier (taille max, types MIME) sont déclarées dans le contrat, sur le schéma du champ.

### Appel et progression

- L'appel garde son API `Promise` : la progression passe par des options d'appel (`onUploadProgress`,
  `onDownloadProgress`), pas par un flux.
- La progression d'envoi est remontée par fichier.
- La progression doit fonctionner à l'identique quel que soit le framework front, vanilla compris. `fetch` ne sait pas
  remonter la progression d'envoi de façon portable : le driver REST par défaut bascule automatiquement sur XHR quand
  `onUploadProgress` est fourni, sans configuration de la part de l'utilisateur.
- L'annulation (`signal`) interrompt un envoi en cours, y compris quand il passe par XHR.

### Validation

- Le client rejette un fichier qui ne respecte pas les contraintes du contrat avant tout envoi.
- Le serveur revalide les fichiers reçus (taille, type MIME), comme les autres champs.

### Découverte et génération

- La découverte NestJS reconnaît `@UploadedFile()` / `@UploadedFiles()` (multer) et génère les champs de fichier.
- La découverte Express reconnaît les middlewares multer (`upload.single()`, `.array()`, `.fields()`) et génère les
  champs de fichier.
- La génération OpenAPI décrit les fichiers en `format: binary` dans un corps `multipart/form-data`.
- L'import OpenAPI (`polycanal-openapi`) produit des champs de fichier à partir d'un corps `multipart/form-data` en
  `format: binary`.
