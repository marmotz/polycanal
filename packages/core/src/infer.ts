import type { ActionDefinition, EventDefinition } from './definition.js';
import type { StandardSchemaV1 } from './schema.js';

/** Argument of an action call: `void` when the action declares no input, so that `call()` needs no argument. */
export type ActionInputOf<TAction extends ActionDefinition> = TAction['input'] extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<TAction['input']>
  : // biome-ignore lint/suspicious/noConfusingVoidType: a void parameter lets the call omit its argument
    void;

/** Value an action call resolves to. */
export type ActionOutputOf<TAction extends ActionDefinition> = StandardSchemaV1.InferOutput<TAction['output']>;

/** Message accepted by `publish()`: `never` when the event cannot be published. */
export type EventSendOf<TEvent extends EventDefinition> = TEvent['send'] extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<TEvent['send']>
  : never;

/** Message delivered to `subscribe()` listeners: `never` when the event cannot be received. */
export type EventReceiveOf<TEvent extends EventDefinition> = TEvent['receive'] extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TEvent['receive']>
  : never;
