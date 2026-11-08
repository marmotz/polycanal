---
title: Validation
---

# Validation

Tout ce qui passe par Polycanal est validé, dans les deux sens : les arguments avant l'envoi, les réponses à la
réception, les événements publiés et reçus.

## Standard Schema

La validation à l'exécution repose sur [Standard Schema](https://standardschema.dev/) : toute bibliothèque qui
l'implémente fonctionne, sans driver dédié. Un schéma s'utilise via sa méthode `~standard.validate()`, synchrone ou
asynchrone.

La valeur envoyée est la **sortie** du schéma d'input : les valeurs par défaut et les transformations sont appliquées
avant l'envoi.

## JSON Schema

Générer du code à partir d'un schéma d'exécution (adaptateurs NestJS et Express, `describeContract()`) demande un JSON
Schema, obtenu via [Standard JSON Schema](https://standardschema.dev/json-schema) (`~standard.jsonSchema`), implémenté
par Zod 4.2+. Un schéma qui n'accepte que `undefined` (`z.void()`) est converti en un marqueur dédié, puisque JSON
Schema ne sait pas exprimer « aucune valeur ».

## Drivers de validation

Écrire le code source d'un schéma ne peut pas être abstrait : générer `z.object({...})` est propre à Zod. Un driver de
validation ne couvre que cette partie :

```ts
interface ValidationDriver {
  readonly name: string;
  generate(schema: JsonSchema, context: SchemaGenerationContext): GeneratedCode;
  optional(schema: GeneratedCode): GeneratedCode;
  toJsonSchema?(schema: StandardSchemaV1, io: 'input' | 'output'): JsonSchema | undefined;
}
```

`zodDriver` (`@polycanal/zod`) est le premier. Il génère du code Zod 4 : formats de chaîne (`z.email()`,
`z.iso.datetime()`...), bornes, enums, unions, intersections, tuples, records, valeurs nullables, valeurs par défaut et
références paresseuses.
