export { acceptsUndefined, describeContract, describeSchema } from './describe.js';
export {
  type ActionDescription,
  type ContractDescription,
  type EventDescription,
  type FieldDescription,
  type InputDescription,
  type OperationDescription,
  operationId,
  SCHEMA_REF_PREFIX,
} from './description.js';
export { type GenerateOptions, generateContractSource } from './generate.js';
export { hoistDefinitions } from './hoist.js';
export { type MergeConflict, type MergeResult, mergeDescriptions } from './merge.js';
