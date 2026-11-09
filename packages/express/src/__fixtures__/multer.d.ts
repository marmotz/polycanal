// multer ships no types: the parts the tests use
declare module 'multer' {
  type Middleware = import('express').RequestHandler;

  interface Multer {
    single(name: string): Middleware;
    array(name: string, maxCount?: number): Middleware;
    fields(fields: readonly { name: string; maxCount?: number }[]): Middleware;
    none(): Middleware;
  }

  interface MulterFactory {
    (options?: { storage?: unknown; dest?: string }): Multer;
    memoryStorage(): unknown;
    diskStorage(options: { destination?: string }): unknown;
  }

  const multer: MulterFactory;
  export default multer;
}
