---
title: Interceptors
---

# Interceptors

There is no authentication abstraction: interceptors cover it, along with headers, retries, error normalization and
response transforms. An interceptor wraps the sending of the native request:

```ts
type Interceptor<TRequest, TResponse> = (
  request: TRequest,
  next: (request: TRequest) => Promise<TResponse>,
  context: InterceptorContext, // { call, driver }
) => Promise<TResponse>;
```

For the REST drivers, the request is an `HttpRequest` (`method`, `url`, `headers`, `body`) and the response an
`HttpResponse` (`status`, `headers`, `text`, decoded `body`).

## Levels and order

From outermost to innermost:

1. `createClient(contract, { interceptors })`: every call;
2. the driver's `interceptors` (`fetchRest({ interceptors })`): every call carried by that driver;
3. `createClient(contract, { operations: { 'households': { interceptors } } })`: an operation id or a namespace prefix,
   shorter prefixes first;
4. the call's `{ interceptors }`.

Global and per-operation interceptors see every driver, so their request type is not narrowed; driver and per-call
interceptors are typed with the driver's request and response.

## Injecting a token

```ts
import { type HttpRequest, type HttpResponse, withHeaders } from '@polycanal/rest';
import type { Interceptor } from '@polycanal/core';

const bearer: Interceptor<HttpRequest, HttpResponse> = (request, next) =>
  next(withHeaders(request, { Authorization: `Bearer ${tokens.access}` }));
```

## Refreshing a token and replaying

Calling `next` again sends the request again. An interceptor can also call the client itself:

```ts
const refresh: Interceptor<HttpRequest, HttpResponse> = async (request, next) => {
  const response = await next(withHeaders(request, { Authorization: `Bearer ${tokens.access}` }));

  if (response.status !== 401) {
    return response;
  }

  tokens = await server.auth.refresh({ refreshToken: tokens.refresh });

  return next(withHeaders(request, { Authorization: `Bearer ${tokens.access}` }));
};
```

Do not put the refresh call itself behind this interceptor, or a failed refresh loops: register the interceptor per
operation, or skip it based on `context.call.operation.id`.

## Transforming a response

```ts
const unwrap: Interceptor<HttpRequest, HttpResponse> = async (request, next) => {
  const response = await next(request);

  return { ...response, body: (response.body as { data: unknown }).data }; // the output schema sees `data`
};
```

## Errors

Errors thrown by the driver reach interceptors as `PolycanalError`s of kind `transport`. Errors thrown by an interceptor
propagate unchanged, so an interceptor can normalize errors into the application's own types.
