# Uploads de fichiers

**Statut** : en discussion

## Contexte

Le premier test d'intégration de Polycanal dans un projet réel (clam, NestJS + Angular) a montré que les routes
d'envoi de fichiers (photos d'une annonce, en multipart avec progression) ne peuvent pas passer par le client
Polycanal : elles restent sur le client HTTP maison du projet. Tant que les uploads ne sont pas couverts, une migration
complète vers Polycanal est impossible.

## Objectif

Pouvoir décrire, générer, appeler et valider de bout en bout une action qui envoie des fichiers, avec la progression
de l'envoi, de la même façon quel que soit le framework front.

## Décisions actées

- Un contrat déclare un champ de fichier dans `input()` (`File` / `Blob`) et un encodage multipart sur le binding REST.
- L'appel garde son API `Promise` : la progression passe par une option d'appel (`onUploadProgress`), pas par un flux.
- La progression doit fonctionner à l'identique quel que soit le framework front, vanilla compris. `fetch` ne sait pas
  remonter la progression d'envoi de façon portable : il faut un autre mécanisme (XHR par exemple) pour la porter.
- La découverte NestJS reconnaît `@UploadedFile()` / `@UploadedFiles()` (multer) et génère les champs de fichier.
- La génération OpenAPI décrit les fichiers en `format: binary` dans un corps `multipart/form-data`.
- Le serveur valide les fichiers reçus (taille, type MIME), comme les autres champs.
