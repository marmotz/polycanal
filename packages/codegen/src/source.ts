import type { StandardSchemaV1 } from '@polycanal/core';
import type { ContractDescription, SchemaImport } from './description.js';

/** What a contract source receives from the generator. */
export interface ContractSourceContext {
  /**
   * Where the generated contract can import a runtime schema from, `undefined` when no configured module exports it.
   * A source marks the schemas it finds with `importedSchema()`.
   */
  readonly resolveSchema: (schema: StandardSchemaV1) => SchemaImport | undefined;
}

export interface ContractSourceResult {
  readonly description: ContractDescription;
  /** Routes left out, fields without runtime schema... shown to the user. */
  readonly warnings: readonly string[];
  /** Runtime schemas generated from JSON Schema because `resolveSchema` did not find them. */
  readonly regenerated: readonly string[];
}

/** Where a contract comes from: a server framework (`nestSource()`), an OpenAPI document... */
export interface ContractSource {
  /** Shown in messages, e.g. `nest`. */
  readonly name: string;
  load(context: ContractSourceContext): Promise<ContractSourceResult>;
}
