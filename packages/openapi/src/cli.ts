import { readFileSync, writeFileSync } from 'node:fs';
import { generateFromOpenApi } from './generate.js';

const USAGE = 'Usage: polycanal-openapi <openapi.json> <output.ts> [--export <name>]';

/** Command line entry point. Returns the exit code. */
export function run(args: readonly string[], log: (message: string) => void = console.error): number {
  const exportIndex = args.indexOf('--export');
  const exportName = exportIndex === -1 ? undefined : args[exportIndex + 1];
  const positional = args.filter((_, index) => index !== exportIndex && index !== exportIndex + 1);
  const [input, output] = positional;

  if (input === undefined || output === undefined || (exportIndex !== -1 && exportName === undefined)) {
    log(USAGE);

    return 1;
  }

  const document = JSON.parse(readFileSync(input, 'utf8'));
  const { source, warnings } = generateFromOpenApi(document, exportName === undefined ? {} : { exportName });

  for (const warning of warnings) {
    log(`warning: ${warning}`);
  }

  writeFileSync(output, source);
  log(`polycanal-openapi: wrote ${output}`);

  return 0;
}
