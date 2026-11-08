import { type GeneratedCode, type JsonSchema, type SchemaGenerationContext, VOID_KEYWORD } from '@polycanal/core';

type SchemaObject = { readonly [keyword: string]: unknown };

const IMPORTS = [{ from: 'zod', names: ['z'] }] as const;

/** JavaScript's safe integer bounds, emitted by Zod for `.int()`: redundant with `.int()` once generated. */
const SAFE_INTEGER_BOUNDS = new Set([Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]);

const STRING_FORMATS: Readonly<Record<string, string>> = {
  'date-time': 'z.iso.datetime()',
  date: 'z.iso.date()',
  time: 'z.iso.time()',
  duration: 'z.iso.duration()',
  email: 'z.email()',
  uuid: 'z.uuid()',
  uri: 'z.url()',
  url: 'z.url()',
  ipv4: 'z.ipv4()',
  ipv6: 'z.ipv6()',
};

/** Generates Zod 4 source code from a JSON Schema (draft 2020-12, plus OpenAPI 3.0 `nullable`). */
export function generateZod(schema: JsonSchema, context: SchemaGenerationContext): GeneratedCode {
  return { code: expression(schema, context), imports: IMPORTS };
}

function expression(schema: JsonSchema, context: SchemaGenerationContext): string {
  if (schema === true) {
    return 'z.unknown()';
  }

  if (schema === false) {
    return 'z.never()';
  }

  let code = base(schema, context);

  if (schema.nullable === true) {
    code = `${code}.nullable()`;
  }

  if ('default' in schema && schema.default !== undefined) {
    code = `${code}.default(${literal(schema.default)})`;
  }

  return code;
}

function base(schema: SchemaObject, context: SchemaGenerationContext): string {
  if (schema[VOID_KEYWORD] === true) {
    return 'z.void()';
  }

  if (typeof schema.$ref === 'string') {
    const name = context.resolveRef(schema.$ref);

    return context.isLazyRef(schema.$ref) ? `z.lazy(() => ${name})` : name;
  }

  if ('const' in schema) {
    return valueSchema(schema.const);
  }

  if (Array.isArray(schema.enum)) {
    return enumSchema(schema.enum);
  }

  const variants = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;

  if (Array.isArray(variants)) {
    return unionSchema(variants, context);
  }

  if (Array.isArray(schema.allOf)) {
    const parts = (schema.allOf as JsonSchema[]).map((part) => expression(part, context));

    return parts.reduce((left, right) => `z.intersection(${left}, ${right})`);
  }

  const type = schema.type ?? inferType(schema);

  if (Array.isArray(type)) {
    const types = type.filter((name) => name !== 'null');
    const code =
      types.length === 1
        ? typed(types[0] as string, schema, context)
        : list(
            'z.union',
            types.map((name) => typed(name as string, schema, context)),
          );

    return type.includes('null') ? `${code}.nullable()` : code;
  }

  return typeof type === 'string' ? typed(type, schema, context) : 'z.unknown()';
}

function inferType(schema: SchemaObject): string | undefined {
  if ('properties' in schema || 'additionalProperties' in schema) {
    return 'object';
  }

  if ('items' in schema || 'prefixItems' in schema) {
    return 'array';
  }

  return undefined;
}

function typed(type: string, schema: SchemaObject, context: SchemaGenerationContext): string {
  switch (type) {
    case 'string':
      return stringSchema(schema);
    case 'integer':
      return numberSchema(schema, 'z.number().int()');
    case 'number':
      return numberSchema(schema, 'z.number()');
    case 'boolean':
      return 'z.boolean()';
    case 'null':
      return 'z.null()';
    case 'array':
      return arraySchema(schema, context);
    case 'object':
      return objectSchema(schema, context);
    default:
      return 'z.unknown()';
  }
}

function stringSchema(schema: SchemaObject): string {
  const format = typeof schema.format === 'string' ? STRING_FORMATS[schema.format] : undefined;
  let code = format ?? 'z.string()';

  if (typeof schema.minLength === 'number') {
    code += `.min(${schema.minLength})`;
  }

  if (typeof schema.maxLength === 'number') {
    code += `.max(${schema.maxLength})`;
  }

  // Formats already carry their own pattern
  if (format === undefined && typeof schema.pattern === 'string') {
    code += `.regex(new RegExp(${literal(schema.pattern)}))`;
  }

  return code;
}

function numberSchema(schema: SchemaObject, start: string): string {
  let code = start;
  const bound = (keyword: string, method: string) => {
    const value = schema[keyword];

    if (typeof value === 'number' && !(start.endsWith('.int()') && SAFE_INTEGER_BOUNDS.has(value))) {
      code += `.${method}(${value})`;
    }
  };

  bound('minimum', 'min');
  bound('maximum', 'max');
  bound('exclusiveMinimum', 'gt');
  bound('exclusiveMaximum', 'lt');
  bound('multipleOf', 'multipleOf');

  return code;
}

function arraySchema(schema: SchemaObject, context: SchemaGenerationContext): string {
  if (Array.isArray(schema.prefixItems)) {
    return list(
      'z.tuple',
      (schema.prefixItems as JsonSchema[]).map((item) => expression(item, context)),
    );
  }

  const items = (schema.items ?? true) as JsonSchema;
  let code = `z.array(${indentTail(expression(items, context))})`;

  if (typeof schema.minItems === 'number') {
    code += `.min(${schema.minItems})`;
  }

  if (typeof schema.maxItems === 'number') {
    code += `.max(${schema.maxItems})`;
  }

  return code;
}

function objectSchema(schema: SchemaObject, context: SchemaGenerationContext): string {
  const properties = (schema.properties ?? {}) as Readonly<Record<string, JsonSchema>>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const additional = schema.additionalProperties as JsonSchema | undefined;
  const names = Object.keys(properties);

  if (names.length === 0 && additional !== undefined && additional !== false) {
    return `z.record(z.string(), ${indentTail(expression(additional, context))})`;
  }

  if (names.length === 0) {
    return 'z.object({})';
  }

  const lines = names.map((name) => {
    const property = properties[name] as JsonSchema;
    let code = expression(property, context);
    const hasDefault = typeof property === 'object' && property.default !== undefined;

    if (!required.has(name) && !hasDefault) {
      code += '.optional()';
    }

    return `  ${key(name)}: ${indentTail(code)},`;
  });
  const object = `z.object({\n${lines.join('\n')}\n})`;

  return typeof additional === 'object' ? `${object}.catchall(${indentTail(expression(additional, context))})` : object;
}

function enumSchema(values: readonly unknown[]): string {
  if (values.length === 1) {
    return valueSchema(values[0]);
  }

  if (values.every((value) => typeof value === 'string')) {
    return `z.enum([${values.map(literal).join(', ')}])`;
  }

  return list('z.union', values.map(valueSchema));
}

function unionSchema(variants: readonly JsonSchema[], context: SchemaGenerationContext): string {
  const isNull = (variant: JsonSchema) => typeof variant === 'object' && variant.type === 'null';
  const others = variants.filter((variant) => !isNull(variant));
  const nullable = others.length < variants.length;

  if (others.length === 0) {
    return 'z.null()';
  }

  const code =
    others.length === 1
      ? expression(others[0] as JsonSchema, context)
      : list(
          'z.union',
          others.map((variant) => expression(variant, context)),
        );

  return nullable ? `${code}.nullable()` : code;
}

function valueSchema(value: unknown): string {
  return value === null ? 'z.null()' : `z.literal(${literal(value)})`;
}

/** `name([a, b])` on one line when short, one item per line otherwise. */
function list(name: string, items: readonly string[]): string {
  const inline = `${name}([${items.join(', ')}])`;

  if (inline.length <= 80 && !inline.includes('\n')) {
    return inline;
  }

  return `${name}([\n${items.map((item) => `  ${indentTail(item)},`).join('\n')}\n])`;
}

function key(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : literal(name);
}

function literal(value: unknown): string {
  return typeof value === 'string'
    ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
    : JSON.stringify(value);
}

/** Indents every line but the first, to nest multi-line code. */
function indentTail(code: string): string {
  return code.replace(/\n/g, '\n  ');
}
