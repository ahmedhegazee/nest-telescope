/**
 * Utility functions for error handling and type conversion
 */

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export function ensureError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(getErrorMessage(error));
}
