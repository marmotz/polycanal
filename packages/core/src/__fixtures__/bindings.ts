import type { ActionBinding, EventBinding } from '../binding.js';

/** REST-like binding, standing in for `@polycanal/rest` in core tests. */
export interface TestRestBinding extends ActionBinding<'path' | 'query' | 'body' | 'header'> {
  readonly method: string;
  readonly path: string;
}

export function restLike(method: string, path: string): TestRestBinding {
  return { driver: 'test-rest', family: 'action', sources: ['path', 'query', 'body', 'header'], method, path };
}

/** Binding of a driver accepting a single `payload` source. */
export function payloadOnly(): ActionBinding<'payload'> {
  return { driver: 'test-payload', family: 'action', sources: ['payload'] };
}

export interface TestEventBinding extends EventBinding {
  readonly name: string;
}

export function wsLike(name: string): TestEventBinding {
  return { driver: 'test-ws', family: 'event', sources: [], name };
}
