import type { JsonSchema } from '@polycanal/core';
import {
  type ActionDescription,
  type ContractDescription,
  type EventDescription,
  type InputDescription,
  type OperationDescription,
  SCHEMA_REF_PREFIX,
} from './description.js';

interface Hoisted {
  readonly schemas: Record<string, JsonSchema>;
  readonly operations: readonly OperationDescription[];
}

/**
 * Moves the local definitions of every schema (`$defs`, and the schema itself when it references `#`) to named
 * schemas, so that recursive schemas produced by Standard JSON Schema converters can be generated.
 */
export function hoistDefinitions(description: ContractDescription): Hoisted {
  const schemas: Record<string, JsonSchema> = {};
  const names = new Set(Object.keys(description.schemas ?? {}));
  const unique = (base: string) => {
    let name = base;

    for (let index = 2; names.has(name); index++) {
      name = `${base}${index}`;
    }

    names.add(name);

    return name;
  };

  const hoist = (schema: JsonSchema, owner: string): JsonSchema => {
    if (typeof schema !== 'object') {
      return schema;
    }

    const defs = (schema.$defs ?? {}) as Record<string, JsonSchema>;
    const local = new Map(Object.keys(defs).map((key) => [`#/$defs/${key}`, unique(`${owner}-${key}`)]));
    const selfName = referencesRoot(schema) ? unique(owner) : undefined;
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(rewrite);
      }

      if (typeof value !== 'object' || value === null) {
        return value;
      }

      return Object.fromEntries(
        Object.entries(value)
          .filter(([keyword]) => keyword !== '$defs')
          .map(([keyword, child]) => {
            if (keyword === '$ref' && typeof child === 'string') {
              const target = child === '#' ? selfName : local.get(child);

              return [keyword, target === undefined ? child : `${SCHEMA_REF_PREFIX}${encodeURIComponent(target)}`];
            }

            return [keyword, rewrite(child)];
          }),
      );
    };

    for (const [ref, name] of local) {
      schemas[name] = rewrite(defs[ref.slice('#/$defs/'.length)]) as JsonSchema;
    }

    const root = rewrite(schema) as JsonSchema;

    if (selfName === undefined) {
      return root;
    }

    schemas[selfName] = root;

    return { $ref: `${SCHEMA_REF_PREFIX}${encodeURIComponent(selfName)}` };
  };

  for (const [name, schema] of Object.entries(description.schemas ?? {})) {
    schemas[name] = hoist(schema, name);
  }

  const operations = description.operations.map((operation): OperationDescription => {
    const owner = operation.path.join('-');

    return operation.family === 'action' ? hoistAction(operation, owner, hoist) : hoistEvent(operation, owner, hoist);
  });

  return { schemas, operations };
}

type Hoist = (schema: JsonSchema, owner: string) => JsonSchema;

function hoistAction(action: ActionDescription, owner: string, hoist: Hoist): ActionDescription {
  return {
    ...action,
    ...(action.input === undefined ? {} : { input: hoistInput(action.input, `${owner}-input`, hoist) }),
    output: hoist(action.output, `${owner}-output`),
    ...(action.errors === undefined
      ? {}
      : {
          errors: Object.fromEntries(
            Object.entries(action.errors).map(([key, schema]) => [key, hoist(schema, `${owner}-error-${key}`)]),
          ),
        }),
  };
}

function hoistEvent(event: EventDescription, owner: string, hoist: Hoist): EventDescription {
  return {
    ...event,
    ...(event.send === undefined ? {} : { send: hoist(event.send, `${owner}-send`) }),
    ...(event.receive === undefined ? {} : { receive: hoist(event.receive, `${owner}-receive`) }),
  };
}

function hoistInput(input: InputDescription, owner: string, hoist: Hoist): InputDescription {
  return input.kind === 'schema'
    ? { kind: 'schema', schema: hoist(input.schema, owner) }
    : {
        kind: 'fields',
        fields: input.fields.map((field) => ({ ...field, schema: hoist(field.schema, `${owner}-${field.name}`) })),
      };
}

function referencesRoot(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(referencesRoot);
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.entries(value).some(([keyword, child]) => (keyword === '$ref' ? child === '#' : referencesRoot(child)));
}
