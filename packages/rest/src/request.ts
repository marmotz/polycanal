import type { ActionModel, Codec } from '@polycanal/core';
import { type HttpMethod, isRestBinding, QUERY_METHODS, type RestSource } from './binding.js';
import { type HttpRequest, lowercaseKeys } from './http.js';

export interface BuildRequestOptions {
  readonly baseUrl: string;
  readonly codec: Codec;
  readonly headers: Readonly<Record<string, string>>;
}

interface MappedField {
  readonly wireName: string;
  readonly source: RestSource;
  readonly root: boolean;
  readonly value: unknown;
}

/** Maps a validated input onto an HTTP request (spec §4, REST binding rules). */
export function buildRequest(operation: ActionModel, input: unknown, options: BuildRequestOptions): HttpRequest {
  const binding = operation.transport;

  if (!isRestBinding(binding)) {
    throw new TypeError(`${operation.id}: not a REST binding`);
  }

  const method = binding.method as HttpMethod;
  const fields = mapFields(operation, input, binding.requires, method);
  const path = fillPath(binding.path, fields, operation.id);
  const query = new URLSearchParams();
  const headers: Record<string, string> = { accept: options.codec.contentType, ...lowercaseKeys(options.headers) };
  const body: Record<string, unknown> = {};
  let rootBody: { value: unknown } | undefined;

  for (const field of fields) {
    if (field.value === undefined) {
      continue;
    }

    switch (field.source) {
      case 'path':
        break;
      case 'query':
        if (field.root) {
          for (const [key, value] of entries(field.value, field.wireName)) {
            appendQuery(query, key, value);
          }
        } else {
          appendQuery(query, field.wireName, field.value);
        }
        break;
      case 'header':
        if (field.root) {
          for (const [key, value] of entries(field.value, field.wireName)) {
            setHeader(headers, key, value);
          }
        } else {
          setHeader(headers, field.wireName, field.value);
        }
        break;
      case 'body':
        if (field.root) {
          rootBody = { value: field.value };
        } else {
          body[field.wireName] = field.value;
        }
        break;
    }
  }

  const payload = rootBody !== undefined ? rootBody.value : Object.keys(body).length > 0 ? body : undefined;
  const encoded = payload === undefined ? undefined : options.codec.encode(payload);

  if (encoded !== undefined) {
    headers['content-type'] = options.codec.contentType;
  }

  const search = query.toString();

  return {
    method,
    url: `${options.baseUrl.replace(/\/+$/, '')}${path}${search === '' ? '' : `?${search}`}`,
    headers,
    body: encoded,
  };
}

function mapFields(
  operation: ActionModel,
  input: unknown,
  requires: Readonly<Record<string, string>>,
  method: HttpMethod,
): MappedField[] {
  if (operation.input === undefined || input === undefined) {
    return [];
  }

  const values = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const defaultSource = (wireName: string): RestSource =>
    wireName in requires ? 'path' : QUERY_METHODS.has(method) ? 'query' : 'body';

  // Plain object schema: every key follows the default rules
  if (operation.input.fields === undefined) {
    return Object.entries(values).map(([name, value]) => ({
      wireName: name,
      source: defaultSource(name),
      root: false,
      value,
    }));
  }

  return operation.input.fields.map((field) => ({
    wireName: field.wireName,
    source: (field.source as RestSource | undefined) ?? defaultSource(field.wireName),
    root: field.root,
    value: values[field.name],
  }));
}

function fillPath(path: string, fields: readonly MappedField[], operationId: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) {
        return segment;
      }

      const name = segment.slice(1);
      const field = fields.find((candidate) => candidate.source === 'path' && candidate.wireName === name);

      if (field === undefined || field.value === undefined || field.value === null) {
        throw new TypeError(`${operationId}: missing value for path parameter "${name}"`);
      }

      return encodeURIComponent(scalar(field.value));
    })
    .join('/');
}

function entries(value: unknown, name: string): [string, unknown][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`root field "${name}" must be an object to be spread`);
  }

  return Object.entries(value);
}

function appendQuery(query: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendQuery(query, key, item);
    }

    return;
  }

  query.append(key, scalar(value));
}

function setHeader(headers: Record<string, string>, name: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value.map(scalar).join(', ') : scalar(value);
  }
}

/** Text form of a value in a path, query string or header: dates as ISO strings, objects as JSON. */
function scalar(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }

  return String(value);
}
