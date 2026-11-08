import { describe, expect, it } from 'vitest';
import { encodeMultipart, fileProgress, type MultipartPart, multipartParts } from './multipart.js';

const text = (value: unknown) => String(value);

describe('multipartParts()', () => {
  it('returns the parts recorded by the encoder, in body order', () => {
    const form = encodeMultipart(
      {
        title: 'été',
        cover: new File(['cover'], 'cover.jpg'),
        photos: [new File(['a'], 'a.png'), new Blob(['bb'])],
      },
      text,
    );

    expect(multipartParts(form)).toEqual([
      { field: 'title', name: undefined, size: 5, file: false },
      { field: 'cover', name: 'cover.jpg', size: 5, file: true },
      { field: 'photos', name: 'a.png', size: 1, file: true },
      { field: 'photos', name: undefined, size: 2, file: true },
    ]);
  });

  it('reads the entries of a FormData it did not encode, or that was changed', () => {
    const form = new FormData();
    form.append('title', 'x');
    form.append('doc', new File(['abc'], 'doc.pdf'));

    expect(multipartParts(form)).toEqual([
      { field: 'title', name: undefined, size: 1, file: false },
      { field: 'doc', name: 'doc.pdf', size: 3, file: true },
    ]);

    const encoded = encodeMultipart({ a: 'x' }, text);
    encoded.append('extra', new File(['zz'], 'z.txt'));

    expect(multipartParts(encoded).map((part) => part.field)).toEqual(['a', 'extra']);
  });
});

describe('fileProgress()', () => {
  // Overheads: title 125, cover 130, photos 131; closing 50. Estimated total: 3440
  const parts: MultipartPart[] = [
    { field: 'title', name: undefined, size: 4, file: false },
    { field: 'cover', name: 'c.jpg', size: 1000, file: true },
    { field: 'photos', name: 'p.png', size: 2000, file: true },
  ];
  const progress = (loaded: number, total: number | undefined) =>
    fileProgress(parts, loaded, total).map((file) => file.loaded);

  it('reports each file, in body order, with its size', () => {
    expect(fileProgress(parts, 0, 3440)).toEqual([
      { field: 'cover', name: 'c.jpg', loaded: 0, total: 1000 },
      { field: 'photos', name: 'p.png', loaded: 0, total: 2000 },
    ]);
  });

  it('gives each file the bytes that fall within it', () => {
    expect(progress(259, 3440)).toEqual([0, 0]);
    expect(progress(759, 3440)).toEqual([500, 0]);
    expect(progress(1890, 3440)).toEqual([1000, 500]);
  });

  it('scales the estimate to the real total, or uses the bytes as is when it is unknown', () => {
    expect(progress(1518, 6880)).toEqual([500, 0]);
    expect(progress(759, undefined)).toEqual([500, 0]);
  });

  it('completes every file when the whole request is sent', () => {
    expect(progress(3000, 3000)).toEqual([1000, 2000]);
    expect(progress(3440, 3440)).toEqual([1000, 2000]);
  });

  it('reports no file for a body without files', () => {
    expect(fileProgress([{ field: 'a', name: undefined, size: 1, file: false }], 10, 100)).toEqual([]);
    expect(fileProgress([], 0, undefined)).toEqual([]);
  });
});
