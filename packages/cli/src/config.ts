import type { ContractSource } from '@polycanal/codegen';
import type { BindingEmitter, ValidationDriver } from '@polycanal/core';

/** A generated contract file. */
export interface OutputConfig {
  /** File to write, relative to the configuration file. */
  readonly file: string;
  /** Name of the exported contract. Default: `contract`. */
  readonly exportName?: string;
  /**
   * Operations to keep, by id or namespace prefix (`['auth', 'listings.query']`). Default: every operation. Several
   * outputs give several contracts, e.g. one per front-end application.
   */
  readonly include?: readonly string[];
}

export interface PolycanalConfig {
  /** Where the contract comes from, e.g. `nestSource({ app })` from `@polycanal/nest`. */
  readonly source: ContractSource;
  /**
   * Modules the generated files import runtime schemas from, by the specifier the front end imports them with:
   * `{ '@my-app/shared': await import('@my-app/shared') }`. A schema exported by one of them is imported, not
   * generated, so the front end validates with the very same schema (transforms, refinements, messages).
   */
  readonly schemaModules?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * Accepts schemas that no module of `schemaModules` exports: they are generated from their JSON Schema and lose what
   * it cannot express. Default: `false`, such a schema fails the generation.
   */
  readonly allowRegenerated?: boolean;
  readonly outputs: readonly OutputConfig[];
  /** Validation library of the generated schemas. Default: `zodDriver`. */
  readonly validation?: ValidationDriver;
  /** Binding emitters, added to the REST one. */
  readonly bindings?: readonly BindingEmitter[];
}

/** Typed identity, for `polycanal.config.ts`: `export default defineConfig({ ... })`. */
export function defineConfig(config: PolycanalConfig): PolycanalConfig {
  return config;
}
