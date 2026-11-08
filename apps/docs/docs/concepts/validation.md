---
title: Validation
---

# Validation

Everything that goes through Polycanal is validated, in both directions: arguments before sending, responses on
receipt, events published and received.

## Standard Schema

Runtime validation relies on [Standard Schema](https://standardschema.dev/): any library implementing it works, without
a dedicated driver. A schema is used through its `~standard.validate()` method, synchronous or asynchronous.

The value sent is the **output** of the input schema: defaults and transforms are applied before sending.

## JSON Schema

Generating code from a runtime schema (NestJS and Express adapters, `describeContract()`) needs a JSON Schema, obtained
through [Standard JSON Schema](https://standardschema.dev/json-schema) (`~standard.jsonSchema`), which Zod 4.2+
implements. A schema that only accepts `undefined` (`z.void()`) is converted to a dedicated marker, since JSON Schema
cannot express "no value".

## Validation drivers

Writing schema source code cannot be abstracted: generating `z.object({...})` is Zod-specific. A validation driver
covers that part only:

```ts
interface ValidationDriver {
  readonly name: string;
  generate(schema: JsonSchema, context: SchemaGenerationContext): GeneratedCode;
  optional(schema: GeneratedCode): GeneratedCode;
  toJsonSchema?(schema: StandardSchemaV1, io: 'input' | 'output'): JsonSchema | undefined;
}
```

`zodDriver` (`@polycanal/zod`) is the first one. It generates Zod 4 code: string formats (`z.email()`,
`z.iso.datetime()`...), bounds, enums, unions, intersections, tuples, records, nullable values, defaults and lazy
references.
