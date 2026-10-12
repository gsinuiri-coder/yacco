import { BadRequestException } from "@nestjs/common";

export interface ValidatedImage {
  contentType: string;
  extension: string;
}

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateImageFile(buffer: Buffer): ValidatedImage {
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new BadRequestException("La foto no puede superar los 5 MB");
  }

  // JPEG: 0xFF, 0xD8, 0xFF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }

  // PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }

  // WebP: RIFF at 0..3, WEBP at 8..11
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }

  throw new BadRequestException("Formato no permitido: solo se aceptan imágenes JPEG, PNG o WebP");
}
