import { type ActionModel, actionModel, type ContractTree, type EventModel, eventModel, toModel } from './contract.js';
import { type ActionDefinition, type EventDefinition, isDefinition } from './definition.js';
import { PolycanalError } from './errors.js';
import type { ActionInputOf, ActionOutputOf, EventReceiveOf, EventSendOf } from './infer.js';
import type { StandardSchemaV1 } from './schema.js';
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

export interface OperationOptions {
  readonly interceptors?: readonly AnyInterceptor[];
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
      node[name] = (input: unknown, callOptions?: CallOptions) => runtime.call(operation, input, callOptions);
    } else {
      node[name] = runtime.eventHandle(eventModel(child, path));
    }
  }

  return node;
}

class ClientRuntime {
  private readonly drivers: ReadonlyMap<string, TransportDriver>;

  constructor(private readonly options: ClientOptions) {
    const list = Array.isArray(options.drivers)
      ? options.drivers
      : Object.values(options.drivers as Record<string, TransportDriver>);
    this.drivers = new Map(list.map((driver) => [driver.name, driver]));
  }

  async call(operation: ActionModel, rawInput: unknown, callOptions: CallOptions = {}): Promise<unknown> {
    const driverName = operation.transport.driver;
    const fail = (
      message: string,
      details: Omit<ConstructorParameters<typeof PolycanalError>[1], 'operation' | 'driver'>,
    ) => new PolycanalError(`${operation.id}: ${message}`, { ...details, operation: operation.id, driver: driverName });

    const driver = this.drivers.get(driverName);
    const transport = driver?.action;

    if (driver === undefined || transport === undefined) {
      throw fail(`no driver "${driverName}" carrying actions was given to createClient()`, { kind: 'transport' });
    }

    let input: unknown;

    if (operation.input !== undefined) {
      const result = await operation.input.schema['~standard'].validate(rawInput);

      if (result.issues) {
        throw fail('invalid input', { kind: 'input', issues: result.issues });
      }

      input = result.value;
    }

    const call: ActionCall = {
      operation,
      input,
      signal: callOptions.signal,
      context: callOptions.context ?? {},
    };

    const request = await attempt(
      () => transport.prepare(call),
      (cause) => fail('could not prepare the request', { kind: 'transport', cause }),
    );

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
    const response = await chain(interceptors, send, context)(request);

    const outcome: ActionOutcome = await attempt(
      () => transport.read(response, call),
      (cause) => fail('could not read the response', { kind: 'transport', cause, response }),
    );

    if (!outcome.ok) {
      const schema = operation.errors[outcome.key];
      const result = schema === undefined ? undefined : await schema['~standard'].validate(outcome.body);

      throw fail(`server error ${outcome.key}`, {
        kind: 'server',
        key: outcome.key,
        data: result === undefined || result.issues ? outcome.body : result.value,
        issues: result?.issues,
        response,
      });
    }

    const result = await operation.output['~standard'].validate(outcome.body);

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
      handle.publish = async (message: unknown, options: { context?: CallContext } = {}) => {
        const events = transport();
        const result = await send['~standard'].validate(message);

        if (result.issues) {
          throw fail('invalid message', { kind: 'input', issues: result.issues });
        }

        const call: EventCall = { operation, context: options.context ?? {} };

        await attempt(
          () => events.publish(call, result.value),
          (cause) => fail('could not publish the message', { kind: 'transport', cause }),
        );
      };
    }

    if (receive !== undefined) {
      handle.subscribe = (listener: (message: unknown) => void, options: SubscribeOptions = {}) => {
        const events = transport();
        const onError = options.onError ?? (() => {});
        const call: EventCall = { operation, context: options.context ?? {} };

        return events.subscribe(
          call,
          (raw) => {
            validateMessage(receive, raw).then(
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

async function validateMessage(schema: StandardSchemaV1, value: unknown): Promise<StandardSchemaV1.Result<unknown>> {
  return schema['~standard'].validate(value);
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
