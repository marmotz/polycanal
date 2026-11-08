import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type ContractSource, describeSchema, importedSchema } from '@polycanal/codegen';
import { rest } from '@polycanal/rest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HouseholdSchema, RenameSchema } from './__fixtures__/schemas.js';
import { run } from './cli.js';
import { defineConfig } from './config.js';
import { GenerateError, generate } from './generate.js';

const root = fileURLToPath(new URL('../.test-output/', import.meta.url));

afterEach(() => rmSync(root, { recursive: true, force: true }));

const LocalSchema = z.object({ ok: z.boolean() });

/** A source describing two operations with runtime schemas, as a server adapter would. */
function source(output: z.ZodType = HouseholdSchema): ContractSource {
  return {
    name: 'test',
    async load({ resolveSchema }) {
      const regenerated: string[] = [];
      const describe = (schema: z.ZodType, location: string) => {
        const json = describeSchema(schema, 'input', location);
        const ref = resolveSchema(schema);
        if (ref === undefined) regenerated.push(location);
        return ref === undefined ? json : importedSchema(json, ref);
      };

      return {
        description: {
          operations: [
            {
              family: 'action',
              path: ['households', 'rename'],
              binding: rest.patch('/households/:id'),
              input: {
                kind: 'fields',
                fields: [
                  { name: 'id', schema: { type: 'string' }, required: true, source: 'path' },
                  {
                    name: 'body',
                    schema: describe(RenameSchema, 'rename body'),
                    required: true,
                    source: 'body',
                    root: true,
                  },
                ],
              },
              output: describe(output, 'rename output'),
            },
            { family: 'action', path: ['health'], binding: rest.get('/health'), output: { type: 'object' } },
          ],
        },
        warnings: ['GET /legacy skipped: no response schema'],
        regenerated,
      };
    },
  };
}

const shared = { RenameSchema, HouseholdSchema, notASchema: 1 };

describe('generate()', () => {
  it('writes each output, importing the schemas of schemaModules', async () => {
    const config = defineConfig({
      source: source(),
      schemaModules: { '@app/shared': shared },
      outputs: [{ file: 'web/contract.generated.ts' }],
    });

    const { files, warnings } = await generate(config, { root });

    expect(files).toEqual([{ path: `${root}web/contract.generated.ts`, changed: true }]);
    expect(warnings).toEqual(['GET /legacy skipped: no response schema']);
    const written = readFileSync(`${root}web/contract.generated.ts`, 'utf8');
    expect(written).toContain("import { HouseholdSchema, RenameSchema } from '@app/shared';");
    expect(written).toContain("body: { source: 'body', root: true, schema: RenameSchema },");

    expect((await generate(config, { root })).files[0]?.changed).toBe(false);
  });

  it('reports outdated files without writing them in check mode', async () => {
    const config = defineConfig({
      source: source(),
      schemaModules: { '@app/shared': shared },
      outputs: [{ file: 'contract.ts' }],
    });

    expect((await generate(config, { root, check: true })).files[0]?.changed).toBe(true);
    expect(existsSync(`${root}contract.ts`)).toBe(false);

    await generate(config, { root });
    expect((await generate(config, { root, check: true })).files[0]?.changed).toBe(false);
  });

  it('refuses schemas no module exports, unless allowRegenerated', async () => {
    const config = {
      source: source(LocalSchema),
      schemaModules: { '@app/shared': shared },
      outputs: [{ file: 'c.ts' }],
    };

    await expect(generate(config, { root })).rejects.toThrow(GenerateError);
    await expect(generate(config, { root })).rejects.toThrow(/- rename output/);

    const { warnings } = await generate({ ...config, allowRegenerated: true }, { root });
    expect(warnings).toContain('rename output: generated from JSON Schema');
    expect(readFileSync(`${root}c.ts`, 'utf8')).toContain('output: z.object({');
  });

  it('splits operations between outputs with include', async () => {
    const config = defineConfig({
      source: source(),
      schemaModules: { '@app/shared': shared },
      outputs: [
        { file: 'households.ts', include: ['households'], exportName: 'households' },
        { file: 'health.ts', include: ['health'] },
      ],
    });

    await generate(config, { root });

    expect(readFileSync(`${root}households.ts`, 'utf8')).toContain('export const households = defineContract({');
    expect(readFileSync(`${root}households.ts`, 'utf8')).not.toContain('health');
    expect(readFileSync(`${root}health.ts`, 'utf8')).not.toContain('households');
    await expect(
      generate({ ...config, outputs: [{ file: 'none.ts', include: ['nothing'] }] }, { root }),
    ).rejects.toThrow(/no operation matches/);
  });
});

describe('polycanal generate', () => {
  function writeConfig(file = 'polycanal.config.ts') {
    mkdirSync(root, { recursive: true });
    const fixtures = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
    writeFileSync(
      `${root}${file}`,
      [
        `import { HouseholdSchema, RenameSchema } from '${fixtures}schemas.ts';`,
        `import { defineConfig } from '${fileURLToPath(new URL('./config.ts', import.meta.url))}';`,
        `import { fakeSource } from '${fixtures}fake-source.ts';`,
        'export default defineConfig({',
        '  source: fakeSource(),',
        "  schemaModules: { '@app/shared': { HouseholdSchema, RenameSchema } },",
        "  outputs: [{ file: 'out/contract.ts' }],",
        '});',
      ].join('\n'),
    );
  }

  it('generates from the configuration of the current directory, then checks it', async () => {
    writeConfig();
    const log = vi.fn();

    expect(await run(['generate', '--check'], log, root)).toBe(1);
    expect(log).toHaveBeenLastCalledWith('outdated: out/contract.ts');

    expect(await run(['generate'], log, root)).toBe(0);
    expect(log).toHaveBeenLastCalledWith('written: out/contract.ts');

    expect(await run(['generate', '--check'], log, root)).toBe(0);
    expect(log).toHaveBeenLastCalledWith('up to date: out/contract.ts');
  });

  it('takes an explicit configuration file', async () => {
    writeConfig('other.config.ts');
    const log = vi.fn();

    expect(await run(['generate', '--config', 'other.config.ts'], log, root)).toBe(0);
    expect(existsSync(`${root}out/contract.ts`)).toBe(true);
  });

  it.each([[[]], [['build']], [['generate', '--watch']], [['generate', '--config']]])(
    'prints the usage for %j',
    async (args) => {
      const log = vi.fn();
      expect(await run(args, log, root)).toBe(1);
      expect(log.mock.calls[0]?.[0]).toMatch(/^Usage: polycanal generate/);
    },
  );

  it('fails without configuration file', async () => {
    mkdirSync(root, { recursive: true });
    const log = vi.fn();
    expect(await run(['generate'], log, root)).toBe(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/no configuration file/);
  });
});
