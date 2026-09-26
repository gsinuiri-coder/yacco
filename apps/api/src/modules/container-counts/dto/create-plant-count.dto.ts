import { ApiProperty } from "@nestjs/swagger";
import { ContainerState } from "@prisma/client";
import { IsIn, IsInt, IsUUID, Min } from "class-validator";

/** Los dos estados de la planta que se cuentan a mano en el galpón. */
export const PLANT_COUNT_STATES = [
  ContainerState.EMPTY_AT_PLANT,
  ContainerState.FULL_AT_PLANT,
] as const;
export type PlantCountState = (typeof PLANT_COUNT_STATES)[number];

/**
 * Sin fecha, igual que `CreateContainerCountDto`: el conteo vale en el
 * momento en que se anota.
 */
export class CreatePlantCountDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El tipo de envase debe ser un identificador válido" })
  containerTypeId!: string;

  @ApiProperty({ enum: PLANT_COUNT_STATES })
  @IsIn(PLANT_COUNT_STATES, { message: "Se cuentan los vacíos o los llenos en planta" })
  state!: PlantCountState;

  @ApiProperty({ minimum: 0, example: 40 })
  @IsInt({ message: "La cantidad contada debe ser un número entero" })
  @Min(0, { message: "La cantidad contada no puede ser negativa" })
  countedQuantity!: number;
}
