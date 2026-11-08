import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  type PipeTransform,
  Post,
  Query,
  Req,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { Endpoint, EndpointNamespace } from '../decorators.js';

/** Same shape as the pipes of the target projects: a schema stored on the pipe instance. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException(result.error.issues);
    }

    return result.data;
  }
}

/** Project decorator storing the response schema, like `@ZodResponse()` in one of the target projects. */
export const ZOD_RESPONSE_SCHEMA_KEY = 'zodResponseSchema';
export const ZodResponse = (schema: z.ZodType) => SetMetadata(ZOD_RESPONSE_SCHEMA_KEY, schema);

export const LoginRequestSchema = z.object({ email: z.email(), password: z.string().min(8) });
export const LoginResponseSchema = z.object({ token: z.string() });
export const HouseholdSchema = z.object({ id: z.string(), name: z.string() });
export const RoleBodySchema = z.object({ role: z.enum(['admin', 'member']), userId: z.string() });

@Controller('auth')
export class AuthController {
  @Post('login')
  @HttpCode(200)
  @Endpoint({ output: LoginResponseSchema, errors: { 401: z.object({ message: z.string() }) } })
  login(@Body(new ZodValidationPipe(LoginRequestSchema)) body: z.infer<typeof LoginRequestSchema>) {
    if (body.password !== 'correct-password') {
      throw new UnauthorizedException('invalid credentials');
    }

    return { token: `token-for-${body.email}` };
  }

  @Post('logout')
  logout() {
    return undefined;
  }
}

@Controller('households')
export class HouseholdsController {
  @Get()
  @Endpoint({ output: z.array(HouseholdSchema) })
  list() {
    return [{ id: 'h1', name: 'Home' }];
  }

  @Patch(':householdId/members/:userId')
  @Endpoint({ output: z.object({ householdId: z.string(), userId: z.string(), role: z.string(), target: z.string() }) })
  updateMemberRole(
    @Param('householdId') householdId: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(RoleBodySchema)) body: z.infer<typeof RoleBodySchema>,
    @Req() _request: unknown,
  ) {
    return { householdId, userId, role: body.role, target: body.userId };
  }

  @Delete(':id')
  @HttpCode(204)
  @Endpoint({ output: z.void() })
  remove(@Param() _params: unknown) {}

  @Post('import')
  @Endpoint({ output: z.object({ count: z.number() }) })
  importMembers(@Body(new ZodValidationPipe(z.array(z.string()))) members: string[]) {
    return { count: members.length };
  }

  @Get('broken')
  @Endpoint()
  broken() {
    return null;
  }
}

@Controller('projects')
@EndpointNamespace(['work', 'projects'])
export class ProjectsController {
  @Get(':id/analyses')
  @ZodResponse(z.object({ id: z.string(), page: z.number(), limit: z.number(), tenant: z.string().optional() }))
  @Endpoint({ name: 'analyses', input: { page: z.coerce.number().int().default(1) } })
  analyses(
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Headers('X-Tenant') tenant?: string,
  ) {
    return { id, page: Number(page), limit: Number(limit), ...(tenant === undefined ? {} : { tenant }) };
  }

  @Get('search')
  @ZodResponse(z.array(z.string()))
  search(
    @Query(new ZodValidationPipe(z.object({ q: z.string(), tags: z.array(z.string()).optional() }))) query: unknown,
  ) {
    return [JSON.stringify(query)];
  }

  @Get('raw')
  raw(@Query() query: unknown) {
    return query;
  }
}
