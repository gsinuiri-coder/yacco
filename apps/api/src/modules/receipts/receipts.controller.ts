import type { Response } from "express";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard.js";
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { CreateReceiptDto } from "./dto/create-receipt.dto.js";
import { ListReceiptSalesQueryDto, ListReceiptsQueryDto } from "./dto/list-receipts-query.dto.js";
import { PreviewReceiptDto, ReceiptPreviewResponseDto } from "./dto/preview-receipt.dto.js";
import {
  CreateCreditNoteDto,
  MarkReceiptExemptionsDto,
  ReceiptReasonDto,
} from "./dto/receipt-action.dto.js";
import {
  PaginatedReceiptSalesDto,
  PaginatedReceiptsDto,
  ReleaseExemptionResultDto,
  ReceiptDetailDto,
  ReceiptExemptionResultDto,
  ReceiptFileDto,
  ReceiptResponseDto,
  VoidReceiptResultDto,
} from "./dto/receipt-response.dto.js";
import { MAX_RECEIPT_FILE_BYTES } from "./receipt-file.validator.js";
import { type ReceiptUploadedFile, ReceiptFilesService } from "./receipt-files.service.js";
import { ReceiptsService } from "./receipts.service.js";

@ApiTags("receipts")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Se requiere un rol de oficina" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("receipts")
export class ReceiptsController {
  constructor(
    private readonly receiptsService: ReceiptsService,
    private readonly receiptFilesService: ReceiptFilesService,
  ) {}

  @ApiOperation({ summary: "Lista comprobantes con filtros de oficina" })
  @ApiResponse({ status: 200, type: PaginatedReceiptsDto })
  @Get()
  findAll(@Query() query: ListReceiptsQueryDto): Promise<PaginatedReceiptsDto> {
    return this.receiptsService.findAll(query);
  }

  @ApiOperation({ summary: "Lista ventas del cliente según su estado de comprobante" })
  @ApiResponse({ status: 200, type: PaginatedReceiptSalesDto })
  @Get("sales")
  listSales(@Query() query: ListReceiptSalesQueryDto): Promise<PaginatedReceiptSalesDto> {
    return this.receiptsService.listSales(query);
  }

  @ApiOperation({ summary: "Muestra un comprobante con ventas, archivos y auditoría" })
  @ApiResponse({ status: 200, type: ReceiptDetailDto })
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<ReceiptDetailDto> {
    return this.receiptsService.findOne(id);
  }

  @ApiOperation({ summary: "Adjunta un archivo privado a un comprobante" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
      required: ["file"],
    },
  })
  @ApiResponse({ status: 201, type: ReceiptFileDto })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_RECEIPT_FILE_BYTES } }))
  @Post(":id/files")
  uploadFile(
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: ReceiptUploadedFile | undefined,
  ): Promise<ReceiptFileDto> {
    if (file === undefined) throw new BadRequestException("El archivo es obligatorio");
    return this.receiptFilesService.upload(id, file);
  }

  @ApiOperation({ summary: "Sirve un archivo de comprobante solo con sesión" })
  @ApiResponse({
    status: 200,
    content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
  })
  @Get(":id/files/:fileName/raw")
  async getRawFile(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("fileName") fileName: string,
    @Res() response: Response,
  ): Promise<void> {
    const raw = await this.receiptFilesService.get(id, fileName);
    response.setHeader("Content-Type", raw.contentType);
    if (raw.contentLength !== undefined) {
      response.setHeader("Content-Length", raw.contentLength);
    }
    response.setHeader("Cache-Control", "private, no-cache");
    raw.stream.pipe(response);
  }

  @ApiOperation({
    summary: "Calcula base, IGV y total desde las ventas antes de registrar el comprobante",
  })
  @ApiResponse({ status: 200, type: ReceiptPreviewResponseDto })
  @ApiBadRequestResponse({ description: "Ventas o documento del cliente inválidos" })
  @ApiConflictResponse({ description: "Datos fiscales faltantes o venta ya comprobada" })
  @HttpCode(200)
  @Post("preview")
  preview(@Body() dto: PreviewReceiptDto): Promise<ReceiptPreviewResponseDto> {
    return this.receiptsService.preview(dto);
  }

  @ApiOperation({ summary: "Registra una boleta o factura sobre ventas completas" })
  @ApiResponse({ status: 201, type: ReceiptResponseDto })
  @Post()
  create(
    @Body() dto: CreateReceiptDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReceiptResponseDto> {
    return this.receiptsService.create(dto, request.user.sub);
  }

  @ApiOperation({ summary: "Marca una o varias ventas como No lleva comprobante" })
  @ApiResponse({ status: 201, type: ReceiptExemptionResultDto })
  @Post("exemptions")
  markExemptions(
    @Body() dto: MarkReceiptExemptionsDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReceiptExemptionResultDto> {
    return this.receiptsService.markExemptions(dto, request.user.sub);
  }

  @ApiOperation({ summary: "Anula un comprobante y libera todas sus ventas (solo ADMIN)" })
  @ApiResponse({ status: 200, type: VoidReceiptResultDto })
  @Roles(UserRole.ADMIN)
  @Patch(":id/void")
  void(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReceiptReasonDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<VoidReceiptResultDto> {
    return this.receiptsService.void(id, dto, request.user.sub);
  }

  @ApiOperation({ summary: "Libera manualmente una marca No lleva comprobante (solo ADMIN)" })
  @ApiResponse({ status: 200, type: ReleaseExemptionResultDto })
  @Roles(UserRole.ADMIN)
  @Patch("exemptions/:id/release")
  releaseExemption(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReceiptReasonDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReleaseExemptionResultDto> {
    return this.receiptsService.releaseExemption(id, dto, request.user.sub);
  }

  @ApiOperation({ summary: "Registra una nota de crédito y libera las ventas del original" })
  @ApiResponse({ status: 201, type: ReceiptResponseDto })
  @Post(":id/credit-notes")
  createCreditNote(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateCreditNoteDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReceiptResponseDto> {
    return this.receiptsService.createCreditNote(id, dto, request.user.sub);
  }
}
