/** An error the client can show to staff. `code` is translated on the client; `message` is the English fallback. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public params: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`, { what });
export const badRequest = (code: string, message: string, params?: Record<string, unknown>) =>
  new AppError(400, code, message, params);
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'You are not allowed to do this. Ask Admin.');
