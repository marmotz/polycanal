import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import { generateContractSource } from '@polycanal/codegen';
import type { ValidationDriver } from '@polycanal/core';
import { restBindingEmitter } from '@polycanal/rest';
import { zodDriver } from '@polycanal/zod';
import { discoverNestContract, type NestDiscoveryOptions, type NestDiscoveryReport } from './discover.js';

export interface GenerateNestContractOptions extends NestDiscoveryOptions {
  /** File to write. Omitted: the source is only returned. */
  readonly output?: string;
  /** Validation library of the generated schemas. Default: Zod. */
  readonly validation?: ValidationDriver;
  /** Name of the exported contract. Default: `contract`. */
  readonly exportName?: string;
}

/**
 * Generates the front-end contract of a Nest application: discovery, merge with the config, then TypeScript source
 * (Zod schemas by default). Typically run from a script during development:
 *
 * @example
 * const app = await NestFactory.create(AppModule, { logger: false });
 * const { report } = generateNestContract(app, { output: '../shared/src/contract.generated.ts' });
 * await app.close();
 */
export function generateNestContract(
  app: INestApplicationContext,
  options: GenerateNestContractOptions = {},
): { source: string; report: NestDiscoveryReport } {
  const { description, report } = discoverNestContract(app, options);
  const source = generateContractSource(description, {
    validation: options.validation ?? zodDriver,
    bindings: [restBindingEmitter],
    ...(options.exportName === undefined ? {} : { exportName: options.exportName }),
  });

  if (options.output !== undefined) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, source);
  }

  return { source, report };
}
