import { MAX_PHOTO_BYTES, validateImageFile } from "./image-file.validator.js";

describe("validateImageFile", () => {
  it("accepts valid JPEG buffer", () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = validateImageFile(jpegBuffer);
    expect(result).toEqual({ contentType: "image/jpeg", extension: "jpg" });
  });

  it("accepts valid PNG buffer", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const result = validateImageFile(pngBuffer);
    expect(result).toEqual({ contentType: "image/png", extension: "png" });
  });

  it("accepts valid WebP buffer", () => {
    const webpBuffer = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP"),
      Buffer.from("VP8 "),
    ]);
    const result = validateImageFile(webpBuffer);
    expect(result).toEqual({ contentType: "image/webp", extension: "webp" });
  });

  it("rejects text file disguised as jpg (validating real content magic bytes)", () => {
    const textBuffer = Buffer.from("This is a plain text file pretending to be image.jpg");
    expect(() => validateImageFile(textBuffer)).toThrow(
      "Formato no permitido: solo se aceptan imágenes JPEG, PNG o WebP",
    );
  });

  it("rejects file exceeding 5 MB limit", () => {
    // 5 MB + 1 byte
    const largeBuffer = Buffer.alloc(MAX_PHOTO_BYTES + 1);
    largeBuffer[0] = 0xff;
    largeBuffer[1] = 0xd8;
    largeBuffer[2] = 0xff;

    expect(() => validateImageFile(largeBuffer)).toThrow("La foto no puede superar los 5 MB");
  });
});
