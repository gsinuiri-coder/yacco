import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

const GENERIC_SERVER_ERROR_MESSAGE = "Ocurrió un error inesperado. Vuelve a intentarlo.";
const BROKEN_LINK_MESSAGE = "No encontramos lo que buscas. Revisa el enlace.";

/**
 * The only two messages Nest ever generates itself, in English, before any
 * of our own (already-Spanish) service/DTO code runs: ParseUUIDPipe's
 * validation failure, and the router's "no route matches" 404. Matched by
 * the exact string Nest currently emits (see parse-uuid.pipe.js and
 * routes-resolver.js in @nestjs/common and @nestjs/core), which makes this
 * fragile against a Nest upgrade that rewords either message —
 * error-messages.int.test.ts is what would notice.
 */
const ENGLISH_MESSAGE_TRANSLATIONS: { pattern: RegExp; translation: string }[] = [
  { pattern: /^Validation failed \(uuid.*is expected\)$/, translation: BROKEN_LINK_MESSAGE },
  { pattern: /^Cannot (GET|POST|PUT|PATCH|DELETE) /, translation: BROKEN_LINK_MESSAGE },
];

function translateIfNestEnglish(message: string): string | undefined {
  return ENGLISH_MESSAGE_TRANSLATIONS.find((entry) => entry.pattern.test(message))?.translation;
}

/**
 * Global exception filter: only rewrites the handful of messages Nest
 * generates in English on its own. Every domain/validation message the
 * services and DTOs already throw in Spanish passes through untouched —
 * that text is exactly what apps/web renders (see readErrorMessage in
 * apps/web/src/api/api-client.ts), so overwriting it here would break the UI.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      // Not a client-facing HTTP error: a real bug. Log it in full
      // server-side; the client never sees the stack, the exception name,
      // or the original message.
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: GENERIC_SERVER_ERROR_MESSAGE,
      });
      return;
    }

    const status = exception.getStatus();
    const body = exception.getResponse();

    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      const translation = translateIfNestEnglish(body.message);
      if (translation !== undefined) {
        response.status(status).json({ ...body, message: translation });
        return;
      }
    }

    // Anything else — including a class-validator array of Spanish
    // messages — passes through exactly as the exception built it.
    response.status(status).json(body);
  }
}
