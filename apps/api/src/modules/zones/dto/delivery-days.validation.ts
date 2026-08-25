import { Weekday } from "@prisma/client";
import { ArrayUnique, IsArray, IsEnum } from "class-validator";

/**
 * Shared by create and update: a list of Weekday values with no repeats.
 * The array itself may be empty — see CreateZoneDto for why — so there is
 * deliberately no @ArrayMinSize here.
 */
export function IsDeliveryDays(): PropertyDecorator {
  const decorators = [
    IsArray({ message: "Los días de reparto deben ser una lista" }),
    IsEnum(Weekday, { each: true, message: "Uno de los días de reparto no es válido" }),
    ArrayUnique({ message: "Un día de reparto no puede repetirse" }),
  ];
  return (target, propertyKey) => {
    for (const decorator of decorators) decorator(target, propertyKey);
  };
}
