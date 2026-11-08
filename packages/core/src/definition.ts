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
>(config: ActionConfig<TBinding, TOutput, TInput, TErrors>): ActionDefinition<TBinding, TOutput, TInput, TErrors> {
  checkBinding(config.transport, 'action');

  if (config.input !== undefined) {
    checkActionInput(config.input, config.transport);
  }

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
