---
title: Drivers
---

# Drivers

Polycanal is built from interchangeable drivers, defined in `@polycanal/core`.

## Bindings

A binding is plain data produced by a driver package and carried by each operation:

```ts
interface TransportBinding<TFamily, TSource> {
  readonly driver: string; // which driver carries it, e.g. 'rest'
  readonly family: TFamily; // 'action' or 'event'
  readonly sources: readonly TSource[]; // accepted input field sources
  readonly requires?: Readonly<Record<string, TSource>>; // required fields by wire name (REST path parameters)
}
```

A binding contains no transport code: the same contract works with `fetchRest()` on one side and `angularRest()` on
the other.

## Transport drivers

```ts
interface TransportDriver<TRequest, TResponse> {
  readonly name: string;
  readonly action?: {
    prepare(call: ActionCall): TRequest | Promise<TRequest>;
    send(request: TRequest, call: ActionCall): Promise<TResponse>;
    read(response: TResponse, call: ActionCall): ActionOutcome | Promise<ActionOutcome>;
  };
  readonly event?: {
    publish(call: EventCall, message: unknown): Promise<void>;
    subscribe(call: EventCall, listener: (message: unknown) => void, onError: (error: unknown) => void): () => void;
  };
  readonly interceptors?: readonly Interceptor<TRequest, TResponse>[];
}
```

An action call goes through `prepare` (build the native request, encode the body), the interceptor chain around
`send`, then `read`, which returns `{ ok: true, body }` or `{ ok: false, key, body }`. Validation is done by the client,
not by drivers.

## Codecs

```ts
interface Codec {
  readonly contentType: string;
  encode(value: unknown): string;
  decode(text: string): unknown;
}
```

Codecs are text based for now; `jsonCodec` is the default of every driver.

## Binding emitters

Code generation rebuilds bindings with a `BindingEmitter` provided by each driver package, e.g. `restBindingEmitter`
emits `rest.post('/auth/login')`.
