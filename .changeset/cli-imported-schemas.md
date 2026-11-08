---
"@polycanal/cli": minor
"@polycanal/codegen": minor
"@polycanal/nest": minor
---

New `@polycanal/cli` package: `polycanal generate [--check]` writes the contracts of a `polycanal.config.ts` (source,
`schemaModules`, one or several outputs). Generated contracts import the runtime schemas exported by `schemaModules`
instead of regenerating them from JSON Schema, so they validate exactly like a handwritten contract; a schema no module
exports fails the generation unless `allowRegenerated`. `@polycanal/codegen` marks imported schemas
(`importedSchema()`) and defines the `ContractSource` interface; `@polycanal/nest` adds `nestSource()` and the
`resolveSchema` discovery option, which keeps a found body or query whole as a root field.
