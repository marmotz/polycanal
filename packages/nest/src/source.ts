import type { INestApplicationContext } from '@nestjs/common';
import type { ContractSource } from '@polycanal/codegen';
import { discoverNestContract, type NestDiscoveryOptions } from './discover.js';

export interface NestSourceOptions extends Omit<NestDiscoveryOptions, 'resolveSchema'> {
  /**
   * Creates the application. Build it as a graph only, so that nothing connects:
   * `() => NestFactory.create(AppModule, { preview: true, logger: false })`. It is closed once described.
   */
  readonly app: () => INestApplicationContext | Promise<INestApplicationContext>;
}

/** Contract source for `polycanal generate`: the routes of a Nest application marked with `@Endpoint()`. */
export function nestSource(options: NestSourceOptions): ContractSource {
  const { app: create, ...discovery } = options;

  return {
    name: 'nest',
    async load({ resolveSchema }) {
      const app = await create();

      try {
        const { description, report } = discoverNestContract(app, { ...discovery, resolveSchema });

        return {
          description,
          regenerated: report.regenerated,
          warnings: [
            ...report.skipped.map(({ route, reason }) => `${route.method} ${route.path} skipped: ${reason}`),
            ...report.warnings,
            ...report.conflicts.map(({ operation, reason }) => `${operation}: ${reason} (the config wins)`),
          ],
        };
      } finally {
        await app.close();
      }
    },
  };
}
