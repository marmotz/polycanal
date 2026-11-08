/**
 * Thrown when a contract is malformed (invalid field descriptor, unsupported source, wrong binding family...).
 * These are programming errors, raised as soon as the contract is defined.
 */
export class ContractDefinitionError extends Error {
  /** Location of the faulty element in the contract, e.g. `['households', 'list']`. */
  readonly path: readonly string[];
  /** Message without the location prefix. */
  readonly reason: string;

  constructor(reason: string, path: readonly string[] = []) {
    super(path.length > 0 ? `${path.join('.')}: ${reason}` : reason);
    this.name = 'ContractDefinitionError';
    this.path = path;
    this.reason = reason;
  }

  /** Returns a copy of this error located under `prefix`. */
  withPrefix(prefix: readonly string[]): ContractDefinitionError {
    return new ContractDefinitionError(this.reason, [...prefix, ...this.path]);
  }
}
