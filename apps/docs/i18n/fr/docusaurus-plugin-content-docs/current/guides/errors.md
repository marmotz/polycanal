---
title: Erreurs
---

# Erreurs

Chaque appel en échec lève une `PolycanalError` porteuse de données structurées :

| Propriété   | Contenu                                                                                     |
|-------------|---------------------------------------------------------------------------------------------|
| `kind`      | `input`, `output`, `server` ou `transport` (ci-dessous)                                     |
| `operation` | Identifiant de l'opération, par exemple `households.list`                                   |
| `driver`    | Nom du driver, par exemple `rest`                                                           |
| `key`       | Clé d'erreur des erreurs `server` : le statut HTTP, en chaîne, pour REST                    |
| `data`      | Corps de l'erreur, validé avec le schéma `errors` correspondant si l'action en déclare un   |
| `issues`    | Problèmes de validation Standard Schema (`message`, `path`)                                 |
| `response`  | Réponse native, quand il y en a une                                                         |
| `cause`     | Erreur d'origine (échec réseau, erreur de décodage...)                                      |

| Type        | Signification                                                                                     |
|-------------|---------------------------------------------------------------------------------------------------|
| `input`     | L'argument (ou un message publié) ne correspond pas à son schéma. Rien n'a été envoyé             |
| `output`    | La réponse (ou un message reçu) ne correspond pas à son schéma                                    |
| `server`    | Le serveur a répondu avec un statut d'erreur. `data` contient le corps ; `issues` est renseigné s'il ne correspond pas au schéma d'erreur déclaré |
| `transport` | L'appel n'a pas pu être transporté : échec réseau, annulation, body indécodable, driver manquant   |

```ts
import { isPolycanalError } from '@polycanal/core';

try {
  await server.auth.login(credentials);
} catch (error) {
  if (isPolycanalError(error, { kind: 'server', key: 401 })) {
    showMessage((error.data as { message: string }).message);
  } else {
    throw error;
  }
}
```

## Erreurs de contrat

Un contrat mal formé lève une `ContractDefinitionError` dès sa définition, avec un `path` qui localise l'élément fautif
(`['households', 'list']`) et une `reason`.
