import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PolycanalConfig } from './config.js';
import { GenerateError, generate } from './generate.js';

const USAGE = `Usage: polycanal generate [--config <file>] [--check]

  --config <file>  Configuration file. Default: polycanal.config.{ts,mts,js,mjs} in the current directory
  --check          Writes nothing; fails when a generated file is not up to date (for CI)`;

const CONFIG_FILES = ['polycanal.config.ts', 'polycanal.config.mts', 'polycanal.config.js', 'polycanal.config.mjs'];

/** Command line entry point. Returns the exit code. */
export async function run(
  args: readonly string[],
  log: (message: string) => void = console.error,
  cwd: string = process.cwd(),
): Promise<number> {
  const [command, ...rest] = args;
  const configIndex = rest.indexOf('--config');
  const configArg = configIndex === -1 ? undefined : rest[configIndex + 1];
  const check = rest.includes('--check');
  const consumed = configIndex === -1 ? [] : [configIndex, configIndex + 1];
  const unknown = rest.filter((arg, index) => arg !== '--check' && !consumed.includes(index));

  if (command !== 'generate' || unknown.length > 0 || (configIndex !== -1 && configArg === undefined)) {
    log(USAGE);

    return 1;
  }

  const configPath =
    configArg === undefined
      ? CONFIG_FILES.map((file) => resolve(cwd, file)).find((file) => existsSync(file))
      : resolve(cwd, configArg);

  if (configPath === undefined || !existsSync(configPath)) {
    log(`polycanal: no configuration file (${configArg ?? CONFIG_FILES.join(', ')})`);

    return 1;
  }

  try {
    const config = ((await import(pathToFileURL(configPath).href)) as { default?: PolycanalConfig }).default;

    if (config === undefined) {
      throw new GenerateError(`${configPath}: no default export (export default defineConfig({ ... }))`);
    }

    const { files, warnings } = await generate(config, { root: dirname(configPath), check });

    for (const warning of warnings) {
      log(`warning: ${warning}`);
    }

    for (const { path, changed } of files) {
      const name = relative(cwd, path);
      log(check ? `${changed ? 'outdated' : 'up to date'}: ${name}` : `${changed ? 'written' : 'unchanged'}: ${name}`);
    }

    return check && files.some(({ changed }) => changed) ? 1 : 0;
  } catch (error) {
    if (error instanceof GenerateError) {
      log(`polycanal: ${error.message}`);

      return 1;
    }

    throw error;
  }
}
