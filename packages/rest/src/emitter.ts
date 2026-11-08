import type { BindingEmitter, TransportBinding } from '@polycanal/core';
import { isRestBinding } from './binding.js';

/** Generates `rest.<method>(path, options?)` for code generation (`@polycanal/codegen`). */
export const restBindingEmitter: BindingEmitter = {
  driver: 'rest',
  emit(binding: TransportBinding) {
    if (!isRestBinding(binding)) {
      throw new TypeError(`restBindingEmitter: not a REST binding (driver "${binding.driver}")`);
    }

    const options: string[] = [];

    if (binding.status !== undefined) {
      options.push(`status: ${binding.status.length === 1 ? binding.status[0] : `[${binding.status.join(', ')}]`}`);
    }

    if (binding.body !== undefined) {
      options.push(`body: ${quote(binding.body)}`);
    }

    if (binding.response !== undefined) {
      options.push(`response: ${quote(binding.response)}`);
    }

    const suffix = options.length === 0 ? '' : `, { ${options.join(', ')} }`;

    return {
      code: `rest.${binding.method.toLowerCase()}(${quote(binding.path)}${suffix})`,
      imports: [{ from: '@polycanal/rest', names: ['rest'] }],
    };
  },
};

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
