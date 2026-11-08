import type { ActionBinding, Codec, EventBinding, OperationMeta, SourceOf, TransportBinding } from './binding.js';
import { ContractDefinitionError } from './errors.js';
import { isInputDefinition } from './input.js';
import { isStandardSchema, type StandardSchemaV1 } from './schema.js';

/** Brand marking the objects built by `action()` and `event()`, shared across copies of the package. */
export const DEFINITION = Symbol.for('polycanal.definition');

/** Schemas of error bodies, keyed by a driver-defined key (HTTP status for REST). */
export type ErrorSchemas = Readonly<Record<string | number, StandardSchemaV1>>;

type NoErrors = Readonly<Record<never, StandardSchemaV1>>;

/**
 * What an action accepts as `input`: any object schema, or an `input()` whose explicit sources are all supported by
 * the binding.
 */
export type ActionInput<TSource extends string = string> = StandardSchemaV1 & { readonly '~sources'?: TSource };

/** Required fields of a binding, keeping only literal keys (the index signature of the base type is dropped). */
type RequiresOf<TBinding> = TBinding extends { readonly requires?: infer TRequires }
  ? NonNullable<TRequires> extends infer TMap extends Readonly<Record<string, string>>
    ? { [K in keyof TMap as string extends K ? never : K]: TMap[K] }
    : Record<never, string>
  : Record<never, string>;

type DefaultWires<TInput> = TInput extends StandardSchemaV1
  ? {
      [K in keyof StandardSchemaV1.InferInput<TInput> & string]: { readonly wire: K; readonly source: undefined };
    }[keyof StandardSchemaV1.InferInput<TInput> & string]
  : never;

type WiresOfInput<TInput> = TInput extends undefined
  ? never
  : TInput extends { readonly '~wires'?: infer TWires }
    ? unknown extends TWires
      ? DefaultWires<TInput>
      : NonNullable<TWires>
    : DefaultWires<TInput>;

type MissingWires<TBinding, TInput> = {
  [K in keyof RequiresOf<TBinding> & string]: [
    Extract<WiresOfInput<TInput>, { readonly wire: K; readonly source: RequiresOf<TBinding>[K] | undefined }>,
  ] extends [never]
    ? K
    : never;
}[keyof RequiresOf<TBinding> & string];

type UnexpectedWires<TBinding, TInput> =
  WiresOfInput<TInput> extends infer TWire
    ? TWire extends { readonly wire: infer TName; readonly source: infer TSource }
      ? TSource extends RequiresOf<TBinding>[keyof RequiresOf<TBinding>]
        ? TName extends keyof RequiresOf<TBinding>
          ? never
          : TName
        : never
      : never
    : never;

/**
 * Type-level check of the fields a binding requires (e.g. REST path parameters). Resolves to `unknown` when the input
 * matches, or to an object with a readable `~error` otherwise.
 */
export type BindingCheck<TBinding, TInput> = [MissingWires<TBinding, TInput>] extends [never]
  ? [UnexpectedWires<TBinding, TInput>] extends [never]
    ? unknown
    : {
        readonly '~error': `input field "${UnexpectedWires<TBinding, TInput> & string}" is not expected by the binding`;
      }
  : { readonly '~error': `input is missing the field "${MissingWires<TBinding, TInput>}" required by the binding` };

export interface ActionDefinition<
  TBinding extends ActionBinding = ActionBinding,
  TOutput extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends ActionInput | undefined = ActionInput | undefined,
  TErrors extends ErrorSchemas = ErrorSchemas,
> {
  readonly [DEFINITION]: true;
  readonly kind: 'action';
  readonly transport: TBinding;
  readonly input: TInput;
  readonly output: TOutput;
  readonly errors: TErrors;
  readonly codec: Codec | undefined;
  readonly meta: OperationMeta | undefined;
}

export interface ActionConfig<
  TBinding extends ActionBinding,
  TOutput extends StandardSchemaV1,
  TInput extends ActionInput<SourceOf<TBinding>> | undefined,
  TErrors extends ErrorSchemas,
> {
  readonly transport: TBinding;
  readonly input?: TInput;
  readonly output: TOutput;
  readonly errors?: TErrors;
  readonly codec?: Codec;
  readonly meta?: OperationMeta;
}

/** Declares a request/response operation. */
export function action<
  const TBinding extends ActionBinding,
  TOutput extends StandardSchemaV1,
  TInput extends ActionInput<SourceOf<TBinding>> | undefined = undefined,
  const TErrors extends ErrorSchemas = NoErrors,
>(
  config: ActionConfig<TBinding, TOutput, TInput, TErrors> & BindingCheck<TBinding, TInput>,
): ActionDefinition<TBinding, TOutput, TInput, TErrors> {
  checkBinding(config.transport, 'action');

  if (config.input !== undefined) {
    checkActionInput(config.input, config.transport);
  }

  checkRequiredFields(config.input, config.transport);

  if (!isStandardSchema(config.output)) {
    throw new ContractDefinitionError('action output must be a Standard Schema');
  }

  for (const [key, schema] of Object.entries(config.errors ?? {})) {
    if (!isStandardSchema(schema)) {
      throw new ContractDefinitionError(`action error "${key}" must be a Standard Schema`);
    }
  }

  return {
    [DEFINITION]: true,
    kind: 'action',
    transport: config.transport,
    input: config.input as TInput,
    output: config.output,
    errors: (config.errors ?? {}) as TErrors,
    codec: config.codec,
    meta: config.meta,
  };
}

export interface EventDefinition<
  TBinding extends EventBinding = EventBinding,
  TSend extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
  TReceive extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
> {
  readonly [DEFINITION]: true;
  readonly kind: 'event';
  readonly transport: TBinding;
  /** Schema of published messages. `undefined`: the client cannot publish. */
  readonly send: TSend;
  /** Schema of received messages. `undefined`: the client cannot subscribe. */
  readonly receive: TReceive;
  readonly codec: Codec | undefined;
  readonly meta: OperationMeta | undefined;
}

interface EventConfigBase<TBinding extends EventBinding> {
  readonly transport: TBinding;
  readonly codec?: Codec;
  readonly meta?: OperationMeta;
}

/** Declares an event channel. At least one of `send` and `receive` is required. */
export function event<
  const TBinding extends EventBinding,
  TSend extends StandardSchemaV1,
  TReceive extends StandardSchemaV1 | undefined = undefined,
>(
  config: EventConfigBase<TBinding> & { readonly send: TSend; readonly receive?: TReceive },
): EventDefinition<TBinding, TSend, TReceive>;
export function event<const TBinding extends EventBinding, TReceive extends StandardSchemaV1>(
  config: EventConfigBase<TBinding> & { readonly send?: undefined; readonly receive: TReceive },
): EventDefinition<TBinding, undefined, TReceive>;
export function event(
  config: EventConfigBase<EventBinding> & {
    readonly send?: StandardSchemaV1 | undefined;
    readonly receive?: StandardSchemaV1 | undefined;
  },
): EventDefinition {
  checkBinding(config.transport, 'event');

  if (config.send === undefined && config.receive === undefined) {
    throw new ContractDefinitionError('event must declare at least one of send and receive');
  }

  for (const key of ['send', 'receive'] as const) {
    if (config[key] !== undefined && !isStandardSchema(config[key])) {
      throw new ContractDefinitionError(`event ${key} must be a Standard Schema`);
    }
  }

  return {
    [DEFINITION]: true,
    kind: 'event',
    transport: config.transport,
    send: config.send,
    receive: config.receive,
    codec: config.codec,
    meta: config.meta,
  };
}

export type AnyDefinition = ActionDefinition | EventDefinition;

export function isDefinition(value: unknown): value is AnyDefinition {
  return typeof value === 'object' && value !== null && (value as { [DEFINITION]?: unknown })[DEFINITION] === true;
}

function checkBinding(binding: TransportBinding, family: TransportBinding['family']): void {
  if (typeof binding !== 'object' || binding === null || typeof binding.driver !== 'string') {
    throw new ContractDefinitionError(`${family} transport must be a binding produced by a driver`);
  }

  if (binding.family !== family) {
    throw new ContractDefinitionError(
      `driver "${binding.driver}" binding carries ${binding.family} channels, it cannot be used for an ${family}`,
    );
  }
}

function checkRequiredFields(value: StandardSchemaV1 | undefined, binding: ActionBinding): void {
  const requires = binding.requires ?? {};
  const required = Object.entries(requires);

  if (required.length === 0) {
    return;
  }

  if (value === undefined) {
    throw new ContractDefinitionError(
      `driver "${binding.driver}" binding requires the input fields ${required.map(([wire]) => `"${wire}"`).join(', ')}`,
    );
  }

  // Plain object schemas are opaque at runtime: their keys are only checked at compile time
  if (!isInputDefinition(value)) {
    return;
  }

  for (const [wire, source] of required) {
    const match = value.fields.some(
      (field) => field.wireName === wire && (field.source === undefined || field.source === source),
    );

    if (!match) {
      throw new ContractDefinitionError(
        `input is missing the field "${wire}" (source "${source}") required by driver "${binding.driver}"`,
      );
    }
  }

  const closedSources = new Set(Object.values(requires));

  for (const field of value.fields) {
    if (field.source !== undefined && closedSources.has(field.source) && !(field.wireName in requires)) {
      throw new ContractDefinitionError(
        `input field "${field.name}" uses source "${field.source}" but "${field.wireName}" is not expected by driver ` +
          `"${binding.driver}" (expected: ${Object.keys(requires).join(', ')})`,
      );
    }
  }
}

function checkActionInput(value: StandardSchemaV1, binding: ActionBinding): void {
  if (!isStandardSchema(value)) {
    throw new ContractDefinitionError('action input must be an input() or a Standard Schema');
  }

  if (!isInputDefinition(value)) {
    return;
  }

  for (const field of value.fields) {
    if (field.source !== undefined && !binding.sources.includes(field.source)) {
      throw new ContractDefinitionError(
        `input field "${field.name}" uses source "${field.source}", not supported by driver "${binding.driver}" ` +
          `(supported: ${binding.sources.join(', ') || 'none'})`,
      );
    }
  }
}
