import {
  type ContractTree,
  type InputModel,
  type JsonSchema,
  type StandardSchemaV1,
  toJsonSchema,
  toModel,
} from '@polycanal/core';
import type { ContractDescription, FieldDescription, InputDescription, OperationDescription } from './description.js';

/** Converts a runtime schema, failing with the location when it cannot be expressed in JSON Schema. */
export function describeSchema(schema: StandardSchemaV1, io: 'input' | 'output', location: string): JsonSchema {
  const converted = toJsonSchema(schema, io);

  if (converted === undefined) {
    throw new TypeError(
      `${location}: the schema cannot be converted to JSON Schema (its library must implement Standard JSON Schema)`,
    );
  }

  return converted;
}

/** Whether a runtime schema accepts `undefined`, i.e. the value can be omitted. */
export function acceptsUndefined(schema: StandardSchemaV1): boolean {
  const result = schema['~standard'].validate(undefined);

  return !(result instanceof Promise) && result.issues === undefined;
}

/**
 * Describes a runtime contract (config written in TS). Inputs and published messages use the input side of the
 * schemas, responses and received messages the output side.
 */
export function describeContract(contract: ContractTree): ContractDescription {
  const operations = toModel(contract).operations.map((operation): OperationDescription => {
    const at = (part: string) => `${operation.id} ${part}`;

    if (operation.family === 'event') {
      return {
        family: 'event',
        path: operation.path,
        binding: operation.transport,
        ...(operation.send === undefined ? {} : { send: describeSchema(operation.send, 'input', at('send')) }),
        ...(operation.receive === undefined
          ? {}
          : { receive: describeSchema(operation.receive, 'output', at('receive')) }),
        ...(operation.meta === undefined ? {} : { meta: operation.meta }),
      };
    }

    const errors = Object.entries(operation.errors);

    return {
      family: 'action',
      path: operation.path,
      binding: operation.transport,
      ...(operation.input === undefined ? {} : { input: describeInput(operation.input, at('input')) }),
      output: describeSchema(operation.output, 'output', at('output')),
      ...(errors.length === 0
        ? {}
        : {
            errors: Object.fromEntries(
              errors.map(([key, schema]) => [key, describeSchema(schema, 'output', at(`error ${key}`))]),
            ),
          }),
      ...(operation.meta === undefined ? {} : { meta: operation.meta }),
    };
  });

  return { operations };
}

function describeInput(input: InputModel, location: string): InputDescription {
  if (input.fields === undefined) {
    return { kind: 'schema', schema: describeSchema(input.schema, 'input', location) };
  }

  return {
    kind: 'fields',
    fields: input.fields.map(
      (field): FieldDescription => ({
        name: field.name,
        schema: describeSchema(field.schema, 'input', `${location} field "${field.name}"`),
        required: !acceptsUndefined(field.schema),
        ...(field.source === undefined ? {} : { source: field.source }),
        ...(field.wireName === field.name ? {} : { alias: field.wireName }),
        ...(field.root ? { root: true } : {}),
      }),
    ),
  };
}
