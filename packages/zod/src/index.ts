import type { ValidationDriver } from '@polycanal/core';
import { generateZod } from './generate.js';

/** Validation driver for Zod 4: generates `z.*` schemas from JSON Schema. */
export const zodDriver: ValidationDriver = {
  name: 'zod',
  generate: generateZod,
  optional: (schema) => ({ code: `${schema.code}.optional()`, imports: schema.imports }),
};

export { generateZod };
