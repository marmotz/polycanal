import type { FileProgress } from '@polycanal/core';

/** A part of a multipart body, as needed to estimate the progress of each file. */
export interface MultipartPart {
  /** Name of the part (wire name of the field). */
  readonly field: string;
  /** File name, `undefined` for a text part or a plain `Blob`. */
  readonly name: string | undefined;
  /** Useful size in bytes: size of the file, UTF-8 length of the text. */
  readonly size: number;
  readonly file: boolean;
}

/** Estimated bytes of the headers and boundary of a part, on top of its name and file name. */
const PART_OVERHEAD = 120;
/** Estimated bytes of the closing boundary. */
const CLOSING_OVERHEAD = 50;

const encoder = new TextEncoder();
const recordedParts = new WeakMap<FormData, readonly MultipartPart[]>();

/**
 * Encodes body fields as `multipart/form-data`: a file is appended as is, an array gives one part per item, a text
 * value is written with `text()`, `undefined` and `null` are skipped. The parts are recorded for `multipartParts()`.
 */
export function encodeMultipart(fields: Readonly<Record<string, unknown>>, text: (value: unknown) => string): FormData {
  const form = new FormData();
  const parts: MultipartPart[] = [];

  const append = (field: string, value: unknown): void => {
    if (value === undefined || value === null) {
      return;
    }

    if (value instanceof Blob) {
      // A File keeps its own name (and identity); a plain Blob is named "blob" by FormData
      form.append(field, value);
      parts.push({ field, name: value instanceof File ? value.name : undefined, size: value.size, file: true });
      return;
    }

    const content = text(value);

    form.append(field, content);
    parts.push({ field, name: undefined, size: encoder.encode(content).length, file: false });
  };

  for (const [field, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        append(field, item);
      }
    } else {
      append(field, value);
    }
  }

  recordedParts.set(form, parts);

  return form;
}

/**
 * Parts of a multipart body, in body order. A body built by the REST driver gives the parts recorded when it was
 * encoded; another `FormData` (replaced by an interceptor) is read entry by entry.
 */
export function multipartParts(form: FormData): readonly MultipartPart[] {
  const recorded = recordedParts.get(form);

  if (recorded !== undefined && recorded.length === [...form.keys()].length) {
    return recorded;
  }

  return [...form.entries()].map(([field, value]) =>
    typeof value === 'string'
      ? { field, name: undefined, size: encoder.encode(value).length, file: false }
      : { field, name: value.name, size: value.size, file: true },
  );
}

/**
 * Estimates the progress of each file of a multipart body from the bytes sent for the whole request. HTTP clients
 * only measure the whole request: the parts are laid out with an estimated overhead, the estimate is scaled to the
 * real `total`, and each file gets the share that falls within its bytes. When `loaded` reaches `total`, every file
 * is complete.
 */
export function fileProgress(
  parts: readonly MultipartPart[],
  loaded: number,
  total: number | undefined,
): FileProgress[] {
  const done = total !== undefined && loaded >= total;
  const estimated =
    parts.reduce((sum, part) => sum + overheadOf(part) + part.size, 0) + (parts.length > 0 ? CLOSING_OVERHEAD : 0);
  const position = total === undefined || total <= 0 ? loaded : (loaded * estimated) / total;
  const files: FileProgress[] = [];
  let offset = 0;

  for (const part of parts) {
    offset += overheadOf(part);

    if (part.file) {
      const sent = done ? part.size : Math.min(part.size, Math.max(0, Math.round(position - offset)));

      files.push({ field: part.field, name: part.name, loaded: sent, total: part.size });
    }

    offset += part.size;
  }

  return files;
}

function overheadOf(part: MultipartPart): number {
  return PART_OVERHEAD + encoder.encode(part.field).length + encoder.encode(part.name ?? '').length;
}
