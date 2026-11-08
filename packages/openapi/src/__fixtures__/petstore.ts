import type { OpenApiDocument } from '../import.js';

/** Small OpenAPI 3.0 document covering the importer features. */
export const petstore: OpenApiDocument = {
  openapi: '3.0.3',
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        tags: ['pets'],
        summary: 'List pets',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'X-Tenant', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'session', in: 'cookie', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } },
          },
        },
      },
      post: {
        operationId: 'createPet',
        tags: ['pets'],
        requestBody: { $ref: '#/components/requestBodies/NewPet' },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          '409': { $ref: '#/components/responses/Conflict' },
        },
      },
      head: { responses: { '200': { description: 'ok' } } },
    },
    '/pets/{petId}': {
      parameters: [{ $ref: '#/components/parameters/PetId' }],
      get: {
        operationId: 'get-pet',
        tags: ['pets'],
        deprecated: true,
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json; charset=utf-8': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
          '404': {
            description: 'missing',
            content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
          },
        },
      },
      delete: { tags: ['pets'], responses: { '204': { description: 'deleted' } } },
      put: {
        operationId: 'replaceTags',
        tags: ['pets'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
        },
        responses: { '204': { description: 'ok' } },
      },
      patch: {
        operationId: 'uploadPhoto',
        tags: ['pets'],
        requestBody: { content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
        responses: { '204': { description: 'ok' } },
      },
    },
    '/owners/{owner-id}': {
      get: { operationId: 'getOwner', responses: { '200': { description: 'ok' } } },
    },
  },
  components: {
    parameters: {
      PetId: { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
    },
    requestBodies: {
      NewPet: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' }, age: { type: 'integer', minimum: 0, exclusiveMinimum: true } },
              required: ['name'],
            },
          },
        },
      },
    },
    responses: {
      Conflict: {
        description: 'conflict',
        content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } },
      },
    },
    schemas: {
      Pet: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          nickname: { type: 'string', nullable: true },
          parent: { $ref: '#/components/schemas/Pet' },
        },
        required: ['id', 'name'],
        example: { id: '1', name: 'Rex' },
      },
      Problem: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
  },
};
