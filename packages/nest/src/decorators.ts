import type { FieldDescriptor, OperationMeta, StandardSchemaV1 } from '@polycanal/core';

/** Field overrides of an endpoint: a schema replaces the discovered one, a descriptor sets its source and alias too. */
export type EndpointFields = Readonly<Record<string, StandardSchemaV1 | FieldDescriptor>>;

export interface EndpointOptions<TOutput extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined> {
  /** Operation name. Default: the handler method name. */
  readonly name?: string;
  /** Namespace, overriding the controller's. */
  readonly namespace?: string | readonly string[];
  /** Response schema (required unless `outputOf` finds one). */
  readonly output?: TOutput;
  /** Error body schemas by HTTP status. */
  readonly errors?: Readonly<Record<number, StandardSchemaV1>>;
  /** Input fields to add or replace, when the handler parameters carry no runtime schema. */
  readonly input?: EndpointFields;
  readonly meta?: OperationMeta;
}

const ENDPOINT = Symbol.for('polycanal.nest.endpoint');
const NAMESPACE = Symbol.for('polycanal.nest.namespace');

type Constructor = abstract new (...args: never[]) => unknown;

/** A value as JSON carries it: a `Date` becomes the string its `toJSON()` returns. */
type Serializable<T> = string extends T
  ? T | Date
  : T extends readonly (infer TItem)[]
    ? readonly Serializable<TItem>[]
    : T extends object
      ? { [K in keyof T]: Serializable<T[K]> }
      : T;

/**
 * What a handler may return for a response schema: the input type of the schema, as JSON carries it, directly, in a
 * promise or in an observable. Without a schema, anything.
 */
export type EndpointResult<TOutput extends StandardSchemaV1 | undefined> = TOutput extends StandardSchemaV1
  ?
      | Serializable<StandardSchemaV1.InferInput<TOutput>>
      | PromiseLike<Serializable<StandardSchemaV1.InferInput<TOutput>>>
      // Observables are not checked: their value type cannot be read without depending on RxJS
      | { readonly subscribe: (...args: never[]) => unknown }
  : unknown;

/** Method decorator that only accepts a handler returning what the response schema describes. */
export type EndpointDecorator<TOutput extends StandardSchemaV1 | undefined> = <
  THandler extends (...args: never[]) => EndpointResult<TOutput>,
>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<THandler>,
) => void;

/**
 * Marks a controller method as part of the contract and attaches what discovery cannot find: the response schema,
 * error schemas, input fields without runtime schema, a name. With an `output`, TypeScript refuses a handler whose
 * return type does not match it.
 *
 * @example
 * @Post('login')
 * @Endpoint({ output: LoginResponseSchema, errors: { 401: InvalidCredentialsSchema } })
 * login(@Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest) {}
 */
export function Endpoint<const TOutput extends StandardSchemaV1 | undefined = undefined>(
  options: EndpointOptions<TOutput> = {},
): EndpointDecorator<TOutput> {
  return (target, propertyKey) => {
    const store = endpointStore(target.constructor as Constructor, true);
    store.set(propertyKey, options);
  };
}

/** Namespace of every endpoint of a controller. Default: the static segments of the controller path. */
export function EndpointNamespace(namespace: string | readonly string[]): ClassDecorator {
  return (target) => {
    (target as unknown as Record<symbol, unknown>)[NAMESPACE] =
      typeof namespace === 'string' ? [namespace] : [...namespace];
  };
}

/** Options given to `@Endpoint()` on a handler, `undefined` when it is not decorated. */
export function endpointOptions(controller: Constructor, method: string | symbol): EndpointOptions | undefined {
  return endpointStore(controller, false)?.get(method);
}

export function endpointNamespace(controller: Constructor): readonly string[] | undefined {
  return (controller as unknown as Record<symbol, readonly string[] | undefined>)[NAMESPACE];
}

function endpointStore(controller: Constructor, create: true): Map<string | symbol, EndpointOptions>;
function endpointStore(controller: Constructor, create: false): Map<string | symbol, EndpointOptions> | undefined;
function endpointStore(controller: Constructor, create: boolean): Map<string | symbol, EndpointOptions> | undefined {
  const holder = controller as unknown as Record<symbol, Map<string | symbol, EndpointOptions> | undefined>;

  if (create && !Object.hasOwn(holder, ENDPOINT)) {
    // Own map per class, seeded with the inherited endpoints
    holder[ENDPOINT] = new Map(holder[ENDPOINT] ?? []);
  }

  return holder[ENDPOINT];
}
