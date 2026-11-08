import type { BindingEmitter, TransportBinding } from '@polycanal/core';
import { isRestBinding } from './binding.js';

/** Generates `rest.<method>(path, options?)` for code generation (`@polycanal/codegen`). */
export const restBindingEmitter: BindingEmitter = {
  driver: 'rest',
  emit(binding: TransportBinding) {
    if (!isRestBinding(binding)) {
      throw new TypeError(`restBindingEmitter: not a REST binding (driver "${binding.driver}")`);
    }

    const status =
      binding.status === undefined
        ? ''
        : `, { status: ${binding.status.length === 1 ? binding.status[0] : `[${binding.status.join(', ')}]`} }`;

    return {
      code: `rest.${binding.method.toLowerCase()}(${quote(binding.path)}${status})`,
      imports: [{ from: '@polycanal/rest', names: ['rest'] }],
    };
  },
};

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
