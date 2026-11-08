import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { multerFileToFile, validateMultipartFields } from './multipart.js';

describe('multerFileToFile()', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'polycanal-multer-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('wraps a file kept in memory', async () => {
    const file = await multerFileToFile({
      originalname: 'photo.png',
      mimetype: 'image/png',
      size: 3,
      buffer: Buffer.from('abc'),
    });

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('photo.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(3);
    expect(await file.text()).toBe('abc');
  });

  it('opens a file stored on disk', async () => {
    const path = join(dir, 'upload');
    await writeFile(path, 'hello disk');

    const file = await multerFileToFile({ originalname: 'notes.txt', mimetype: 'text/plain', size: 10, path });

    expect(file.name).toBe('notes.txt');
    expect(file.type).toBe('text/plain');
    expect(file.size).toBe(10);
    expect(await file.text()).toBe('hello disk');
  });

  it('passes a file schema', async () => {
    const file = await multerFileToFile({
      originalname: 'a.png',
      mimetype: 'image/png',
      size: 1,
      buffer: Buffer.from('a'),
    });

    expect(z.file().mime(['image/png']).max(10).safeParse(file).success).toBe(true);
    expect(z.file().mime(['image/jpeg']).safeParse(file).success).toBe(false);
  });

  it('rejects a file with neither buffer nor path', async () => {
    await expect(multerFileToFile({ originalname: 'x', mimetype: 'text/plain', size: 0 })).rejects.toThrow(TypeError);
  });
});

describe('validateMultipartFields()', () => {
  describe('with one schema per field', () => {
    it('keeps a text value that passes as is', async () => {
      expect(await validateMultipartFields({ zip: z.string() }, { zip: '75001' })).toEqual({ value: { zip: '75001' } });
    });

    it('falls back to the JSON value when the text fails', async () => {
      const fields = { price: z.number(), draft: z.boolean(), meta: z.object({ tags: z.array(z.string()) }) };

      expect(await validateMultipartFields(fields, { price: '12.5', draft: 'true', meta: '{"tags":["a"]}' })).toEqual({
        value: { price: 12.5, draft: true, meta: { tags: ['a'] } },
      });
    });

    it('parses each value of a repeated field', async () => {
      expect(await validateMultipartFields({ ids: z.array(z.number()) }, { ids: ['1', '2'] })).toEqual({
        value: { ids: [1, 2] },
      });
    });

    it('returns the schemas output and drops undeclared fields', async () => {
      const fields = { name: z.string().trim(), note: z.string().optional() };

      expect(await validateMultipartFields(fields, { name: ' Ada ', extra: 'x' })).toEqual({ value: { name: 'Ada' } });
    });

    it('reports issues under the field name', async () => {
      const result = await validateMultipartFields({ price: z.number(), title: z.string() }, { price: 'abc' });

      expect(result.issues?.map((issue) => issue.path)).toEqual([['price'], ['title']]);
    });

    it('reports the issues of the JSON attempt when the value parses', async () => {
      const result = await validateMultipartFields({ price: z.number().min(20) }, { price: '12.5' });

      expect(result.issues).toHaveLength(1);
      expect(result.issues?.[0]?.path).toEqual(['price']);
      expect(result.issues?.[0]?.message).toMatch(/>=\s*20/);
    });

    it('treats a missing body as empty', async () => {
      expect(await validateMultipartFields({ note: z.string().optional() }, undefined)).toEqual({ value: {} });
    });
  });

  describe('with an object schema', () => {
    const schema = z.object({ zip: z.string(), price: z.number(), tags: z.array(z.string()).optional() });

    it('falls back to JSON for the fields the issues point to', async () => {
      expect(await validateMultipartFields(schema, { zip: '75001', price: '12.5' })).toEqual({
        value: { zip: '75001', price: 12.5 },
      });
    });

    it('reports the issues when the fallback still fails', async () => {
      const result = await validateMultipartFields(schema, { zip: '75001', price: 'abc' });

      expect(result.issues?.map((issue) => issue.path)).toEqual([['price']]);
    });
  });
});
