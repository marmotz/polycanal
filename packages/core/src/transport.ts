import type { ActionModel, EventModel } from './contract.js';

/** Free data attached to a call, visible to interceptors and drivers (e.g. a tenant, a retry flag). */
export type CallContext = Readonly<Record<string, unknown>>;

/** An action call, after its input was validated. */
export interface ActionCall {
  readonly operation: ActionModel;
  /** Validated input (output of the input schema), `undefined` when the action has no input. */
  readonly input: unknown;
  readonly signal: AbortSignal | undefined;
  readonly context: CallContext;
}

/** What a driver read from a response, before the client validates it. */
export type ActionOutcome =
  | { readonly ok: true; readonly body: unknown }
  | {
      readonly ok: false;
      /** Key matched against the action `errors` (HTTP status for REST). */
      readonly key: string;
      readonly body: unknown;
    };

/**
 * Request/response half of a transport driver. A call goes through `prepare`, then the interceptor chain wrapping
 * `send`, then `read`.
 */
export interface ActionTransport<TRequest = unknown, TResponse = unknown> {
  /** Builds the native request from the operation and its validated input, encoding the body. */
  prepare(call: ActionCall): TRequest | Promise<TRequest>;
  /** Sends a native request. Rejects only on transport failures (network, abort, undecodable body). */
  send(request: TRequest, call: ActionCall): Promise<TResponse>;
  /** Turns a native response into an outcome. */
  read(response: TResponse, call: ActionCall): ActionOutcome | Promise<ActionOutcome>;
}

/** An event channel operation. */
export interface EventCall {
  readonly operation: EventModel;
  readonly context: CallContext;
}

/** Publish/subscribe half of a transport driver. */
export interface EventTransport {
  /** Sends a validated message. */
  publish(call: EventCall, message: unknown): Promise<void>;
  /**
   * Starts listening. `listener` receives raw messages, validated by the client. Returns a function that stops the
   * subscription.
   */
  subscribe(call: EventCall, listener: (message: unknown) => void, onError: (error: unknown) => void): () => void;
}

export interface InterceptorContext {
  readonly call: ActionCall;
  /** Name of the driver carrying the call. */
  readonly driver: string;
}

/**
 * Middleware around `send`. It can change the request, change the response, retry by calling `next` again (e.g.
 * after refreshing a token) or issue other calls through the client.
 */
export type Interceptor<TRequest = unknown, TResponse = unknown> = (
  request: TRequest,
  next: (request: TRequest) => Promise<TResponse>,
  context: InterceptorContext,
) => Promise<TResponse>;

/** Client-side implementation of a transport, selected by the `driver` name of the bindings it carries. */
export interface TransportDriver<TRequest = unknown, TResponse = unknown> {
  /** Matches `TransportBinding.driver`. */
  readonly name: string;
  readonly action?: ActionTransport<TRequest, TResponse>;
  readonly event?: EventTransport;
  /** Interceptors applied to every call carried by this driver. */
  readonly interceptors?: readonly Interceptor<TRequest, TResponse>[];
}
