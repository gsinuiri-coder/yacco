import type { Response } from "express";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
import { CustomerLocationsService } from "./customer-locations.service.js";
import { CreateCoordinateRequestDto } from "./dto/create-coordinate-request.dto.js";
import { CustomerLocationCoordinateRequestResponseDto } from "./dto/customer-location-coordinate-request-response.dto.js";
import { CustomerLocationPhotoResponseDto } from "./dto/customer-location-photo-response.dto.js";
import { HidePhotoDto } from "./dto/hide-photo.dto.js";
import { ReviewCoordinateRequestDto } from "./dto/review-coordinate-request.dto.js";
import { ReviewPhotoDto } from "./dto/review-photo.dto.js";

@ApiTags("customer-locations")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("customer-locations")
export class CustomerLocationOperationsController {
  constructor(private readonly customerLocationsService: CustomerLocationsService) {}

  @ApiOperation({ summary: "Lista las fotos visibles o autorizadas de un local" })
  @ApiResponse({ status: 200, type: CustomerLocationPhotoResponseDto, isArray: true })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Get(":id/photos")
  findPhotos(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CustomerLocationPhotoResponseDto[]> {
    return this.customerLocationsService.findPhotos(id, req.user);
  }

  @ApiOperation({
    summary: "Sube una foto para un local (oficina aprueba directo, chofer crea solicitud)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiResponse({ status: 201, type: CustomerLocationPhotoResponseDto })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @UseInterceptors(FileInterceptor("file"))
  @Post(":id/photos")
  uploadPhoto(
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile()
    file:
      | {
          buffer: Buffer;
          originalname?: string;
          mimetype?: string;
          size?: number;
        }
      | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<CustomerLocationPhotoResponseDto> {
    if (!file) {
      throw new BadRequestException("El archivo es obligatorio");
    }
    return this.customerLocationsService.uploadPhoto(id, file, req.user);
  }

  @ApiOperation({ summary: "Sirve el contenido binario de una foto con sesión" })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Get("photos/:photoId/raw")
  async getRawPhoto(
    @Param("photoId", ParseUUIDPipe) photoId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const raw = await this.customerLocationsService.getRawPhoto(photoId, req.user);
    res.setHeader("Content-Type", raw.contentType);
    res.setHeader("Content-Length", raw.sizeBytes);
    res.setHeader("Cache-Control", "private, no-cache");
    raw.stream.pipe(res);
  }

  @ApiOperation({ summary: "Oculta una foto con motivo obligatorio (solo ADMIN)" })
  @ApiResponse({ status: 200, type: CustomerLocationPhotoResponseDto })
  @ApiForbiddenResponse({ description: "Solo ADMIN puede ocultar fotos" })
  @Roles(UserRole.ADMIN)
  @Patch("photos/:photoId/hide")
  hidePhoto(
    @Param("photoId", ParseUUIDPipe) photoId: string,
    @Body() dto: HidePhotoDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CustomerLocationPhotoResponseDto> {
    return this.customerLocationsService.hidePhoto(photoId, dto.reason, req.user.sub);
  }

  @ApiOperation({ summary: "Aprueba o rechaza una solicitud de foto (solo ADMIN)" })
  @ApiResponse({ status: 200, type: CustomerLocationPhotoResponseDto })
  @ApiForbiddenResponse({ description: "Solo ADMIN puede revisar fotos" })
  @Roles(UserRole.ADMIN)
  @Patch("photos/:photoId/review")
  reviewPhoto(
    @Param("photoId", ParseUUIDPipe) photoId: string,
    @Body() dto: ReviewPhotoDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CustomerLocationPhotoResponseDto> {
    return this.customerLocationsService.reviewPhoto(photoId, dto, req.user.sub);
  }

  @ApiOperation({ summary: "Lista las solicitudes de coordenadas de un local" })
  @ApiResponse({ status: 200, type: CustomerLocationCoordinateRequestResponseDto, isArray: true })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get(":id/coordinate-requests")
  findCoordinateRequests(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CustomerLocationCoordinateRequestResponseDto[]> {
    return this.customerLocationsService.findCoordinateRequests(id);
  }

  @ApiOperation({ summary: "Propone coordenadas para un local (solicitud pendiente)" })
  @ApiResponse({ status: 201, type: CustomerLocationCoordinateRequestResponseDto })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Post(":id/coordinate-requests")
  createCoordinateRequest(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateCoordinateRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CustomerLocationCoordinateRequestResponseDto> {
    return this.customerLocationsService.createCoordinateRequest(id, dto, req.user);
  }

  @ApiOperation({ summary: "Aprueba o rechaza una solicitud de coordenadas (solo ADMIN)" })
  @ApiResponse({ status: 200, type: CustomerLocationCoordinateRequestResponseDto })
  @ApiNotFoundResponse({ description: "Solicitud no existe" })
  @ApiForbiddenResponse({ description: "Solo ADMIN puede revisar coordenadas" })
  @Roles(UserRole.ADMIN)
  @Patch("coordinate-requests/:requestId/review")
  reviewCoordinateRequest(
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() dto: ReviewCoordinateRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CustomerLocationCoordinateRequestResponseDto> {
    return this.customerLocationsService.reviewCoordinateRequest(requestId, dto, req.user.sub);
  }
}
