import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { CreateProductionBatchDto } from "./dto/create-production-batch.dto.js";
import {
  CreateProductionBatchResponseDto,
  PaginatedProductionBatchesDto,
  ProductionBatchResponseDto,
} from "./dto/production-batch-response.dto.js";
import { ListProductionBatchesQueryDto } from "./dto/list-production-batches-query.dto.js";
import { ProductionBatchesService } from "./production-batches.service.js";

/**
 * Capture is ADMIN-only (spec HU-01): production is a plant-floor decision,
 * not office data entry by any role. There is deliberately no PATCH/DELETE —
 * a batch mistake is corrected with inverse movements, never by editing the
 * past (the ledger it emits is append-only). Reading is open to SELLER too:
 * a seller taking orders needs to know whether there was production today.
 */
@ApiTags("production-batches")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("production-batches")
export class ProductionBatchesController {
  constructor(private readonly productionBatchesService: ProductionBatchesService) {}

  @ApiOperation({ summary: "Registra un lote de producción y emite sus movimientos FILLING" })
  @ApiResponse({ status: 201, type: CreateProductionBatchResponseDto })
  @ApiBadRequestResponse({
    description:
      "Validation failed, a container type does not exist or is inactive, or a repeated line",
  })
  @ApiConflictResponse({ description: "A batch with this code already exists" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
  @Roles(UserRole.ADMIN)
  @Post()
  create(
    @Body() dto: CreateProductionBatchDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CreateProductionBatchResponseDto> {
    // filledById comes from the access token, never from the body.
    return this.productionBatchesService.create(dto, request.user.sub);
  }

  @ApiOperation({
    summary: "Lista lotes de producción paginados, con filtro por rango de fechas y por stock",
    description:
      "Ordenados por fecha ascendente, que es el orden FIFO de consumo; ?withStock=true es lo que la carga de ruta necesita",
  })
  @ApiResponse({ status: 200, type: PaginatedProductionBatchesDto })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get()
  findAll(@Query() query: ListProductionBatchesQueryDto): Promise<PaginatedProductionBatchesDto> {
    return this.productionBatchesService.findAll(query);
  }

  // Sin consumidor en apps/web, y así se queda: pasa por el mismo
  // BATCH_INCLUDE y el mismo toBatchResponse que el listado, así que devuelve
  // exactamente un elemento de esa lista — la pantalla de producción ya tiene
  // el lote entero, con sus líneas, sin pedirlo de nuevo. Quien lo va a
  // necesitar es el móvil, que carga el camión contra un lote puntual (spec
  // §4.3, POST /sync/operations). Ver docs/estado-por-modulo.md.
  @ApiOperation({ summary: "Lote de producción con sus líneas" })
  @ApiResponse({ status: 200, type: ProductionBatchResponseDto })
  @ApiNotFoundResponse({ description: "Batch id does not exist" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<ProductionBatchResponseDto> {
    return this.productionBatchesService.findOne(id);
  }
}
