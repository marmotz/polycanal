import { type StandardSchemaV1, validateJsonResponse } from '@polycanal/core';

/** A response that does not match its schema. */
export interface InvalidResponse {
  /** `METHOD /path` of the route. */
  readonly route: string;
  readonly issues: readonly StandardSchemaV1.Issue[];
  /** The value given to `res.json()`. */
  readonly value: unknown;
}

export interface ResponseValidationOptions {
  /**
   * What happens to a response that does not match its schema:
   * - `'throw'` (default): it is logged and replaced by a 500 error, so that tests and development catch it;
   * - `'log'`: it is logged and sent anyway, for production;
   * - a function: called with the failure, then the response is sent.
   */
  readonly onInvalid?: 'throw' | 'log' | ((failure: InvalidResponse) => void);
}

const SETTING = 'polycanal response validation';

interface AppLike {
  set(setting: string, value: unknown): unknown;
  get(setting: string): unknown;
}

/** What `endpoint()` reads of an Express request and response. */
export interface RequestLike {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly route?: { readonly path?: unknown };
  readonly app?: AppLike;
}

export interface ResponseLike {
  json(body: unknown): unknown;
  status(code: number): unknown;
}

/**
 * Validates what every `endpoint()` route answers with `res.json()` against its response schema, before it leaves.
 * Call it once on the application, before the routes are hit.
 *
 * @example
 * validateResponses(app, { onInvalid: process.env.NODE_ENV === 'production' ? 'log' : 'throw' });
 */
export function validateResponses(app: AppLike, options: ResponseValidationOptions = {}): void {
  app.set(SETTING, options);
}

/** Wraps `res.json()` of a route when the application validates its responses. */
export function checkResponses(schema: StandardSchemaV1, request: RequestLike, response: ResponseLike): void {
  const options = request.app?.get(SETTING) as ResponseValidationOptions | undefined;

  if (options === undefined) {
    return;
  }

  const send = response.json.bind(response);
  const route = `${request.method ?? ''} ${String(request.route?.path ?? request.originalUrl ?? '')}`.trim();

  response.json = (body: unknown) => {
    validateJsonResponse(schema, body).then(
      (result) => {
        if (!result.issues) {
          send(body);

          return;
        }

        const { onInvalid = 'throw' } = options;

        if (typeof onInvalid === 'function') {
          onInvalid({ route, issues: result.issues, value: body });
          send(body);

          return;
        }

        console.error(`[polycanal] ${route} answered a response that does not match its schema`, result.issues);

        if (onInvalid === 'throw') {
          response.status(500);
          send({ message: 'The response does not match its schema' });
        } else {
          send(body);
        }
      },
      (cause: unknown) => {
        console.error(`[polycanal] ${route}: the response could not be validated`, cause);
        response.status(500);
        send({ message: 'The response could not be validated' });
      },
    );

    return response;
  };
}
