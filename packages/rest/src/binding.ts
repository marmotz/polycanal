import type { ActionBinding } from '@polycanal/core';
import type { HttpRequest, HttpResponse } from './http.js';

/** Where an `input()` field can go in an HTTP request. */
export type RestSource = 'path' | 'query' | 'body' | 'header';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type SegmentParam<TSegment extends string> = TSegment extends `:${infer TName}` ? TName : never;

/** Names of the `:name` path parameters. A parameter spans a whole path segment. */
export type PathParams<TPath extends string> = TPath extends `${infer THead}/${infer TTail}`
  ? SegmentParam<THead> | PathParams<TTail>
  : SegmentParam<TPath>;

export interface RestBindingOptions {
  /** Status codes meaning success. Default: any 2xx status. */
  readonly status?: number | readonly number[];
  /** Encoding of the request body: `'multipart'` sends the body fields as `multipart/form-data`. Default: the codec. */
  readonly body?: 'multipart';
  /** Kind of success response body: `'blob'` delivers a `File`. Default: the codec. */
  readonly response?: 'blob';
}

/** Binding produced by `rest.get()`, `rest.post()`... */
export interface RestBinding<TMethod extends HttpMethod = HttpMethod, TPath extends string = string>
  extends ActionBinding<RestSource> {
  readonly driver: 'rest';
  readonly method: TMethod;
  readonly path: TPath;
  /** Success status codes, `undefined` for any 2xx status. */
  readonly status: readonly number[] | undefined;
  /** Encoding of the request body, `undefined` for the codec. */
  readonly body: 'multipart' | undefined;
  /** Kind of success response body, `undefined` for the codec. */
  readonly response: 'blob' | undefined;
  readonly requires: { readonly [K in PathParams<TPath>]: 'path' };
  readonly '~request'?: HttpRequest;
  readonly '~response'?: HttpResponse;
}

export const REST_SOURCES: readonly RestSource[] = ['path', 'query', 'body', 'header'];

/** Methods whose remaining input fields go to the query string instead of the body. */
export const QUERY_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>(['GET', 'DELETE']);

/** Names of the path parameters of a path, in order. */
export function pathParams(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => {
      const name = segment.slice(1);

      if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        throw new TypeError(`rest: invalid path parameter "${segment}" in "${path}"`);
      }

      return name;
    });
}

function binding<const TMethod extends HttpMethod>(method: TMethod) {
  return <const TPath extends string>(path: TPath, options: RestBindingOptions = {}): RestBinding<TMethod, TPath> => {
    if (!path.startsWith('/')) {
      throw new TypeError(`rest: path "${path}" must start with "/"`);
    }

    if (options.body !== undefined && options.body !== 'multipart') {
      throw new TypeError(`rest: unknown body encoding "${String(options.body)}" for "${path}"`);
    }

    if (options.body === 'multipart' && QUERY_METHODS.has(method)) {
      throw new TypeError(`rest: ${method} "${path}" cannot send a multipart body`);
    }

    if (options.response !== undefined && options.response !== 'blob') {
      throw new TypeError(`rest: unknown response kind "${String(options.response)}" for "${path}"`);
    }

    const requires = Object.fromEntries(pathParams(path).map((name) => [name, 'path'])) as RestBinding<
      TMethod,
      TPath
    >['requires'];
    const status =
      options.status === undefined
        ? undefined
        : typeof options.status === 'number'
          ? [options.status]
          : [...options.status];

    return {
      driver: 'rest',
      family: 'action',
      sources: REST_SOURCES,
      method,
      path,
      status,
      body: options.body,
      response: options.response,
      requires,
    };
  };
}

/**
 * REST bindings. Path parameters (`:name` segments) must match `input` fields, which is checked at compile time.
 *
 * @example
 * action({ transport: rest.patch('/users/:userId'), input: input({ ... }), output: UserSchema })
 */
export const rest = {
  get: binding('GET'),
  post: binding('POST'),
  put: binding('PUT'),
  patch: binding('PATCH'),
  delete: binding('DELETE'),
};

export function isRestBinding(value: unknown): value is RestBinding {
  return typeof value === 'object' && value !== null && (value as { driver?: unknown }).driver === 'rest';
}
