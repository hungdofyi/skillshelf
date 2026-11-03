/** Error that route handlers throw to produce a specific HTTP status + JSON body. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 412 | 413 | 422 | 500 | 503,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
