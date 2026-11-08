/**
 * Route discovery by walking the Express router stack (spec §7). Express has no public API for it: this relies on
 * internal structures, covered by tests for Express 4 and 5.
 *
 * - Express 4: `app._router.stack`; the mount path of a sub-router is rebuilt from its regular expression.
 * - Express 5: `app.router.stack`; mount paths are not kept, so `recordMountPaths(express)` must run before routers are
 *   mounted.
 */

const MOUNT_PATH = Symbol.for('polycanal.express.mountPath');

interface Layer {
  readonly name?: string;
  readonly handle?: { readonly stack?: readonly Layer[] } & ((...args: never[]) => unknown);
  readonly route?: {
    readonly path: unknown;
    readonly methods?: Readonly<Record<string, boolean>>;
    readonly stack?: readonly Layer[];
  };
  readonly regexp?: RegExp & { readonly fast_slash?: boolean };
  readonly keys?: readonly { readonly name: string | number }[];
  readonly [MOUNT_PATH]?: string;
}

/** A route found in the router stack. */
export interface ExpressRoute {
  /** Upper-case HTTP method. */
  readonly method: string;
  /** Full path, `undefined` when it could not be determined (pattern route, unknown mount path). */
  readonly path: string | undefined;
  /** Handlers of the route, `endpoint()` markers included. */
  readonly handlers: readonly unknown[];
  /** Why the path is unknown. */
  readonly problem?: string;
}

/**
 * Makes Express remember the mount path of every middleware and router mounted afterwards (needed by Express 5, used
 * by Express 4 too). Call it once, before building the application.
 */
export function recordMountPaths(express: { Router: (...args: never[]) => unknown }): void {
  // Express 4 routers inherit `use` from a plain object, Express 5 ones from `Router.prototype` through an instance
  let proto = Object.getPrototypeOf(express.Router()) as { use: (...args: unknown[]) => unknown } | null;

  while (proto !== null && !Object.hasOwn(proto, 'use')) {
    proto = Object.getPrototypeOf(proto);
  }

  if (proto === null) {
    throw new TypeError('recordMountPaths: unsupported Express version (no Router use())');
  }

  if ((proto.use as { [MOUNT_PATH]?: true })[MOUNT_PATH]) {
    return;
  }

  const use = proto.use;
  const recording = function (this: { stack: Layer[] }, ...args: unknown[]) {
    const before = this.stack.length;
    const result = use.apply(this, args);
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const path = typeof first === 'string' ? first : typeof first === 'function' ? '/' : undefined;

    if (path !== undefined) {
      for (const layer of this.stack.slice(before)) {
        (layer as { [MOUNT_PATH]?: string })[MOUNT_PATH] = path;
      }
    }

    return result;
  };
  (recording as unknown as { [MOUNT_PATH]: true })[MOUNT_PATH] = true;
  proto.use = recording;
}

/** Lists the routes of an Express 4 or 5 application. */
export function listRoutes(app: object): ExpressRoute[] {
  const routes: ExpressRoute[] = [];
  walk(routerStack(app), '', undefined, routes);

  return routes;
}

function routerStack(app: object): readonly Layer[] {
  // Express 4 (recognized by `lazyrouter`) throws when `app.router` is read, and creates `_router` lazily
  if (typeof (app as { lazyrouter?: unknown }).lazyrouter === 'function') {
    return (app as { _router?: { stack: Layer[] } })._router?.stack ?? [];
  }

  const v5 = (app as { router?: { stack?: Layer[] } }).router;

  return v5?.stack ?? [];
}

function walk(stack: readonly Layer[], prefix: string, problem: string | undefined, routes: ExpressRoute[]): void {
  for (const layer of stack) {
    if (layer.route !== undefined) {
      const routePath = typeof layer.route.path === 'string' ? layer.route.path : undefined;
      const routeProblem =
        problem ?? (routePath === undefined ? 'pattern or multiple paths are not supported' : undefined);

      for (const method of Object.keys(layer.route.methods ?? {}).filter((name) => name !== '_all')) {
        routes.push({
          method: method.toUpperCase(),
          path: routeProblem === undefined ? join(prefix, routePath ?? '') : undefined,
          handlers: (layer.route.stack ?? []).map((inner) => inner.handle),
          ...(routeProblem === undefined ? {} : { problem: routeProblem }),
        });
      }

      continue;
    }

    const inner = layer.handle?.stack;

    if (inner === undefined) {
      continue;
    }

    const mount = mountPath(layer);
    walk(
      inner,
      mount === undefined ? prefix : join(prefix, mount),
      problem ??
        (mount === undefined
          ? 'mount path unknown: call recordMountPaths(express) before mounting routers'
          : undefined),
      routes,
    );
  }
}

function mountPath(layer: Layer): string | undefined {
  const recorded = layer[MOUNT_PATH];

  if (recorded !== undefined) {
    return recorded;
  }

  return layer.regexp === undefined ? undefined : pathFromRegexp(layer.regexp, layer.keys ?? []);
}

/** Rebuilds the mount path of an Express 4 layer from its regular expression (path-to-regexp 0.1). */
export function pathFromRegexp(
  regexp: RegExp & { readonly fast_slash?: boolean },
  keys: readonly { readonly name: string | number }[],
): string | undefined {
  if (regexp.fast_slash) {
    return '';
  }

  // `^\/api\/households(?:\/([^\/]+?))\/?(?=\/|$)`: escaped literals, parameter groups, then the mount suffix
  const params: string[] = [];
  const source = regexp.source.replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\(\?:\\\/\(\[\^\\?\/\]\+\?\)\)/g, () => {
    params.push(String(keys[params.length]?.name ?? ''));

    return '\0';
  });
  const literal = /^\^((?:\\[.*+?^${}()|[\]\\/]|[^.*+?^${}()|[\]\\/])*)$/.exec(source);

  if (literal === null || params.length !== keys.length) {
    return undefined;
  }

  let index = 0;

  return (literal[1] ?? '').replace(/\\(.)/g, '$1').replace(/\0/g, () => `/:${params[index++]}`);
}

function join(...parts: string[]): string {
  const joined = parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment !== '')
    .join('/');

  return `/${joined}`;
}
