import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";
import { MarkRouteStopDto } from "./mark-route-stop.dto.js";

/**
 * Corregir una parada es volver a marcarla, así que el cuerpo es el mismo que
 * el de marcarla más el motivo. Extiende `MarkRouteStopDto` en vez de repetir
 * sus cuatro sub-DTOs: `DeliverySaleItemDto`, `ContainerReturnDto` y
 * `DeliveryPaymentDto` son idénticos en las dos operaciones y copiarlos sería
 * duplicación pura —dos definiciones del mismo contrato que se despegan a la
 * primera— además de romper el umbral de duplicación del proyecto.
 *
 * `correctionReason` es obligatorio en LAS DOS direcciones. Una corrección
 * siempre contradice algo que ya estaba anotado y firmado por alguien, así que
 * el motivo no es un adorno: es lo único que le explica al que lea la parada
 * mañana por qué dice algo distinto de lo que dijo el chofer. Viaja al
 * `voidReason` de la venta anulada, además de quedar en la parada.
 *
 * `priceOverrideAuthorizedById` se HEREDA pero está prohibido: en una
 * corrección lo pone el servicio, siempre el ADMIN que corrige. `RoutesService`
 * lo rechaza con 400 en vez de este DTO porque el campo viene de la clase base
 * y el `forbidNonWhitelisted` global —el idioma habitual del proyecto para
 * prohibir un campo, que es no declararlo— ya lo tiene en la whitelist.
 */
export class CorrectRouteStopDto extends MarkRouteStopDto {
  @ApiProperty({
    description: "Por qué se corrige lo registrado; queda en la parada y en la venta anulada",
    example: "El chofer dictó 3 y habían sido 2",
  })
  @IsString({ message: "El motivo de la corrección debe ser un texto" })
  @IsNotEmpty({ message: "El motivo de la corrección no puede estar vacío" })
  correctionReason!: string;
}
