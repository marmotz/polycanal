import type { ActionCall, EventCall, TransportDriver } from '../transport.js';

export interface MemoryRequest {
  readonly operation: string;
  readonly input: unknown;
  readonly headers: Record<string, string>;
}

export interface MemoryResponse {
  readonly status: number;
  readonly body: unknown;
}

export type MemoryHandler = (request: MemoryRequest, call: ActionCall) => MemoryResponse | Promise<MemoryResponse>;

/** In-memory driver for client tests: answers actions with `handler`, emits events on demand. */
export function memoryDriver(
  handler: MemoryHandler,
  options: {
    readonly name?: string;
    readonly interceptors?: TransportDriver<MemoryRequest, MemoryResponse>['interceptors'];
  } = {},
) {
  const listeners = new Map<string, Set<(message: unknown) => void>>();
  const errorListeners = new Map<string, Set<(error: unknown) => void>>();
  const published: { operation: string; message: unknown }[] = [];
  const sent: MemoryRequest[] = [];

  const driver: TransportDriver<MemoryRequest, MemoryResponse> = {
    name: options.name ?? 'test-rest',
    ...(options.interceptors ? { interceptors: options.interceptors } : {}),
    action: {
      prepare: (call) => ({ operation: call.operation.id, input: call.input, headers: {} }),
      send: async (request, call) => {
        sent.push(request);

        return handler(request, call);
      },
      read: (response) =>
        response.status < 400
          ? { ok: true, body: response.body }
          : { ok: false, key: String(response.status), body: response.body },
    },
    event: {
      publish: async (call: EventCall, message) => {
        published.push({ operation: call.operation.id, message });
      },
      subscribe: (call, listener, onError) => {
        const id = call.operation.id;
        const set = listeners.get(id) ?? new Set();
        set.add(listener);
        listeners.set(id, set);
        const errors = errorListeners.get(id) ?? new Set();
        errors.add(onError);
        errorListeners.set(id, errors);

        return () => {
          set.delete(listener);
          errors.delete(onError);
        };
      },
    },
  };

  return {
    driver,
    sent,
    published,
    emit: (operation: string, message: unknown) => {
      for (const listener of listeners.get(operation) ?? []) {
        listener(message);
      }
    },
    fail: (operation: string, error: unknown) => {
      for (const listener of errorListeners.get(operation) ?? []) {
        listener(error);
      }
    },
  };
}
