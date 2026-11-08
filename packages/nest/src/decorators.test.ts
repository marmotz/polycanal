import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Endpoint, EndpointNamespace, endpointNamespace, endpointOptions } from './decorators.js';

const output = z.string();

class BaseController {
  @Endpoint({ output })
  list() {
    return 'list';
  }
}

@EndpointNamespace('admin')
class ChildController extends BaseController {
  @Endpoint({ name: 'details', output })
  get() {
    return 'details';
  }
}

class PlainController {
  handler() {}
}

describe('@Endpoint() and @EndpointNamespace()', () => {
  it('stores the options per handler', () => {
    expect(endpointOptions(BaseController, 'list')).toEqual({ output });
    expect(endpointOptions(ChildController, 'get')).toEqual({ name: 'details', output });
    expect(endpointOptions(PlainController, 'handler')).toBeUndefined();
  });

  it('inherits the endpoints of a parent controller without leaking child ones', () => {
    expect(endpointOptions(ChildController, 'list')).toEqual({ output });
    expect(endpointOptions(BaseController, 'get')).toBeUndefined();
  });

  it('stores the namespace of a controller', () => {
    expect(endpointNamespace(ChildController)).toEqual(['admin']);
    expect(endpointNamespace(PlainController)).toBeUndefined();
  });
});
