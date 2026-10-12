import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

export interface StorageObject {
  stream: Readable;
  contentType: string;
  contentLength?: number | undefined;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;
  private readonly bucket: string;
  private bucketEnsured = false;

  constructor(private readonly configService: ConfigService) {
    const bucket = this.configService.get<string>("S3_BUCKET") || "yacco-photos";
    this.bucket = bucket;

    const endpoint = this.configService.get<string>("S3_ENDPOINT");
    const region = this.configService.get<string>("S3_REGION") || "us-east-1";
    const accessKeyId = this.configService.get<string>("S3_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>("S3_SECRET_ACCESS_KEY");
    const forcePathStyle =
      this.configService.get<string>("S3_FORCE_PATH_STYLE") === "true" || !!endpoint;

    if (endpoint || (accessKeyId && secretAccessKey)) {
      this.client = new S3Client({
        region,
        ...(endpoint ? { endpoint } : {}),
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
        forcePathStyle,
      });
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async ensureBucket(): Promise<void> {
    if (!this.client || this.bucketEnsured) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketEnsured = true;
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.bucketEnsured = true;
      } catch (err) {
        this.logger.warn(
          `No se pudo asegurar el bucket "${this.bucket}": ${(err as Error).message}`,
        );
      }
    }
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (!this.client) {
      throw new ServiceUnavailableException("El almacenamiento de fotos no está configurado");
    }
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StorageObject> {
    if (!this.client) {
      throw new ServiceUnavailableException("El almacenamiento de fotos no está configurado");
    }
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    if (!response.Body) {
      throw new Error(`El archivo "${key}" no tiene contenido`);
    }
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType ?? "application/octet-stream",
      contentLength: response.ContentLength,
    };
  }
}
