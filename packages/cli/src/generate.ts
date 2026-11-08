import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type ContractDescription, generateContractSource, operationId, type SchemaImport } from '@polycanal/codegen';
import { isStandardSchema, type StandardSchemaV1 } from '@polycanal/core';
import { restBindingEmitter } from '@polycanal/rest';
import { zodDriver } from '@polycanal/zod';
import type { OutputConfig, PolycanalConfig } from './config.js';

export interface GenerateOptions {
  /** Directory the output files are relative to: the directory of the configuration file. */
  readonly root: string;
  /** Writes nothing and reports the files that are not up to date. */
  readonly check?: boolean;
}

export interface GeneratedFile {
  /** Absolute path. */
  readonly path: string;
  /** Whether the file was written (or, with `check`, would be). */
  readonly changed: boolean;
}

export interface GenerateResult {
  readonly files: readonly GeneratedFile[];
  readonly warnings: readonly string[];
}

/** Failure of a generation, with a message meant for the user. */
export class GenerateError extends Error {
  override readonly name = 'GenerateError';
}

/** Generates (or checks) every output of a configuration. */
export async function generate(config: PolycanalConfig, options: GenerateOptions): Promise<GenerateResult> {
  const index = indexSchemas(config.schemaModules ?? {});
  const { description, warnings, regenerated } = await config.source.load({
    resolveSchema: (schema) => index.get(schema),
  });

  if (regenerated.length > 0 && config.allowRegenerated !== true) {
    throw new GenerateError(
      [
        `${regenerated.length} schema(s) are not exported by any module of schemaModules, so the front end could not`,
        'validate with them. Export them from a shared module, or set allowRegenerated: true to generate them from',
        'JSON Schema (transforms, refinements and custom messages are then lost):',
        ...regenerated.map((location) => `  - ${location}`),
      ].join('\n'),
    );
  }

  const files = config.outputs.map((output) => {
    const path = resolve(options.root, output.file);
    const source = generateContractSource(filter(description, output), {
      validation: config.validation ?? zodDriver,
      bindings: [restBindingEmitter, ...(config.bindings ?? [])],
      ...(output.exportName === undefined ? {} : { exportName: output.exportName }),
    });
    const changed = !existsSync(path) || readFileSync(path, 'utf8') !== source;

    if (changed && options.check !== true) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }

    return { path, changed };
  });

  return {
    files,
    warnings: [...warnings, ...regenerated.map((location) => `${location}: generated from JSON Schema`)],
  };
}

/** Runtime schemas exported by the modules, by identity. The first export of a schema gives its name. */
function indexSchemas(modules: NonNullable<PolycanalConfig['schemaModules']>): Map<StandardSchemaV1, SchemaImport> {
  const index = new Map<StandardSchemaV1, SchemaImport>();

  for (const [from, exports] of Object.entries(modules)) {
    for (const [name, value] of Object.entries(exports)) {
      if (name !== 'default' && isStandardSchema(value) && !index.has(value)) {
        index.set(value, { from, name });
      }
    }
  }

  return index;
}

function filter(description: ContractDescription, output: OutputConfig): ContractDescription {
  const include = output.include;

  if (include === undefined) {
    return description;
  }

  const operations = description.operations.filter((operation) => {
    const id = operationId(operation);

    return include.some((prefix) => id === prefix || id.startsWith(`${prefix}.`));
  });

  if (operations.length === 0) {
    throw new GenerateError(`${output.file}: no operation matches include ${JSON.stringify(include)}`);
  }

  return { ...description, operations };
}
