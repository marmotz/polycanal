import { describe, expect, it } from 'vitest';
import { rest } from './binding.js';
import { restBindingEmitter } from './emitter.js';

describe('restBindingEmitter', () => {
  it('emits the binding factory call', () => {
    expect(restBindingEmitter.emit(rest.delete('/users/:id'))).toEqual({
      code: "rest.delete('/users/:id')",
      imports: [{ from: '@polycanal/rest', names: ['rest'] }],
    });
  });

  it('emits the status option', () => {
    expect(restBindingEmitter.emit(rest.post('/x', { status: 201 })).code).toBe("rest.post('/x', { status: 201 })");
    expect(restBindingEmitter.emit(rest.post('/x', { status: [200, 204] })).code).toBe(
      "rest.post('/x', { status: [200, 204] })",
    );
  });

  it('emits the body and response options next to the status', () => {
    expect(restBindingEmitter.emit(rest.post('/photos', { body: 'multipart' })).code).toBe(
      "rest.post('/photos', { body: 'multipart' })",
    );
    expect(restBindingEmitter.emit(rest.get('/photos/:id', { response: 'blob' })).code).toBe(
      "rest.get('/photos/:id', { response: 'blob' })",
    );
    expect(restBindingEmitter.emit(rest.post('/x', { status: 201, body: 'multipart', response: 'blob' })).code).toBe(
      "rest.post('/x', { status: 201, body: 'multipart', response: 'blob' })",
    );
  });

  it('escapes quotes in paths', () => {
    expect(restBindingEmitter.emit(rest.get("/it's")).code).toBe("rest.get('/it\\'s')");
  });

  it('rejects other drivers', () => {
    expect(() => restBindingEmitter.emit({ driver: 'ws', family: 'event', sources: [] })).toThrow('not a REST binding');
  });
});
