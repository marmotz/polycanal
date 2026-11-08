import {
  type CallHandler,
  type ExecutionContext,
  InternalServerErrorException,
  Logger,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { type StandardSchemaV1, validateJsonResponse } from '@polycanal/core';
import { from, mergeMap, type Observable } from 'rxjs';
import { endpointOptions } from './decorators.js';

type Constructor = abstract new (...args: never[]) => unknown;

/** A response that does not match its schema. */
export interface InvalidResponse {
  /** `Controller.handler`. */
  readonly route: string;
  readonly issues: readonly StandardSchemaV1.Issue[];
  /** The value the handler returned. */
  readonly value: unknown;
}

export interface EndpointOutputOptions {
  /**
   * What happens to a response that does not match its schema:
   * - `'throw'` (default): it is logged and replaced by a 500 error, so that tests and development catch it;
   * - `'log'`: it is logged and sent anyway, for production;
   * - a function: called with the failure; what it throws replaces the response, otherwise the response is sent.
   */
  readonly onInvalid?: 'throw' | 'log' | ((failure: InvalidResponse) => void);
  /** Finds the response schema of a handler without `@Endpoint({ output })`, like the discovery option. */
  readonly outputOf?: (controller: Constructor, handler: string) => StandardSchemaV1 | undefined;
}

/**
 * Nest interceptor validating what each `@Endpoint()` handler answers against its response schema, before it leaves.
 * Register it once for the whole application.
 *
 * @example
 * app.useGlobalInterceptors(
 *   new EndpointOutputInterceptor({ onInvalid: process.env.NODE_ENV === 'production' ? 'log' : 'throw' }),
 * );
 */
export class EndpointOutputInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Polycanal');

  constructor(private readonly options: EndpointOutputOptions = {}) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const controller = context.getClass() as Constructor;
    const handler = context.getHandler().name;
    const schema = endpointOptions(controller, handler)?.output ?? this.options.outputOf?.(controller, handler);

    if (schema === undefined) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<{ headersSent?: boolean }>();

    return next
      .handle()
      .pipe(mergeMap((value) => from(this.check(schema, value, `${controller.name}.${handler}`, response))));
  }

  private async check(
    schema: StandardSchemaV1,
    value: unknown,
    route: string,
    response: { headersSent?: boolean },
  ): Promise<unknown> {
    // A handler that answered by itself (@Res() without passthrough) or streams a file has no JSON value to check
    if (response.headersSent === true || value instanceof StreamableFile) {
      return value;
    }

    const result = await validateJsonResponse(schema, value);

    if (!result.issues) {
      return value;
    }

    const failure: InvalidResponse = { route, issues: result.issues, value };
    const { onInvalid = 'throw' } = this.options;

    if (typeof onInvalid === 'function') {
      onInvalid(failure);

      return value;
    }

    this.logger.error(`${route} answered a response that does not match its schema: ${describe(result.issues)}`);

    if (onInvalid === 'throw') {
      throw new InternalServerErrorException('The response does not match its schema');
    }

    return value;
  }
}

function describe(issues: readonly StandardSchemaV1.Issue[]): string {
  return issues
    .map(({ path, message }) => {
      const at = (path ?? []).map((segment) => String(typeof segment === 'object' ? segment.key : segment)).join('.');

      return at === '' ? message : `${at}: ${message}`;
    })
    .join('; ');
}
