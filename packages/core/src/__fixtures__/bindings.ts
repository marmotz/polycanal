import type { ActionBinding, EventBinding } from '../binding.js';
import type { MemoryRequest, MemoryResponse } from './memory-driver.js';

/** REST-like binding, standing in for `@polycanal/rest` in core tests. Carried by the memory driver. */
export interface TestRestBinding extends ActionBinding<'path' | 'query' | 'body' | 'header'> {
  readonly method: string;
  readonly path: string;
  readonly '~request'?: MemoryRequest;
  readonly '~response'?: MemoryResponse;
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

type PathParams<TPath extends string> = TPath extends `${string}:${infer TParam}/${infer TRest}`
  ? TParam | PathParams<`/${TRest}`>
  : TPath extends `${string}:${infer TParam}`
    ? TParam
    : never;

/** REST-like binding declaring its path parameters as required fields. */
export function restPath<const TPath extends string>(
  method: string,
  path: TPath,
): TestRestBinding & { readonly requires: { readonly [K in PathParams<TPath>]: 'path' } } {
  const params = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1] as string);

  return {
    ...restLike(method, path),
    requires: Object.fromEntries(params.map((param) => [param, 'path'])) as { [K in PathParams<TPath>]: 'path' },
  };
}
