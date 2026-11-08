import { describe, it } from 'vitest';
import { z } from 'zod';
import { Endpoint } from './decorators.js';

const Note = z.object({ title: z.string(), createdAt: z.string(), tags: z.array(z.string()).default([]) });

describe('@Endpoint() return type', () => {
  it('accepts a handler returning the input type of the response schema', () => {
    class Controller {
      @Endpoint({ output: Note })
      get() {
        return { title: 'a', createdAt: '2026-11-08' };
      }

      @Endpoint({ output: Note })
      async load() {
        return { title: 'a', createdAt: new Date(), tags: ['t'] }; // a Date is sent as its ISO string
      }

      @Endpoint({ output: z.void() })
      remove() {}

      @Endpoint()
      free() {
        return 42;
      }
    }

    void Controller;
  });

  it('refuses a handler that does not match the response schema', () => {
    class Controller {
      // @ts-expect-error title is missing
      @Endpoint({ output: Note })
      get() {
        return { createdAt: '2026-11-08' };
      }

      // @ts-expect-error a number is not a string
      @Endpoint({ output: Note })
      async load() {
        return { title: 1, createdAt: '2026-11-08' };
      }

      // @ts-expect-error nothing is returned
      @Endpoint({ output: z.object({ id: z.number() }) })
      create() {}

      // @ts-expect-error a Date is only accepted where JSON carries a string
      @Endpoint({ output: z.object({ count: z.number() }) })
      count() {
        return { count: new Date() };
      }
    }

    void Controller;
  });
});
