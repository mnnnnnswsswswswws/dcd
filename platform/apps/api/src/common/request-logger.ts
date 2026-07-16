import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/**
 * Vergibt/übernimmt eine Request-ID (`x-request-id`) und protokolliert nach Abschluss
 * strukturiert Methode, Pfad, Status und Dauer — Basis für Nachvollziehbarkeit in
 * Produktion.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const headerId = req.headers['x-request-id'];
  const id = (Array.isArray(headerId) ? headerId[0] : headerId) ?? randomUUID();
  res.setHeader('x-request-id', id);

  const start = Date.now();
  res.on('finish', () => {
    logger.log(
      JSON.stringify({
        id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - start,
      }),
    );
  });
  next();
}
