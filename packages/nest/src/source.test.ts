import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { schemaImportOf } from '@polycanal/codegen';
import { describe, expect, it, vi } from 'vitest';
import { AuthController, LoginResponseSchema } from './__fixtures__/app.js';
import { nestSource } from './source.js';

describe('nestSource()', () => {
  it('describes the application it creates, with the schemas resolved, then closes it', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [AuthController] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    const close = vi.spyOn(app, 'close');

    const result = await nestSource({ app: () => app }).load({
      resolveSchema: (schema) => (schema === LoginResponseSchema ? { from: '@app/shared', name: 'Login' } : undefined),
    });

    const login = result.description.operations[0];
    expect(login?.family === 'action' && schemaImportOf(login.output)).toEqual({ from: '@app/shared', name: 'Login' });
    expect(result.regenerated).toEqual(['POST /auth/login body', 'POST /auth/login error 401']);
    expect(close).toHaveBeenCalled();
  });
});
