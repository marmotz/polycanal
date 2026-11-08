---
slug: /
title: Introduction
sidebar_position: 1
---

# Polycanal

**Polycanal** is a TypeScript library that sits between a server and a front end. It **describes** what an existing
server exposes, and gives the front end a **typed client** where every argument and every response is **validated**:

```ts
const user = await server.auth.login({ email: 'ada@example.com', password: '...' }); // POST /auth/login
```

:::caution Work in progress

Polycanal is not released yet. This documentation follows the `develop` branch (version **next**).

:::

## Why

Typed clients usually come with a server framework: tRPC, oRPC or ts-rest require the server to be written with their
router or to implement their contract. They cannot be put in front of a back end that already exists. Polycanal takes
the opposite approach:

- **The server stays free.** Polycanal describes the REST endpoints the server already has. It never dictates how the
  server is written, and requests stay plain REST and JSON, readable in the browser's Network tab.
- **Everything is validated.** Parameters are validated before sending, responses on receipt. Schemas come from any
  [Standard Schema](https://standardschema.dev/) library (Zod, Valibot, ArkType...).
- **Progressive adoption.** Describe one endpoint, use it, and leave the others untouched.
- **Framework agnostic.** The client is plain TypeScript: it returns Promises and sends requests with `fetch`, so it
  works as is with React, Vue, Svelte, Solid, Angular or vanilla JavaScript, in the browser as well as in Node or Bun.
  Angular also gets an [optional integration](./guides/angular.md) that goes through `HttpClient`, to keep your
  interceptors.

## How

1. **Describe** the endpoints in a contract, written by hand with `defineContract()`, generated from an OpenAPI
   document, or discovered from a NestJS or Express application.
2. **Create a client** from the contract with a transport driver: `fetch` everywhere, or any HTTP client
   you plug in (Angular's `HttpClient` is provided).
3. **Call** `server.namespace.operation(input)`: typed, validated, and returning the validated response.

Continue with the [installation](./getting-started/installation.md) and
the [quick start](./getting-started/quick-start.md).
