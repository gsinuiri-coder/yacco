import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard.js";
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { SyncBatchDto } from "./dto/sync-batch.dto.js";
import {
  ResolveSyncOperationDto,
  SyncBatchResultDto,
  SyncOperationInReviewDto,
  SyncOperationResolutionDto,
} from "./dto/sync-response.dto.js";
import { SyncService } from "./sync.service.js";

@ApiTags("sync")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("sync/operations")
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @ApiOperation({
    summary: "Recibe un lote de operaciones de la app del chofer",
    description:
      "Una transacción por lote. Idempotente por id: una operación ya aplicada vuelve DUPLICATE. Una operación rechazada no frena al resto del lote.",
  })
  @ApiResponse({ status: HttpStatus.OK, type: SyncBatchResultDto })
  @ApiBadRequestResponse({ description: "El sobre del lote no es válido" })
  @Roles(UserRole.DRIVER)
  @HttpCode(HttpStatus.OK)
  @Post()
  apply(
    @Body() dto: SyncBatchDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<SyncBatchResultDto> {
    return this.syncService.applyBatch(dto, {
      id: request.user.sub,
      roles: request.user.roles,
    });
  }

  @ApiOperation({ summary: "Operaciones en revisión: en cuarentena y sin resolver" })
  @ApiResponse({ status: HttpStatus.OK, type: SyncOperationInReviewDto, isArray: true })
  @Roles(UserRole.ADMIN)
  @Get("in-review")
  listInReview(): Promise<SyncOperationInReviewDto[]> {
    return this.syncService.listInReview();
  }

  @ApiOperation({ summary: "La oficina da por revisada una operación en cuarentena" })
  @ApiResponse({ status: HttpStatus.OK, type: SyncOperationResolutionDto })
  @ApiNotFoundResponse({ description: "La operación no está en revisión" })
  @ApiConflictResponse({ description: "La operación ya fue revisada" })
  @Roles(UserRole.ADMIN)
  @Patch(":id/resolution")
  resolve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResolveSyncOperationDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<SyncOperationResolutionDto> {
    return this.syncService.resolve(id, dto, request.user.sub);
  }
}
