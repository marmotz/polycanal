import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { actionResource } from './resource.js';

async function settle() {
  TestBed.tick();
  await TestBed.inject(ApplicationRef).whenStable();
}

describe('actionResource()', () => {
  it('calls an action without input once', async () => {
    const list = vi.fn(async (_input: undefined, _options?: { signal?: AbortSignal }) => ['h1']);
    const households = TestBed.runInInjectionContext(() => actionResource(list));

    await settle();

    expect(households.value()).toEqual(['h1']);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]?.[0]).toBeUndefined();
    expect(list.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reloads when the params change and stays idle on undefined', async () => {
    const page = signal<number | undefined>(undefined);
    const analyses = vi.fn(async (input: { page: number }) => input.page * 10);
    const resource = TestBed.runInInjectionContext(() =>
      actionResource(analyses, {
        params: () => (page() === undefined ? undefined : { page: page() as number }),
        defaultValue: 0,
      }),
    );

    await settle();
    expect(resource.status()).toBe('idle');
    expect(resource.value()).toBe(0);

    page.set(2);
    await settle();
    expect(resource.value()).toBe(20);

    page.set(3);
    await settle();
    expect(resource.value()).toBe(30);
    expect(analyses.mock.calls.map(([input]) => input)).toEqual([{ page: 2 }, { page: 3 }]);
  });

  it('exposes action failures as the resource error', async () => {
    const failing = vi.fn(async () => {
      throw new Error('server down');
    });
    const resource = TestBed.runInInjectionContext(() => actionResource(failing));

    await settle();

    expect(resource.status()).toBe('error');
    expect(resource.error()?.message).toBe('server down');
  });
});
