import type { TransportBinding } from '@polycanal/core';
import { type ContractDescription, type OperationDescription, operationId } from './description.js';

export interface MergeConflict {
  /** Id of the operation kept from the config. */
  readonly operation: string;
  readonly reason: string;
}

export interface MergeResult {
  readonly description: ContractDescription;
  readonly conflicts: readonly MergeConflict[];
}

/**
 * Merges discovered operations (decorators, introspection) into the config, which has the highest priority (spec
 * §3): an operation of the config always wins, and every disagreement with a discovered operation is reported.
 */
export function mergeDescriptions(config: ContractDescription, discovered: ContractDescription): MergeResult {
  const conflicts: MergeConflict[] = [];
  const byId = new Map(config.operations.map((operation) => [operationId(operation), operation]));
  const byBinding = new Map(config.operations.map((operation) => [bindingKey(operation.binding), operation]));
  const added: OperationDescription[] = [];

  for (const operation of discovered.operations) {
    const id = operationId(operation);
    const sameId = byId.get(id);
    const sameBinding = byBinding.get(bindingKey(operation.binding));

    if (sameId !== undefined) {
      if (bindingKey(sameId.binding) !== bindingKey(operation.binding)) {
        conflicts.push({
          operation: id,
          reason: `config declares ${describeBinding(sameId.binding)}, discovered ${describeBinding(operation.binding)}`,
        });
      }

      continue;
    }

    if (sameBinding !== undefined) {
      conflicts.push({
        operation: operationId(sameBinding),
        reason: `${describeBinding(operation.binding)} is also discovered as "${id}"`,
      });

      continue;
    }

    added.push(operation);
  }

  return {
    description: {
      operations: [...config.operations, ...added],
      schemas: { ...discovered.schemas, ...config.schemas },
    },
    conflicts,
  };
}

/** Identity of a binding: its driver data, without the derived fields. */
function bindingKey(binding: TransportBinding): string {
  const { family: _, sources: __, requires: ___, ...data } = binding;

  return JSON.stringify(Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b))));
}

function describeBinding(binding: TransportBinding): string {
  const { method, path } = binding as { method?: unknown; path?: unknown };

  return typeof method === 'string' && typeof path === 'string' ? `${method} ${path}` : bindingKey(binding);
}
