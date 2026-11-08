/** A source loaded by the configuration files the CLI tests write. */
import { type ContractSource, describeSchema, importedSchema } from '@polycanal/codegen';
import { rest } from '@polycanal/rest';
import { HouseholdSchema } from './schemas.js';

export function fakeSource(): ContractSource {
  return {
    name: 'fake',
    async load({ resolveSchema }) {
      const ref = resolveSchema(HouseholdSchema);
      const json = describeSchema(HouseholdSchema, 'output', 'output');

      return {
        description: {
          operations: [
            {
              family: 'action',
              path: ['households', 'get'],
              binding: rest.get('/households'),
              output: ref === undefined ? json : importedSchema(json, ref),
            },
          ],
        },
        warnings: [],
        regenerated: ref === undefined ? ['output'] : [],
      };
    },
  };
}
