import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, apiError, toApiErrorBody } from './index.js';

describe('apiError', () => {
  it('erzeugt einen AppError mit Code, HTTP-Status und deutscher Meldung', () => {
    const error = apiError('CHALLENGE_FULL');
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('CHALLENGE_FULL');
    expect(error.httpStatus).toBe(ERROR_CODES.CHALLENGE_FULL.httpStatus);
    expect(error.message).toBe(ERROR_CODES.CHALLENGE_FULL.message);
  });

  it('serialisiert zu einem stabilen Antwort-Body', () => {
    const body = toApiErrorBody(apiError('ALREADY_JOINED'));
    expect(body).toEqual({
      error: { code: 'ALREADY_JOINED', message: ERROR_CODES.ALREADY_JOINED.message },
    });
  });
});
