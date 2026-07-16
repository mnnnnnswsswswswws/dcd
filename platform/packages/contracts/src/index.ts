/**
 * Fehler-Kontrakt der Plattform.
 *
 * `ERROR_CODES` bildet stabile, maschinenlesbare Codes auf einen HTTP-Status und
 * eine nutzersichtbare **deutsche** Meldung ab. Code und Identifier sind Englisch;
 * alle nutzersichtbaren Texte sind Deutsch (siehe Konventionen).
 */

export interface ErrorSpec {
  /** HTTP-Status, der beim Serialisieren dieses Fehlers verwendet wird. */
  readonly httpStatus: number;
  /** Nutzersichtbare deutsche Meldung. */
  readonly message: string;
}

export const ERROR_CODES = {
  CHALLENGE_NOT_FOUND: {
    httpStatus: 404,
    message: 'Diese Challenge existiert nicht.',
  },
  CHALLENGE_NOT_JOINABLE: {
    httpStatus: 409,
    message: 'Diese Challenge nimmt derzeit keine Teilnehmer an.',
  },
  CHALLENGE_DEADLINE_PASSED: {
    httpStatus: 409,
    message: 'Der Einsendeschluss dieser Challenge ist bereits überschritten.',
  },
  CHALLENGE_FULL: {
    httpStatus: 409,
    message: 'Diese Challenge ist bereits voll belegt.',
  },
  CREATOR_CANNOT_JOIN: {
    httpStatus: 403,
    message: 'Als Ersteller kannst du deiner eigenen Challenge nicht beitreten.',
  },
  ALREADY_JOINED: {
    httpStatus: 409,
    message: 'Du nimmst an dieser Challenge bereits teil.',
  },
  ALREADY_SUBMITTED: {
    httpStatus: 409,
    message: 'Du hast zu dieser Challenge bereits eine Einsendung abgegeben.',
  },
  INVALID_INPUT: {
    httpStatus: 400,
    message: 'Die Eingabe ist ungültig.',
  },
  FUNDING_NOT_FOUND: {
    httpStatus: 404,
    message: 'Zu dieser Zahlung wurde keine Finanzierung gefunden.',
  },
  FUNDING_AMOUNT_MISMATCH: {
    httpStatus: 409,
    message: 'Der bestätigte Betrag entspricht nicht der geforderten Vollfinanzierung.',
  },
  CHALLENGE_INVALID_STATE: {
    httpStatus: 409,
    message: 'Diese Aktion ist im aktuellen Zustand der Challenge nicht möglich.',
  },
  NOT_ADMIN: {
    httpStatus: 403,
    message: 'Diese Aktion erfordert Admin-Rechte.',
  },
  NOT_A_PARTICIPANT: {
    httpStatus: 403,
    message: 'Du nimmst an dieser Challenge nicht teil.',
  },
  SUBMISSION_NOT_FOUND: {
    httpStatus: 404,
    message: 'Diese Einsendung existiert nicht.',
  },
  SUBMISSION_NOT_ELIGIBLE: {
    httpStatus: 409,
    message: 'Diese Einsendung ist nicht gewinnberechtigt.',
  },
  NO_ELIGIBLE_SUBMISSIONS: {
    httpStatus: 409,
    message: 'Es gibt keine gewinnberechtigte Einsendung.',
  },
  CREATOR_CANNOT_VOTE: {
    httpStatus: 403,
    message: 'Als Ersteller kannst du in deiner eigenen Challenge nicht abstimmen.',
  },
  ALREADY_VOTED: {
    httpStatus: 409,
    message: 'Du hast in dieser Challenge bereits abgestimmt.',
  },
  UNDERAGE: {
    httpStatus: 403,
    message: 'Die Nutzung ist ausschließlich Personen ab 18 Jahren gestattet.',
  },
  USER_NOT_FOUND: {
    httpStatus: 404,
    message: 'Dieser Nutzer existiert nicht.',
  },
  FORBIDDEN: {
    httpStatus: 403,
    message: 'Diese Aktion ist dir nicht gestattet.',
  },
} as const satisfies Record<string, ErrorSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Anwendungsfehler mit stabilem Code. Wird von der API-Schicht zu einer
 * einheitlichen Fehlerantwort serialisiert.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;

  constructor(code: ErrorCode) {
    const spec = ERROR_CODES[code];
    super(spec.message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = spec.httpStatus;
    // Prototype-Kette für `instanceof` über transpilierten Code korrekt setzen.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** Erzeugt einen `AppError` für den angegebenen Code. */
export function apiError(code: ErrorCode): AppError {
  return new AppError(code);
}

/** Serialisierbare Form einer Fehlerantwort. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}

/** Wandelt einen `AppError` in den Antwort-Body der API um. */
export function toApiErrorBody(error: AppError): ApiErrorBody {
  return { error: { code: error.code, message: error.message } };
}
