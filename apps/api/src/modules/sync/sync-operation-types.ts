import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import type { ClassConstructor } from "class-transformer";
import { validate } from "class-validator";
import type { ValidationError } from "class-validator";
import { RouteStartPayloadV1Dto } from "./dto/route-start-payload.dto.js";
import { StopAddVanSalePayloadV1Dto } from "./dto/stop-add-van-sale-payload.dto.js";
import { StopMarkPayloadV1Dto } from "./dto/stop-mark-payload.dto.js";

export const SYNC_OPERATION_TYPES = {
  STOP_MARK: "STOP_MARK",
  STOP_ADD_VAN_SALE: "STOP_ADD_VAN_SALE",
  ROUTE_START: "ROUTE_START",
} as const;

/**
 * Una operación ya normalizada a la forma vigente de su tipo. Las versiones
 * viejas de un sobre se aceptan y se traen hasta acá (sync-protocol, D-06):
 * el servicio aplica siempre la última forma, nunca una vieja.
 */
export type NormalizedSyncOperation =
  | { type: typeof SYNC_OPERATION_TYPES.STOP_MARK; payload: StopMarkPayloadV1Dto }
  | {
      type: typeof SYNC_OPERATION_TYPES.STOP_ADD_VAN_SALE;
      payload: StopAddVanSalePayloadV1Dto;
    }
  | { type: typeof SYNC_OPERATION_TYPES.ROUTE_START; payload: RouteStartPayloadV1Dto };

/**
 * Cómo leer cada `(type, version)` que alguna vez salió en una app. NUNCA se
 * cambia una entrada existente: una forma nueva es una versión nueva, con su
 * DTO y su normalización a la vigente, porque en la calle quedan celulares
 * sin actualizar que siguen mandando la vieja.
 */
const READERS: Record<
  string,
  Record<number, (payload: Record<string, unknown>) => Promise<NormalizedSyncOperation>>
> = {
  [SYNC_OPERATION_TYPES.STOP_MARK]: {
    1: async (payload) => ({
      type: SYNC_OPERATION_TYPES.STOP_MARK,
      payload: await validatedPayload(StopMarkPayloadV1Dto, payload),
    }),
  },
  [SYNC_OPERATION_TYPES.STOP_ADD_VAN_SALE]: {
    1: async (payload) => ({
      type: SYNC_OPERATION_TYPES.STOP_ADD_VAN_SALE,
      payload: await validatedPayload(StopAddVanSalePayloadV1Dto, payload),
    }),
  },
  [SYNC_OPERATION_TYPES.ROUTE_START]: {
    1: async (payload) => ({
      type: SYNC_OPERATION_TYPES.ROUTE_START,
      payload: await validatedPayload(RouteStartPayloadV1Dto, payload),
    }),
  },
};

export function readSyncOperation(
  type: string,
  version: number,
  payload: Record<string, unknown>,
): Promise<NormalizedSyncOperation> {
  const versions = READERS[type];
  if (versions === undefined) {
    throw new BadRequestException(`La operación "${type}" no existe`);
  }
  const reader = versions[version];
  if (reader === undefined) {
    throw new BadRequestException(
      `La operación "${type}" no tiene versión ${version}: actualizá la app`,
    );
  }
  return reader(payload);
}

/**
 * Las mismas reglas que el `ValidationPipe` global (whitelist, nada de campos
 * de más, transform), para que el payload del sobre se lea igual que el
 * cuerpo del PATCH de la web.
 */
async function validatedPayload<T extends object>(
  dtoClass: ClassConstructor<T>,
  payload: Record<string, unknown>,
): Promise<T> {
  const instance = plainToInstance(dtoClass, payload);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    throw new BadRequestException(flattenMessages(errors));
  }
  return instance;
}

function flattenMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenMessages(error.children ?? []),
  ]);
}
