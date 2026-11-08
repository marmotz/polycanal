import { ContractDefinitionError } from './errors.js';
import { isStandardSchema, type Simplify, type StandardSchemaV1 } from './schema.js';

/** Full form of an `input()` field. */
export interface FieldDescriptor<TSchema extends StandardSchemaV1 = StandardSchemaV1, TSource extends string = string> {
  readonly schema: TSchema;
  /** Where the field goes on the transport. Omitted: the transport's default rules apply. */
  readonly source?: TSource;
  /** Name of the field on the wire, when it differs from its name in the call. */
  readonly alias?: string;
  /** The field value is the whole content of its source (e.g. an array body). Requires an explicit `source`. */
  readonly root?: boolean;
}

/** A field is either a bare schema (shorthand, default rules) or a descriptor. */
export type FieldDefinition = StandardSchemaV1 | FieldDescriptor;

export type InputFields = Readonly<Record<string, FieldDefinition>>;

/** Field after normalization: shorthand and descriptor share the same shape. */
export interface NormalizedField {
  /** Name in the call. */
  readonly name: string;
  /** Name on the wire (`alias`, or `name`). */
  readonly wireName: string;
  readonly schema: StandardSchemaV1;
  readonly source: string | undefined;
  readonly root: boolean;
}

type FieldSchema<TField> = TField extends StandardSchemaV1
  ? TField
  : TField extends FieldDescriptor<infer TSchema>
    ? TSchema
    : never;

type FieldInput<TField> = StandardSchemaV1.InferInput<FieldSchema<TField>>;
type FieldOutput<TField> = StandardSchemaV1.InferOutput<FieldSchema<TField>>;

type OptionalInputKeys<TFields> = {
  [K in keyof TFields]: undefined extends FieldInput<TFields[K]> ? K : never;
}[keyof TFields];

type OptionalOutputKeys<TFields> = {
  [K in keyof TFields]: undefined extends FieldOutput<TFields[K]> ? K : never;
}[keyof TFields];

/** Type of the object passed by the caller. Fields whose schema accepts `undefined` are optional. */
export type InputOf<TFields extends InputFields> = Simplify<
  { [K in Exclude<keyof TFields, OptionalInputKeys<TFields>>]: FieldInput<TFields[K]> } & {
    [K in OptionalInputKeys<TFields>]?: FieldInput<TFields[K]>;
  }
>;

/** Type of the validated object, after each field schema has run (defaults, transforms...). */
export type OutputOf<TFields extends InputFields> = Simplify<
  { [K in Exclude<keyof TFields, OptionalOutputKeys<TFields>>]: FieldOutput<TFields[K]> } & {
    [K in OptionalOutputKeys<TFields>]?: FieldOutput<TFields[K]>;
  }
>;

/** Union of the explicit sources used by the fields. */
export type SourcesOf<TFields extends InputFields> = {
  [K in keyof TFields]: TFields[K] extends StandardSchemaV1
    ? never
    : TFields[K] extends { readonly source?: infer TSource }
      ? TSource extends string
        ? TSource
        : never
      : never;
}[keyof TFields];

type FieldWire<TField, TName extends string> = TField extends StandardSchemaV1
  ? TName
  : TField extends { readonly alias: infer TAlias extends string }
    ? TAlias
    : TName;

type FieldSource<TField> = TField extends StandardSchemaV1
  ? undefined
  : TField extends { readonly source: infer TSource extends string }
    ? TSource
    : undefined;

/** Wire name and explicit source of each field, as a union. */
export type WiresOf<TFields extends InputFields> = {
  [K in keyof TFields & string]: { readonly wire: FieldWire<TFields[K], K>; readonly source: FieldSource<TFields[K]> };
}[keyof TFields & string];

/**
 * Result of `input()`. It is itself a Standard Schema validating the whole call object, so an action accepts
 * either an `input()` or any object schema.
 */
export interface InputDefinition<TFields extends InputFields = InputFields>
  extends StandardSchemaV1<InputOf<TFields>, OutputOf<TFields>> {
  readonly kind: 'input';
  readonly fields: readonly NormalizedField[];
  /** Type-level only: explicit sources used, checked against the action's binding. */
  readonly '~sources'?: SourcesOf<TFields>;
  /** Type-level only: wire names and sources, checked against the fields the binding requires. */
  readonly '~wires'?: WiresOf<TFields>;
}

/**
 * Describes the single argument of an action, field by field, with where each field goes on the transport.
 *
 * @example
 * input({
 *   userId: { source: 'path', schema: z.string() },
 *   toUserId: { source: 'body', alias: 'userId', schema: z.string() },
 *   role: RoleSchema,
 * })
 */
export function input<const TFields extends InputFields>(fields: TFields): InputDefinition<TFields> {
  const normalized = Object.entries(fields).map(([name, field]) => normalizeField(name, field));
  checkFields(normalized);

  return {
    kind: 'input',
    fields: normalized,
    '~standard': {
      version: 1,
      vendor: 'polycanal',
      validate: (value) => validateFields(normalized, value),
    },
  } as InputDefinition<TFields>;
}

export function isInputDefinition(value: unknown): value is InputDefinition {
  return isStandardSchema(value) && (value as { kind?: unknown }).kind === 'input';
}

function normalizeField(name: string, field: FieldDefinition): NormalizedField {
  if (name === '') {
    throw new ContractDefinitionError('input field names must not be empty');
  }

  if (isStandardSchema(field)) {
    return { name, wireName: name, schema: field, source: undefined, root: false };
  }

  if (typeof field !== 'object' || field === null || !isStandardSchema(field.schema)) {
    throw new ContractDefinitionError(`input field "${name}" must be a Standard Schema or a { schema } descriptor`);
  }

  if (field.source !== undefined && (typeof field.source !== 'string' || field.source === '')) {
    throw new ContractDefinitionError(`input field "${name}" has an invalid source`);
  }

  if (field.alias !== undefined && (typeof field.alias !== 'string' || field.alias === '')) {
    throw new ContractDefinitionError(`input field "${name}" has an invalid alias`);
  }

  if (field.root === true && field.source === undefined) {
    throw new ContractDefinitionError(`input field "${name}" is a root field and must declare its source`);
  }

  return {
    name,
    wireName: field.alias ?? name,
    schema: field.schema,
    source: field.source,
    root: field.root === true,
  };
}

function checkFields(fields: readonly NormalizedField[]): void {
  const bySource = new Map<string, NormalizedField[]>();

  for (const field of fields) {
    if (field.source === undefined) {
      continue;
    }

    const group = bySource.get(field.source) ?? [];
    group.push(field);
    bySource.set(field.source, group);
  }

  for (const [source, group] of bySource) {
    const root = group.find((field) => field.root);

    if (root && group.length > 1) {
      throw new ContractDefinitionError(
        `input field "${root.name}" is the root of source "${source}", no other field can use that source`,
      );
    }

    const seen = new Map<string, string>();

    for (const field of group) {
      const previous = seen.get(field.wireName);

      if (previous !== undefined) {
        throw new ContractDefinitionError(
          `input fields "${previous}" and "${field.name}" both map to "${field.wireName}" in source "${source}"`,
        );
      }

      seen.set(field.wireName, field.name);
    }
  }
}

type FieldResult = StandardSchemaV1.Result<unknown>;

function validateFields(
  fields: readonly NormalizedField[],
  value: unknown,
): StandardSchemaV1.Result<Record<string, unknown>> | Promise<StandardSchemaV1.Result<Record<string, unknown>>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { issues: [{ message: 'Expected an object' }] };
  }

  const record = value as Record<string, unknown>;
  const results = fields.map((field) => field.schema['~standard'].validate(record[field.name]));

  if (results.some((result) => result instanceof Promise)) {
    return Promise.all(results).then((resolved) => mergeResults(fields, resolved));
  }

  return mergeResults(fields, results as FieldResult[]);
}

function mergeResults(
  fields: readonly NormalizedField[],
  results: readonly FieldResult[],
): StandardSchemaV1.Result<Record<string, unknown>> {
  const issues: StandardSchemaV1.Issue[] = [];
  const output: Record<string, unknown> = {};

  fields.forEach((field, index) => {
    const result = results[index] as FieldResult;

    if (result.issues) {
      for (const issue of result.issues) {
        issues.push({ ...issue, path: [field.name, ...(issue.path ?? [])] });
      }

      return;
    }

    if (result.value !== undefined) {
      output[field.name] = result.value;
    }
  });

  return issues.length > 0 ? { issues } : { value: output };
}
