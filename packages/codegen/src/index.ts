export { acceptsUndefined, describeContract, describeSchema } from './describe.js';
export {
  type ActionDescription,
  type ContractDescription,
  type EventDescription,
  type FieldDescription,
  IMPORT_KEYWORD,
  type InputDescription,
  importedSchema,
  type OperationDescription,
  operationId,
  SCHEMA_REF_PREFIX,
  type SchemaImport,
  schemaImportOf,
} from './description.js';
export { type GenerateOptions, generateContractSource } from './generate.js';
export { hoistDefinitions } from './hoist.js';
export { type MergeConflict, type MergeResult, mergeDescriptions } from './merge.js';
export type { ContractSource, ContractSourceContext, ContractSourceResult } from './source.js';
