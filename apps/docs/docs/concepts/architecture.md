---
title: Architecture
---

# Architecture

```
 Description sources             Internal model            Outputs
 ┌────────────────────┐      ┌──────────────────┐      ┌─────────────────────────┐
 │ Contract in TS     │      │                  │      │ Typed client            │
 │ Decorators/markers │ ───▶│ Normalized model │ ───▶│ Generated contracts     │
 │ OpenAPI (import)   │      │ (operations,     │      │ (types + schemas)       │
 │ Introspection      │      │  schemas)        │      │                         │
 └────────────────────┘      └──────────────────┘      └─────────────────────────┘
```

## Channels

Polycanal talks about channels rather than endpoints. There are two families:

- **actions**: request/response operations, named freely after what the server exposes;
- **events**: `publish` / `subscribe` channels.

Each driver declares the family it carries: an `event()` cannot use a REST binding, which is a compile error.

## The internal model

`toModel(contract)` flattens a contract into its operations, each with an id (`households.list`), its binding, its
schemas and its input field mapping. Drivers, generators and exporters consume this model.

## Inference or generation

- A contract written in TS is used as is: types are inferred from the schemas, there is no build step.
- A contract coming from an OpenAPI document or from a server is **generated** as TypeScript with runtime schemas,
  because validation needs schemas, not only types.

## Source priority

When a server adapter discovers routes, a contract written in TS (the config) has the highest priority: discovered
operations can complete it but never change what it declares, and every disagreement is reported.

## Shared contract

The contract lives in a package or a directory shared by the back end and the front end. The front end imports the
contract, never server code. Server adapters only run during development, to generate that contract.
