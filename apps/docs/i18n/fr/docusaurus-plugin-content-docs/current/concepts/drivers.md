---
title: Drivers
---

# Drivers

Polycanal est construit à partir de drivers interchangeables, définis dans `@polycanal/core`.

## Bindings

Un binding est une donnée simple produite par un package de driver et portée par chaque opération :

```ts
interface TransportBinding<TFamily, TSource> {
  readonly driver: string; // which driver carries it, e.g. 'rest'
  readonly family: TFamily; // 'action' or 'event'
  readonly sources: readonly TSource[]; // accepted input field sources
  readonly requires?: Readonly<Record<string, TSource>>; // required fields by wire name (REST path parameters)
}
```

Un binding ne contient aucun code de transport : le même contrat fonctionne avec `fetchRest()` d'un côté et
`angularRest()` de l'autre.

## Drivers de transport

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

Un appel d'action passe par `prepare` (construire la requête native, encoder le body), puis par la chaîne
d'intercepteurs autour de `send`, puis par `read`, qui renvoie `{ ok: true, body }` ou `{ ok: false, key, body }`. La
validation est faite par le client, pas par les drivers.

## Codecs

```ts
interface Codec {
  readonly contentType: string;
  encode(value: unknown): string;
  decode(text: string): unknown;
}
```

Les codecs sont textuels pour l'instant ; `jsonCodec` est le codec par défaut de chaque driver.

## Émetteurs de bindings

La génération de code reconstruit les bindings avec un `BindingEmitter` fourni par chaque package de driver : par
exemple, `restBindingEmitter` émet `rest.post('/auth/login')`.
