import { type Injector, type ResourceRef, resource } from '@angular/core';

/** Client method of an action, as built by `createClient()`. */
export type ActionFn<TInput, TOutput> = (
  input: TInput,
  options?: { readonly signal?: AbortSignal },
) => Promise<TOutput>;

export interface ActionResourceOptions<TInput, TOutput> {
  /**
   * Reactive input of the action. Returning `undefined` keeps the resource idle. Omitted: the action is called once,
   * without input.
   */
  readonly params?: () => TInput | undefined;
  readonly defaultValue?: TOutput;
  readonly injector?: Injector;
}

const NO_INPUT = { none: true } as const;

/**
 * Exposes an action as an Angular `resource()`: reloaded when its params change, aborted when replaced or destroyed.
 * Intended for read operations.
 *
 * @example
 * readonly households = actionResource(this.server.households.list);
 * readonly analyses = actionResource(this.server.projects.analyses, { params: () => ({ id: this.id(), page: this.page() }) });
 */
export function actionResource<TInput, TOutput>(
  action: ActionFn<TInput, TOutput>,
  options: ActionResourceOptions<NoInfer<TInput>, NoInfer<TOutput>> & { readonly defaultValue: NoInfer<TOutput> },
): ResourceRef<TOutput>;
export function actionResource<TInput, TOutput>(
  action: ActionFn<TInput, TOutput>,
  options?: ActionResourceOptions<NoInfer<TInput>, NoInfer<TOutput>>,
): ResourceRef<TOutput | undefined>;
export function actionResource<TInput, TOutput>(
  action: ActionFn<TInput, TOutput>,
  options: ActionResourceOptions<TInput, TOutput> = {},
): ResourceRef<TOutput | undefined> {
  const params = options.params;

  return resource<TOutput | undefined, TInput | typeof NO_INPUT | undefined>({
    params: params === undefined ? () => NO_INPUT : () => params(),
    loader: ({ params: value, abortSignal }) =>
      action((value === NO_INPUT ? undefined : value) as TInput, { signal: abortSignal }),
    ...(options.defaultValue === undefined ? {} : { defaultValue: options.defaultValue }),
    ...(options.injector === undefined ? {} : { injector: options.injector }),
  });
}
