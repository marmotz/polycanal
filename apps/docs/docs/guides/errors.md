---
title: Errors
---

# Errors

Every failed call throws a `PolycanalError` carrying structured data:

| Property    | Content                                                                                   |
|-------------|-------------------------------------------------------------------------------------------|
| `kind`      | `input`, `output`, `server` or `transport` (below)                                        |
| `operation` | Operation id, e.g. `households.list`                                                      |
| `driver`    | Driver name, e.g. `rest`                                                                  |
| `key`       | Error key for `server` errors: the HTTP status as a string for REST                       |
| `data`      | Error body, validated with the matching `errors` schema when the action declares one      |
| `issues`    | Standard Schema validation issues (`message`, `path`)                                     |
| `response`  | Native response, when there is one                                                        |
| `cause`     | Underlying error (network failure, decoding error...)                                     |

| Kind        | Meaning                                                                                       |
|-------------|-----------------------------------------------------------------------------------------------|
| `input`     | The argument (or a published message) does not match its schema. Nothing was sent            |
| `output`    | The response (or a received message) does not match its schema                                |
| `server`    | The server answered with an error status. `data` has the body; `issues` is set when it does not match the declared error schema |
| `transport` | The call could not be carried: network failure, abort, undecodable body, missing driver       |

```ts
import { isPolycanalError } from '@polycanal/core';

try {
  await server.auth.login(credentials);
} catch (error) {
  if (isPolycanalError(error, { kind: 'server', key: 401 })) {
    showMessage((error.data as { message: string }).message);
  } else {
    throw error;
  }
}
```

## Contract errors

A malformed contract throws a `ContractDefinitionError` as soon as it is defined, with a `path` locating the faulty
element (`['households', 'list']`) and a `reason`.
