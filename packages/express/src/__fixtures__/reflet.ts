import 'reflect-metadata';
import { Body, Get, Params, Patch, Post, Query, Router, Send, Use } from '@reflet/express';
import { z } from 'zod';
import { endpoint } from '../endpoint.js';

/** Routers written like the Express + Angular target project, with `endpoint()` markers attached through `@Use()`. */
@Router('/households')
@Send({ json: true })
export class HouseholdsRouter {
  @Get('/:id')
  @Use(endpoint({ name: 'get', namespace: 'households', output: z.object({ id: z.string(), name: z.string() }) }))
  get(@Params('id') id: string) {
    return { id, name: 'Home' };
  }

  @Patch('/:id/members/:userId')
  @Use(
    endpoint({
      name: 'updateMemberRole',
      namespace: 'households',
      input: {
        id: z.string(),
        userId: { source: 'path', schema: z.string() },
        toUserId: { source: 'body', alias: 'userId', schema: z.string() },
        role: z.enum(['admin', 'member']),
      },
      output: z.object({ id: z.string(), userId: z.string(), target: z.string(), role: z.string() }),
    }),
  )
  updateMemberRole(
    @Params('id') id: string,
    @Params('userId') userId: string,
    @Body() body: { userId: string; role: string },
  ) {
    return { id, userId, target: body.userId, role: body.role };
  }

  @Get('/')
  list(@Query('page') page: string) {
    return [{ id: 'h1', page }];
  }
}

@Router('/auth')
@Send({ json: true })
export class AuthRouter {
  @Post('/login')
  @Use(
    endpoint({
      name: 'login',
      namespace: 'auth',
      input: z.object({ email: z.email(), password: z.string() }),
      output: z.object({ token: z.string() }),
      errors: { 401: z.object({ message: z.string() }) },
    }),
  )
  login(@Body() body: { email: string; password: string }) {
    return { token: `token-for-${body.email}` };
  }
}
