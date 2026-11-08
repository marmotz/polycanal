import type { ActionBinding, Codec, EventBinding, OperationMeta } from './binding.js';
import { type ActionDefinition, type AnyDefinition, type EventDefinition, isDefinition } from './definition.js';
import { ContractDefinitionError } from './errors.js';
import { isInputDefinition, type NormalizedField } from './input.js';
import type { StandardSchemaV1 } from './schema.js';

/** A contract is a tree of plain objects: nesting gives namespaces, leaves are actions and events. */
export interface ContractTree {
  readonly [name: string]: ContractNode;
}

export type ContractNode = AnyDefinition | ContractTree;

/**
 * Declares a contract. Contracts can be split per file and composed by nesting, and a contract with a single
 * operation is valid. Returns the tree unchanged, after checking it.
 */
export function defineContract<const TTree extends ContractTree>(tree: TTree): TTree {
  checkTree(tree, []);

  return tree;
}

/** Normalized form of an action (spec §3, internal model). */
export interface ActionModel {
  readonly family: 'action';
  /** Dotted location in the contract, e.g. `'households.list'`. */
  readonly id: string;
  readonly path: readonly string[];
  readonly transport: ActionBinding;
  readonly input: InputModel | undefined;
  readonly output: StandardSchemaV1;
  readonly errors: Readonly<Record<string, StandardSchemaV1>>;
  readonly codec: Codec | undefined;
  readonly meta: OperationMeta | undefined;
}

export interface InputModel {
  /** Validates the whole call object. */
  readonly schema: StandardSchemaV1;
  /** Field mapping when the input was declared with `input()`, `undefined` for a plain object schema. */
  readonly fields: readonly NormalizedField[] | undefined;
}

/** Normalized form of an event channel. */
export interface EventModel {
  readonly family: 'event';
  readonly id: string;
  readonly path: readonly string[];
  readonly transport: EventBinding;
  readonly send: StandardSchemaV1 | undefined;
  readonly receive: StandardSchemaV1 | undefined;
  readonly codec: Codec | undefined;
  readonly meta: OperationMeta | undefined;
}

export type OperationModel = ActionModel | EventModel;

/** Internal model of a contract: the flat list of its operations, in declaration order. */
export interface ContractModel {
  readonly operations: readonly OperationModel[];
}

/** Flattens a contract into its internal model, consumed by drivers, generators and exporters. */
export function toModel(contract: ContractTree): ContractModel {
  checkTree(contract, []);
  const operations: OperationModel[] = [];
  collect(contract, [], operations);

  return { operations };
}

function collect(tree: ContractTree, prefix: readonly string[], operations: OperationModel[]): void {
  for (const [name, node] of Object.entries(tree)) {
    const path = [...prefix, name];

    if (!isDefinition(node)) {
      collect(node, path, operations);
      continue;
    }

    operations.push(node.kind === 'action' ? actionModel(node, path) : eventModel(node, path));
  }
}

export function actionModel(definition: ActionDefinition, path: readonly string[]): ActionModel {
  const { input } = definition;

  return {
    family: 'action',
    id: path.join('.'),
    path,
    transport: definition.transport,
    input:
      input === undefined ? undefined : { schema: input, fields: isInputDefinition(input) ? input.fields : undefined },
    output: definition.output,
    errors: { ...definition.errors },
    codec: definition.codec,
    meta: definition.meta,
  };
}

export function eventModel(definition: EventDefinition, path: readonly string[]): EventModel {
  return {
    family: 'event',
    id: path.join('.'),
    path,
    transport: definition.transport,
    send: definition.send,
    receive: definition.receive,
    codec: definition.codec,
    meta: definition.meta,
  };
}

function checkTree(tree: unknown, path: readonly string[]): void {
  if (!isPlainObject(tree)) {
    throw new ContractDefinitionError('expected an action, an event or a namespace object', path);
  }

  for (const [name, node] of Object.entries(tree)) {
    const nodePath = [...path, name];

    if (name === '' || name.includes('.')) {
      throw new ContractDefinitionError('names must be non-empty and must not contain "."', nodePath);
    }

    if (!isDefinition(node)) {
      checkTree(node, nodePath);
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}
