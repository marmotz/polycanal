---
title: Versions de la documentation
---

# Versions de la documentation

Ce site est versionné avec Docusaurus, en anglais et en français.

- **next** documente la branche `develop`. C'est la seule version jusqu'à la première release.
- Chaque release fige une copie de la documentation, référence API comprise, sous son numéro de version.

Les mainteneurs créent une version depuis la racine du dépôt :

```bash
bun run --filter @polycanal/docs build
bun run --filter @polycanal/docs version 0.1.0
```

Le build régénère d'abord la référence API, pour que la copie figée la contienne. La nouvelle version est listée dans
`apps/docs/versions.json`, ses pages sont écrites dans `apps/docs/versioned_docs/version-0.1.0/` (commitées), et un
menu de versions apparaît dans la barre de navigation. La traduction française de cette version se place dans
`apps/docs/i18n/fr/docusaurus-plugin-content-docs/version-0.1.0/` (copie des pages françaises de `current/`).
**next** reste la version par défaut tant que `lastVersion` n'est pas modifié dans `docusaurus.config.ts`.
