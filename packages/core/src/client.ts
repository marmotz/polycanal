import { type ActionModel, actionModel, type ContractTree, type EventModel, eventModel, toModel } from './contract.js';
import { type ActionDefinition, type EventDefinition, isDefinition } from './definition.js';
import { isPolycanalError, PolycanalError } from './errors.js';
import type { ActionInputOf, ActionOutputOf, EventReceiveOf, EventSendOf } from './infer.js';
import { isInputDefinition, validateFields } from './input.js';
import { type SchemaValidator, type StandardSchemaV1, standardValidator } from './schema.js';
import type {
  ActionCall,
  ActionOutcome,
  CallContext,
  EventCall,
  Interceptor,
  InterceptorContext,
  TransportDriver,
} from './transport.js';

/** Native request type of a binding, declared by its driver package through the `~request` phantom property. */
export type RequestOf<TBinding> = TBinding extends { readonly '~request'?: infer TRequest } ? TRequest : unknown;

/** Native response type of a binding, declared through the `~response` phantom property. */
export type ResponseOf<TBinding> = TBinding extends { readonly '~response'?: infer TResponse } ? TResponse : unknown;

/** Interceptor accepting any native request: global and per-operation interceptors see every driver. */
// biome-ignore lint/suspicious/noExplicitAny: the request and response types depend on the driver of each call
export type AnyInterceptor = Interceptor<any, any>;

export interface CallOptions<TRequest = unknown, TResponse = unknown> {
  readonly signal?: AbortSignal;
  /** Free data visible to interceptors and drivers. */
  readonly context?: CallContext;
  /** Interceptors of this call only, innermost in the chain. */
  readonly interceptors?: readonly Interceptor<TRequest, TResponse>[];
}

type ActionCallOptions<TAction extends ActionDefinition> = CallOptions<
  RequestOf<TAction['transport']>,
  ResponseOf<TAction['transport']>
>;

/** Client method of an action. The argument is optional when the action has no input or only optional fields. */
export type ActionMethod<TAction extends ActionDefinition> = [TAction['input']] extends [undefined]
  ? (input?: undefined, options?: ActionCallOptions<TAction>) => Promise<ActionOutputOf<TAction>>
  : Record<never, never> extends ActionInputOf<TAction>
    ? (input?: ActionInputOf<TAction>, options?: ActionCallOptions<TAction>) => Promise<ActionOutputOf<TAction>>
    : (input: ActionInputOf<TAction>, options?: ActionCallOptions<TAction>) => Promise<ActionOutputOf<TAction>>;

export interface SubscribeOptions {
  /** Receives transport failures and messages that do not match the `receive` schema. */
  readonly onError?: (error: PolycanalError) => void;
  readonly context?: CallContext;
}

/** Client handle of an event channel: `publish` needs a `send` schema, `subscribe` a `receive` schema. */
export type EventHandle<TEvent extends EventDefinition> = ([TEvent['send']] extends [undefined]
  ? Record<never, never>
  : {
      readonly publish: (message: EventSendOf<TEvent>, options?: { readonly context?: CallContext }) => Promise<void>;
    }) &
  ([TEvent['receive']] extends [undefined]
    ? Record<never, never>
    : {
        readonly subscribe: (
          listener: (message: EventReceiveOf<TEvent>) => void,
          options?: SubscribeOptions,
        ) => () => void;
      });

type ClientNode<TNode> = TNode extends ActionDefinition
  ? ActionMethod<TNode>
  : TNode extends EventDefinition
    ? EventHandle<TNode>
    : TNode extends ContractTree
      ? Client<TNode>
      : never;

/** Typed client of a contract: same tree, with methods for actions and handles for events. */
export type Client<TTree extends ContractTree> = { readonly [K in keyof TTree]: ClientNode<TTree[K]> };

/**
 * What a call sends once its argument is valid:
 * - `raw`: the argument as the caller gave it, restricted to the declared fields. The server validates it again with
 *   the same schemas and applies the transforms and defaults once;
 * - `parsed`: the output of the schemas (transforms and defaults applied), for a server that does not validate again.
 */
export type SendMode = 'raw' | 'parsed';

export interface OperationOptions {
  readonly interceptors?: readonly AnyInterceptor[];
  /** What the calls of this operation or namespace send. Default: the `send` of the client. */
  readonly send?: SendMode;
}

export interface ClientOptions {
  /** Driver implementations, by name. Each binding is carried by the driver whose `name` matches its `driver`. */
  // biome-ignore lint/suspicious/noExplicitAny: drivers have heterogeneous native request and response types
  readonly drivers: readonly TransportDriver<any, any>[] | Readonly<Record<string, TransportDriver<any, any>>>;
  /** Interceptors of every call, outermost in the chain. */
  readonly interceptors?: readonly AnyInterceptor[];
  /**
   * Options per operation or namespace, keyed by id or id prefix (`'households'` applies to `'households.list'`).
   * Their interceptors run after the global and driver ones, shorter prefixes first.
   */
  readonly operations?: Readonly<Record<string, OperationOptions>>;
  /** What a call sends once its argument is valid. Default: `'raw'`. */
  readonly send?: SendMode;
  /**
   * Runs every schema of the contract (input fields, responses, error bodies, event messages). Default: Standard
   * Schema. Use it to pass library options, e.g. `zodValidator({ error: frenchMessages })` from `@polycanal/zod`.
   */
  readonly validator?: SchemaValidator;
  /**
   * Turns the `PolycanalError` of a failed action call or event publication into the error the application throws
   * (its own error class, a translated message...). Other errors are rethrown untouched.
   */
  readonly mapError?: (error: PolycanalError) => unknown;
}

/**
 * Creates the typed client of a contract. Every argument is validated before being sent, every response and every
 * received message is validated before being returned; failures throw `PolycanalError`.
 */
export function createClient<const TTree extends ContractTree>(contract: TTree, options: ClientOptions): Client<TTree> {
  toModel(contract); // checks the tree
  const runtime = new ClientRuntime(options);

  return build(contract, [], runtime) as Client<TTree>;
}

function build(tree: ContractTree, prefix: readonly string[], runtime: ClientRuntime): Record<string, unknown> {
  const node: Record<string, unknown> = {};

  for (const [name, child] of Object.entries(tree)) {
    const path = [...prefix, name];

    if (!isDefinition(child)) {
      node[name] = build(child, path, runtime);
    } else if (child.kind === 'action') {
      const operation = actionModel(child, path);
      node[name] = (input: unknown, callOptions?: CallOptions) =>
        runtime.mapped(runtime.call(operation, input, callOptions));
    } else {
      node[name] = runtime.eventHandle(eventModel(child, path));
    }
  }

  return node;
}

/** Builds the `PolycanalError` of a failed call, located at its operation and driver. */
type Fail = (
  message: string,
  details: Omit<ConstructorParameters<typeof PolycanalError>[1], 'operation' | 'driver'>,
) => PolycanalError;

class ClientRuntime {
  private readonly drivers: ReadonlyMap<string, TransportDriver>;
  private readonly validator: SchemaValidator;

  constructor(private readonly options: ClientOptions) {
    const list = Array.isArray(options.drivers)
      ? options.drivers
      : Object.values(options.drivers as Record<string, TransportDriver>);
    this.drivers = new Map(list.map((driver) => [driver.name, driver]));
    this.validator = options.validator ?? standardValidator;
  }

  /** Applies `mapError` to the `PolycanalError` a call rejects with. */
  mapped<T>(promise: Promise<T>): Promise<T> {
    const { mapError } = this.options;

    if (mapError === undefined) {
      return promise;
    }

    return promise.catch((error: unknown) => {
      throw isPolycanalError(error) ? mapError(error) : error;
    });
  }

  /**
   * Runs a schema through the validator; an `input()` runs each of its field schemas through it. The result is
   * synchronous when the schema is.
   */
  run(
    schema: StandardSchemaV1,
    value: unknown,
  ): StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>> {
    return isInputDefinition(schema)
      ? validateFields(schema.fields, value, this.validator)
      : this.validator(schema, value);
  }

  async validate(schema: StandardSchemaV1, value: unknown): Promise<StandardSchemaV1.Result<unknown>> {
    return this.run(schema, value);
  }

  /** The value a valid argument sends, depending on the send mode of the operation. */
  payload(id: string, schema: StandardSchemaV1, raw: unknown, parsed: unknown): unknown {
    if (this.sendMode(id) === 'parsed') {
      return parsed;
    }

    if (isInputDefinition(schema)) {
      const record = (raw ?? {}) as Record<string, unknown>;

      return Object.fromEntries(
        schema.fields
          .filter((field) => record[field.name] !== undefined)
          .map((field) => [field.name, record[field.name]]),
      );
    }

    // Keys the schema dropped (unknown ones) are not sent; keys it added (defaults) are left to the server
    return isRecord(raw) && isRecord(parsed)
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => key in parsed))
      : raw;
  }

  private sendMode(id: string): SendMode {
    const own = Object.entries(this.options.operations ?? {})
      .filter(([key, options]) => (id === key || id.startsWith(`${key}.`)) && options.send !== undefined)
      .sort(([a], [b]) => b.length - a.length)[0];

    return own?.[1].send ?? this.options.send ?? 'raw';
  }

  /**
   * Calls an action. Everything up to the driver's `send()` runs synchronously when the schemas and the driver are
   * synchronous: the request leaves during the call itself, not a microtask later.
   */
  call(operation: ActionModel, rawInput: unknown, callOptions: CallOptions = {}): Promise<unknown> {
    const driverName = operation.transport.driver;
    const fail = (
      message: string,
      details: Omit<ConstructorParameters<typeof PolycanalError>[1], 'operation' | 'driver'>,
    ) => new PolycanalError(`${operation.id}: ${message}`, { ...details, operation: operation.id, driver: driverName });

    const driver = this.drivers.get(driverName);
    const transport = driver?.action;

    if (driver === undefined || transport === undefined) {
      return Promise.reject(
        fail(`no driver "${driverName}" carrying actions was given to createClient()`, { kind: 'transport' }),
      );
    }

    const sendRequest = (input: unknown): Promise<unknown> => {
      const call: ActionCall = {
        operation,
        input,
        signal: callOptions.signal,
        context: callOptions.context ?? {},
      };
      const interceptors = [
        ...(this.options.interceptors ?? []),
        ...(driver.interceptors ?? []),
        ...this.operationInterceptors(operation.id),
        ...(callOptions.interceptors ?? []),
      ];
      const context: InterceptorContext = { call, driver: driverName };
      const send = (nativeRequest: unknown) =>
        attempt(
          () => transport.send(nativeRequest, call),
          (cause) => fail('could not send the request', { kind: 'transport', cause }),
        );

      return Promise.resolve(
        settle(
          attemptNow(
            () => transport.prepare(call),
            (cause) => fail('could not prepare the request', { kind: 'transport', cause }),
          ),
          (request) => chain(interceptors, send, context)(request),
        ),
      ).then((response) => this.receive(operation, call, response, fail));
    };

    try {
      if (operation.input === undefined) {
        return sendRequest(undefined);
      }

      const { schema } = operation.input;

      return Promise.resolve(
        settle(this.run(schema, rawInput), (result) => {
          if (result.issues) {
            throw fail('invalid input', { kind: 'input', issues: result.issues });
          }

          return sendRequest(this.payload(operation.id, schema, rawInput, result.value));
        }),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async receive(operation: ActionModel, call: ActionCall, response: unknown, fail: Fail): Promise<unknown> {
    const transport = this.drivers.get(operation.transport.driver)?.action as NonNullable<TransportDriver['action']>;
    const outcome: ActionOutcome = await attempt(
      () => transport.read(response, call),
      (cause) => fail('could not read the response', { kind: 'transport', cause, response }),
    );

    if (!outcome.ok) {
      const schema = operation.errors[outcome.key];
      const result = schema === undefined ? undefined : await this.validate(schema, outcome.body);

      throw fail(`server error ${outcome.key}`, {
        kind: 'server',
        key: outcome.key,
        data: result === undefined || result.issues ? outcome.body : result.value,
        issues: result?.issues,
        response,
      });
    }

    const result = await this.validate(operation.output, outcome.body);

    if (result.issues) {
      throw fail('invalid response', { kind: 'output', issues: result.issues, response });
    }

    return result.value;
  }

  eventHandle(operation: EventModel): Record<string, unknown> {
    const handle: Record<string, unknown> = {};
    const driverName = operation.transport.driver;
    const fail = (
      message: string,
      details: Omit<ConstructorParameters<typeof PolycanalError>[1], 'operation' | 'driver'>,
    ) => new PolycanalError(`${operation.id}: ${message}`, { ...details, operation: operation.id, driver: driverName });
    const transport = () => {
      const events = this.drivers.get(driverName)?.event;

      if (events === undefined) {
        throw fail(`no driver "${driverName}" carrying events was given to createClient()`, { kind: 'transport' });
      }

      return events;
    };

    const { send, receive } = operation;

    if (send !== undefined) {
      const publish = async (message: unknown, options: { context?: CallContext } = {}) => {
        const events = transport();
        const result = await this.validate(send, message);

        if (result.issues) {
          throw fail('invalid message', { kind: 'input', issues: result.issues });
        }

        const call: EventCall = { operation, context: options.context ?? {} };
        const payload = this.payload(operation.id, send, message, result.value);

        await attempt(
          () => events.publish(call, payload),
          (cause) => fail('could not publish the message', { kind: 'transport', cause }),
        );
      };

      handle.publish = (message: unknown, options?: { context?: CallContext }) =>
        this.mapped(publish(message, options));
    }

    if (receive !== undefined) {
      handle.subscribe = (listener: (message: unknown) => void, options: SubscribeOptions = {}) => {
        const events = transport();
        const onError = options.onError ?? (() => {});
        const call: EventCall = { operation, context: options.context ?? {} };

        return events.subscribe(
          call,
          (raw) => {
            this.validate(receive, raw).then(
              (result) => {
                if (result.issues) {
                  onError(fail('invalid message received', { kind: 'output', issues: result.issues, response: raw }));
                } else {
                  listener(result.value);
                }
              },
              (cause: unknown) => onError(fail('could not validate a received message', { kind: 'output', cause })),
            );
          },
          (cause) => onError(fail('subscription failed', { kind: 'transport', cause })),
        );
      };
    }

    return handle;
  }

  private operationInterceptors(id: string): AnyInterceptor[] {
    return Object.entries(this.options.operations ?? {})
      .filter(([key]) => id === key || id.startsWith(`${key}.`))
      .sort(([a], [b]) => a.length - b.length)
      .flatMap(([, options]) => options.interceptors ?? []);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

/** Applies `next` right away to a plain value, or once a promise resolves. */
function settle<T, U>(value: T | PromiseLike<T>, next: (value: T) => U | PromiseLike<U>): U | PromiseLike<U> {
  return isPromiseLike(value) ? value.then(next) : next(value);
}

/** `attempt()` that stays synchronous when `task` is. */
function attemptNow<T>(task: () => T | PromiseLike<T>, wrap: (cause: unknown) => PolycanalError): T | Promise<T> {
  const rethrow = (cause: unknown): never => {
    throw cause instanceof PolycanalError ? cause : wrap(cause);
  };

  try {
    const value = task();

    return isPromiseLike(value) ? Promise.resolve(value).catch(rethrow) : value;
  } catch (cause) {
    return rethrow(cause);
  }
}

/** Runs `task`, turning any failure that is not already a `PolycanalError` into one. */
async function attempt<T>(task: () => T | Promise<T>, wrap: (cause: unknown) => PolycanalError): Promise<T> {
  try {
    return await task();
  } catch (cause) {
    throw cause instanceof PolycanalError ? cause : wrap(cause);
  }
}

function chain(
  interceptors: readonly AnyInterceptor[],
  send: (request: unknown) => Promise<unknown>,
  context: InterceptorContext,
): (request: unknown) => Promise<unknown> {
  return interceptors.reduceRight<(request: unknown) => Promise<unknown>>(
    (next, interceptor) => (request) => interceptor(request, next, context),
    send,
  );
}
