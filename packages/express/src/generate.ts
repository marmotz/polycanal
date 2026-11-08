import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateContractSource } from '@polycanal/codegen';
import type { ValidationDriver } from '@polycanal/core';
import { restBindingEmitter } from '@polycanal/rest';
import { zodDriver } from '@polycanal/zod';
import { discoverExpressContract, type ExpressDiscoveryOptions, type ExpressDiscoveryReport } from './discover.js';

export interface GenerateExpressContractOptions extends ExpressDiscoveryOptions {
  /** File to write. Omitted: the source is only returned. */
  readonly output?: string;
  /** Validation library of the generated schemas. Default: Zod. */
  readonly validation?: ValidationDriver;
  /** Name of the exported contract. Default: `contract`. */
  readonly exportName?: string;
}

/** Generates the front-end contract of an Express application, typically from a development script. */
export function generateExpressContract(
  app: object,
  options: GenerateExpressContractOptions = {},
): { source: string; report: ExpressDiscoveryReport } {
  const { description, report } = discoverExpressContract(app, options);
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
