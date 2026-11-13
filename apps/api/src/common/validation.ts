import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';

interface FlatError {
  path: string;
  error: ValidationError;
}

function flattenErrors(errors: readonly ValidationError[], parentPath = ''): FlatError[] {
  return errors.flatMap((error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    return [{ path, error }, ...flattenErrors(error.children ?? [], path)];
  });
}

/**
 * Maps class-validator failures to a `BadRequestException` whose payload the
 * global problem+json filter renders as `400` with `code: VALIDATION_FAILED`
 * and per-field `errors` entries (plan D9).
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const details = flattenErrors(errors).map(({ path, error }) => ({
    field: path,
    messages: Object.values(error.constraints ?? {}),
  }));
  return new BadRequestException({
    statusCode: 400,
    message: 'Validation failed',
    errors: details,
  });
}

/** The one global validation pipe — installed in `setupApp`. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });
}
