import type { OpenApiDocument } from '../import.js';

/** OpenAPI 3.0 document with multipart request bodies and binary responses. */
export const files: OpenApiDocument = {
  openapi: '3.0.3',
  paths: {
    '/photos': {
      post: {
        operationId: 'uploadPhotos',
        tags: ['photos'],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  cover: { type: 'string', format: 'binary', maxLength: 5000000 },
                  photos: { type: 'array', items: { type: 'string', format: 'binary' } },
                  title: { type: 'string' },
                  price: { type: 'number' },
                },
                required: ['cover', 'title'],
              },
              encoding: {
                cover: { contentType: 'image/png, image/jpeg' },
                photos: { contentType: 'image/*' },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } },
          },
        },
      },
      get: {
        operationId: 'searchPhotos',
        tags: ['photos'],
        requestBody: {
          content: { 'multipart/form-data': { schema: { type: 'object', properties: { q: { type: 'string' } } } } },
        },
        responses: { '204': { description: 'ok' } },
      },
    },
    '/photos/{photoId}': {
      get: {
        operationId: 'downloadPhoto',
        tags: ['photos'],
        parameters: [{ name: 'photoId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'the photo',
            content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
          },
          '404': {
            description: 'missing',
            content: {
              'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } },
            },
          },
        },
      },
      put: {
        operationId: 'replacePhoto',
        tags: ['photos'],
        requestBody: {
          content: {
            'multipart/form-data': { schema: { type: 'array', items: { type: 'string', format: 'binary' } } },
          },
        },
        responses: { '204': { description: 'ok' } },
      },
    },
    '/reports/{year}': {
      get: {
        operationId: 'downloadReport',
        tags: ['reports'],
        parameters: [{ name: 'year', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'the report', content: { 'application/pdf': {} } } },
      },
    },
  },
};
