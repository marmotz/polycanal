import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  type INestApplication,
  Post,
  Put,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Endpoint } from './decorators.js';
import { discoverNestContract } from './discover.js';
import { filePipe, filesPipe, multipartBodyPipe } from './files.js';

function multerFile(name: string, content: string, mimetype = 'image/png') {
  const buffer = Buffer.from(content);

  return { fieldname: 'file', originalname: name, mimetype, size: buffer.length, buffer };
}

async function rejection(promise: Promise<unknown>): Promise<{ message: string; issues: { path?: unknown[] }[] }> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(BadRequestException);

  return (error as BadRequestException).getResponse() as { message: string; issues: { path?: unknown[] }[] };
}

const Png = z.file().mime(['image/png']).max(100);

describe('filePipe()', () => {
  it('validates the uploaded file and hands the multer file over unchanged', async () => {
    const file = multerFile('a.png', 'png');

    await expect(filePipe(Png).transform(file, { type: 'custom' })).resolves.toBe(file);
  });

  it('opens a file stored on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'polycanal-nest-'));
    const path = join(dir, 'upload');
    writeFileSync(path, 'png');
    const file = { originalname: 'a.png', mimetype: 'image/png', size: 3, path };

    try {
      await expect(filePipe(Png).transform(file, { type: 'custom' })).resolves.toBe(file);
      await expect(filePipe(z.file().max(2)).transform(file, { type: 'custom' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers 400 with the issues', async () => {
    const response = await rejection(
      filePipe(Png).transform(multerFile('a.txt', 'text', 'text/plain'), { type: 'custom' }),
    );

    expect(response.message).toBe('Invalid uploaded file');
    expect(response.issues.length).toBeGreaterThan(0);
    await expect(rejection(filePipe(Png).transform(undefined, { type: 'custom' }))).resolves.toMatchObject({
      message: 'Invalid uploaded file',
    });
    await expect(filePipe(Png.optional()).transform(undefined, { type: 'custom' })).resolves.toBeUndefined();
  });
});

describe('filesPipe()', () => {
  it('validates a list of files with one schema', async () => {
    const files = [multerFile('a.png', 'a'), multerFile('b.png', 'b')];

    await expect(filesPipe(z.array(Png).max(2)).transform(files, { type: 'custom' })).resolves.toBe(files);

    const response = await rejection(filesPipe(z.array(Png).max(1)).transform(files, { type: 'custom' }));
    expect(response.message).toBe('Invalid uploaded files');
  });

  it('validates each field, giving a single file to a field whose schema is not a list', async () => {
    const pipe = filesPipe({ cover: Png, photos: z.array(Png), extra: Png.optional() });
    const files = { cover: [multerFile('c.png', 'c')], photos: [multerFile('a.png', 'a'), multerFile('b.png', 'b')] };

    await expect(pipe.transform(files, { type: 'custom' })).resolves.toBe(files);

    const response = await rejection(
      pipe.transform({ photos: [multerFile('a.txt', 'a', 'text/plain')] }, { type: 'custom' }),
    );
    expect(response.issues.map((issue) => issue.path?.[0])).toEqual(['cover', 'photos']);
  });

  it('validates an object of lists with an object schema', async () => {
    const pipe = filesPipe(z.object({ cover: z.array(Png).length(1) }));

    await expect(pipe.transform({ cover: [multerFile('c.png', 'c')] }, { type: 'custom' })).resolves.toBeDefined();
    await expect(pipe.transform({ cover: [] }, { type: 'custom' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('multipartBodyPipe()', () => {
  const pipe = multipartBodyPipe(z.object({ zip: z.string(), price: z.number(), tags: z.array(z.string()) }));

  it('validates text fields, parsing them as JSON when needed', async () => {
    await expect(pipe.transform({ zip: '75001', price: '12.5', tags: '["a","b"]' }, { type: 'body' })).resolves.toEqual(
      { zip: '75001', price: 12.5, tags: ['a', 'b'] },
    );
  });

  it('answers 400 with the issues', async () => {
    const response = await rejection(pipe.transform({ zip: '75001', price: 'cheap', tags: '[]' }, { type: 'body' }));

    expect(response.message).toBe('Invalid multipart body');
    expect(response.issues.map((issue) => issue.path?.[0])).toEqual(['price']);
  });
});

const ListingSchema = z.object({ title: z.string(), price: z.number() });

@Controller('uploads')
class UploadsController {
  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  @Endpoint({ output: z.object({ name: z.string(), size: z.number() }) })
  avatar(@UploadedFile(filePipe(Png, { field: 'avatar' })) file: { originalname: string; size: number }) {
    return { name: file.originalname, size: file.size };
  }

  @Post('keyed')
  @Endpoint({ output: z.void() })
  keyed(@UploadedFile('file', filePipe(Png)) _file: unknown) {}

  @Post('anonymous')
  @UseInterceptors(FileInterceptor('document'))
  @Endpoint({ output: z.void() })
  anonymous(@UploadedFile() _file: unknown) {}

  @Post('declared')
  @UseInterceptors(FileInterceptor('document'))
  @Endpoint({ output: z.void(), input: { document: { source: 'body', schema: z.file() } } })
  declared(@UploadedFile() _file: unknown) {}

  @Post('gallery')
  @UseInterceptors(FilesInterceptor('photos'))
  @Endpoint({ output: z.number() })
  gallery(
    @UploadedFiles(filesPipe(z.array(Png), { field: 'photos' })) files: unknown[],
    @Body(multipartBodyPipe(ListingSchema)) body: { title: string; price: number },
  ) {
    return files.length + body.price;
  }

  @Post('listing')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'cover', maxCount: 1 }, { name: 'photos' }]))
  @Endpoint({ output: z.void() })
  listing(@UploadedFiles(filesPipe({ cover: Png, photos: z.array(Png).optional() })) _files: unknown) {}

  @Put('object')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'cover', maxCount: 1 }]))
  @Endpoint({ output: z.void() })
  object(@UploadedFiles(filesPipe(z.object({ cover: z.array(Png) }))) _files: unknown) {}

  @Post('unnamed')
  @UseInterceptors(FilesInterceptor('photos'))
  @Endpoint({ output: z.void() })
  unnamed(@UploadedFiles(filesPipe(z.array(Png))) _files: unknown) {}
}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [UploadsController] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
});

afterAll(async () => {
  await app.close();
});

function fieldsOf(handler: string) {
  const found = discoverNestContract(app).description.operations.find(
    (candidate) => candidate.path.join('.') === `uploads.${handler}`,
  );

  if (found?.family !== 'action') {
    throw new Error(`no action ${handler}`);
  }

  return {
    binding: found.binding,
    fields: found.input?.kind === 'fields' ? found.input.fields : [],
  };
}

describe('discoverNestContract() with uploaded files', () => {
  it('names a single file from the field option of the pipe, as a multipart body', () => {
    const { binding, fields } = fieldsOf('avatar');

    expect(binding).toMatchObject({ method: 'POST', body: 'multipart' });
    expect(fields).toEqual([
      expect.objectContaining({
        name: 'avatar',
        source: 'body',
        required: true,
        schema: expect.objectContaining({ type: 'string', format: 'binary', maxLength: 100 }),
      }),
    ]);
  });

  it('names a single file from the @UploadedFile() key', () => {
    expect(fieldsOf('keyed').fields.map(({ name }) => name)).toEqual(['file']);
  });

  it('warns about a file without name, unless @Endpoint({ input }) declares it', () => {
    const { warnings } = discoverNestContract(app).report;

    expect(fieldsOf('anonymous')).toMatchObject({ binding: { body: 'multipart' }, fields: [] });
    expect(warnings).toContain(
      'POST /uploads/anonymous: @UploadedFile() without field name, not described (use filePipe(schema, { field }), filesPipe(schema, { field }) or @Endpoint({ input }))',
    );
    expect(fieldsOf('declared').fields.map(({ name }) => name)).toEqual(['document']);
    expect(warnings.some((warning) => warning.startsWith('POST /uploads/declared'))).toBe(false);
  });

  it('describes FilesInterceptor() lists next to the text fields', () => {
    expect(
      fieldsOf('gallery').fields.map(({ name, source, schema }) => [name, source, (schema as { type?: unknown }).type]),
    ).toEqual([
      ['title', 'body', 'string'],
      ['price', 'body', 'number'],
      ['photos', 'body', 'array'],
    ]);
  });

  it('describes FileFieldsInterceptor() fields from a map of schemas or an object schema', () => {
    expect(fieldsOf('listing').fields.map(({ name, required }) => [name, required])).toEqual([
      ['cover', true],
      ['photos', false],
    ]);
    expect(fieldsOf('object')).toMatchObject({
      binding: { method: 'PUT', body: 'multipart' },
      fields: [{ name: 'cover', required: true, schema: { type: 'array' } }],
    });
  });

  it('warns about a list of files without name', () => {
    expect(fieldsOf('unnamed').fields).toEqual([]);
    expect(discoverNestContract(app).report.warnings).toContain(
      'POST /uploads/unnamed: @UploadedFiles() without field name, not described (use filePipe(schema, { field }), filesPipe(schema, { field }) or @Endpoint({ input }))',
    );
  });
});

describe('upload pipes in a running application', () => {
  it('validate the files and the text fields of a real multipart request', async () => {
    await app.listen(0);
    const url = await app.getUrl();

    const avatar = new FormData();
    avatar.append('avatar', new File(['png'], 'me.png', { type: 'image/png' }));
    const ok = await fetch(`${url}/uploads/avatar`, { method: 'POST', body: avatar });
    expect(ok.status).toBe(201);
    await expect(ok.json()).resolves.toEqual({ name: 'me.png', size: 3 });

    const wrong = new FormData();
    wrong.append('avatar', new File(['text'], 'me.txt', { type: 'text/plain' }));
    const refused = await fetch(`${url}/uploads/avatar`, { method: 'POST', body: wrong });
    expect(refused.status).toBe(400);
    await expect(refused.json()).resolves.toMatchObject({ message: 'Invalid uploaded file' });

    const gallery = new FormData();
    gallery.append('photos', new File(['a'], 'a.png', { type: 'image/png' }));
    gallery.append('photos', new File(['b'], 'b.png', { type: 'image/png' }));
    gallery.append('title', 'Flat');
    gallery.append('price', '12.5');
    const listed = await fetch(`${url}/uploads/gallery`, { method: 'POST', body: gallery });
    expect(listed.status).toBe(201);
    await expect(listed.json()).resolves.toBe(14.5);
  });
});
