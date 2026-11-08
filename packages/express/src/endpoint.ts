import type { FieldDescriptor, OperationMeta, StandardSchemaV1 } from '@polycanal/core';
import { checkResponses, type RequestLike, type ResponseLike } from './output.js';

/** Input of an endpoint: a field map (like `input()`), or an object schema spread with the default rules. */
export type EndpointInput = Readonly<Record<string, StandardSchemaV1 | FieldDescriptor>> | StandardSchemaV1;

export interface EndpointOptions {
  /** Operation name. Default: derived from the method and the path (`getHouseholdsById`). */
  readonly name?: string;
  readonly namespace?: string | readonly string[];
  readonly input?: EndpointInput;
  /** Response schema. */
  readonly output: StandardSchemaV1;
  /** Error body schemas by HTTP status. */
  readonly errors?: Readonly<Record<number, StandardSchemaV1>>;
  /** Success status codes. Default: any 2xx status. */
  readonly status?: number | readonly number[];
  readonly meta?: OperationMeta;
}

const ENDPOINT = Symbol.for('polycanal.express.endpoint');

type Middleware = (request: unknown, response: unknown, next: () => void) => void;

/**
 * Marks an Express route as part of the contract and attaches its schemas. It is a middleware, so it works with plain
 * Express and with decorator libraries that accept middlewares. It only calls `next()`, unless the application
 * validates its responses (`validateResponses(app)`): it then checks what the route answers with `res.json()`.
 *
 * @example
 * app.post('/auth/login', endpoint({ input: LoginSchema, output: SessionSchema }), login);
 *
 * // @reflet/express
 * @Post('/login')
 * @Use(endpoint({ input: LoginSchema, output: SessionSchema }))
 * login(@Body() body: Login) {}
 */
export function endpoint(options: EndpointOptions): Middleware {
  const middleware: Middleware = (request, response, next) => {
    checkResponses(options.output, request as RequestLike, response as ResponseLike);
    next();
  };
  (middleware as unknown as Record<symbol, EndpointOptions>)[ENDPOINT] = options;

  return middleware;
}

/**
 * Options of an `endpoint()` middleware, `undefined` for any other handler. Wrappers that keep the original function
 * in a symbol property, as `@reflet/express` does, are followed.
 */
export function endpointOf(handler: unknown): EndpointOptions | undefined {
  if (typeof handler !== 'function') {
    return undefined;
  }

  const holder = handler as unknown as Record<symbol, unknown>;
  const direct = holder[ENDPOINT] as EndpointOptions | undefined;

  if (direct !== undefined) {
    return direct;
  }

  for (const key of Object.getOwnPropertySymbols(handler)) {
    const wrapped = holder[key];

    if (typeof wrapped === 'function' && (wrapped as unknown as Record<symbol, unknown>)[ENDPOINT] !== undefined) {
      return (wrapped as unknown as Record<symbol, EndpointOptions>)[ENDPOINT];
    }
  }

  return undefined;
}
