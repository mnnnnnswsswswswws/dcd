import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.guard.js';

/** Extrahiert die authentifizierte User-ID aus dem Request (via AuthGuard gesetzt). */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = request.user?.id;
    if (id === undefined) {
      throw new Error('CurrentUserId ohne AuthGuard verwendet.');
    }
    return id;
  },
);

/** Extrahiert den vollständigen authentifizierten Nutzer (inkl. isAdmin). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user === undefined) {
      throw new Error('CurrentUser ohne AuthGuard verwendet.');
    }
    return request.user;
  },
);
