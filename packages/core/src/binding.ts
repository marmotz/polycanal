/** The two channel families of the model (spec §4). */
export type ChannelFamily = 'action' | 'event';

/**
 * Description of how an operation is carried by a transport, produced by a driver package (for example
 * `rest.patch('/users/:id')`). It is plain data: it contains no transport code. Drivers extend it with their own
 * properties (HTTP method, path, event name...).
 */
export interface TransportBinding<TFamily extends ChannelFamily = ChannelFamily, TSource extends string = string> {
  /** Driver identifier, used to pick the driver implementation when creating a client (e.g. `'rest'`). */
  readonly driver: string;
  /** Channel family this binding can carry. */
  readonly family: TFamily;
  /** Values accepted as `source` by the `input()` fields of an action using this binding. */
  readonly sources: readonly TSource[];
  /**
   * Input fields the binding needs, by wire name, with the source they must use (e.g. REST path parameters:
   * `{ userId: 'path' }`). A field matches when its source is that one or left to the default rules. Sources listed
   * here are closed: an input field can only use them explicitly if its wire name is required.
   */
  readonly requires?: Readonly<Record<string, TSource>>;
}

export type ActionBinding<TSource extends string = string> = TransportBinding<'action', TSource>;

export type EventBinding = TransportBinding<'event'>;

/** Union of the input sources a binding accepts. */
export type SourceOf<TBinding extends TransportBinding> = TBinding['sources'][number];

/**
 * Encoding of request and response bodies (spec §4, body codecs). Codecs are text based for now; binary formats
 * (files, form data) will extend this interface. JSON is the default codec of every driver.
 */
export interface Codec {
  /** Media type sent and expected, e.g. `application/json`. */
  readonly contentType: string;
  /** Serializes a validated value into a body. */
  encode(value: unknown): string;
  /** Parses a received body. An empty body decodes to `undefined`. */
  decode(text: string): unknown;
}

/** Free description of an operation, for documentation and OpenAPI / AsyncAPI export. */
export interface OperationMeta {
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean | string;
}
