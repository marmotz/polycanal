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
}

export type ActionBinding<TSource extends string = string> = TransportBinding<'action', TSource>;

export type EventBinding = TransportBinding<'event'>;

/** Union of the input sources a binding accepts. */
export type SourceOf<TBinding extends TransportBinding> = TBinding['sources'][number];

/**
 * Encoding of request and response bodies (spec §4, body codecs). Refined with the driver interfaces; JSON is the
 * default codec of every driver.
 */
export interface Codec {
  readonly contentType: string;
  encode(value: unknown): unknown;
  decode(body: unknown): unknown | Promise<unknown>;
}

/** Free description of an operation, for documentation and OpenAPI / AsyncAPI export. */
export interface OperationMeta {
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean | string;
}
