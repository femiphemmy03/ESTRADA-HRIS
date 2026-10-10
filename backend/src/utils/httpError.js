/**
 * Small helper so routes/services can throw errors with an HTTP status.
 * The central errorHandler already reads `err.status`.
 */
export function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}
