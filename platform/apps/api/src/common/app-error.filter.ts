import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError, toApiErrorBody } from '@vcp/contracts';

/**
 * Übersetzt Fehler in eine einheitliche Antwortform `{ error: { code, message } }`.
 * `AppError` trägt den stabilen Domänen-Code + HTTP-Status; NestJS-`HttpException`
 * (z. B. aus Guards) wird auf denselben Umschlag abgebildet.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      response.status(exception.httpStatus).json(toApiErrorBody(exception));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: { code: httpStatusToCode(status), message: exception.message },
      });
      return;
    }

    // Unerwartete Fehler protokollieren (nicht an den Client durchreichen).
    this.logger.error('Unerwarteter Fehler', exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Ein interner Fehler ist aufgetreten.' },
    });
  }
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    default:
      return 'HTTP_ERROR';
  }
}
