import { type GenerateOptions, generateContractSource } from '@polycanal/codegen';
import { restBindingEmitter } from '@polycanal/rest';
import { zodDriver } from '@polycanal/zod';
import { type ImportOptions, importOpenApi, type OpenApiDocument } from './import.js';

export interface GenerateFromOpenApiOptions
  extends ImportOptions,
    Partial<Pick<GenerateOptions, 'exportName' | 'banner'>> {
  /** Validation library of the generated schemas. Default: Zod. */
  readonly validation?: GenerateOptions['validation'];
}

/** Generates the TypeScript source of a contract from an OpenAPI 3 document. */
export function generateFromOpenApi(
  document: OpenApiDocument,
  options: GenerateFromOpenApiOptions = {},
): { source: string; warnings: readonly string[] } {
  const { description, warnings } = importOpenApi(document, options);
  const source = generateContractSource(description, {
    validation: options.validation ?? zodDriver,
    bindings: [restBindingEmitter],
    ...(options.exportName === undefined ? {} : { exportName: options.exportName }),
    ...(options.banner === undefined ? {} : { banner: options.banner }),
  });

  return { source, warnings };
}
