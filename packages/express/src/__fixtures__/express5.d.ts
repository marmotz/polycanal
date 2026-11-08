// Express 5 is installed under the `express5` alias for tests, next to Express 4
declare module 'express5' {
  import express from 'express';

  export default express;
}
