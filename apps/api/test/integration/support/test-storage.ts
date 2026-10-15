import { createRequire } from "node:module";

interface GenericContainerType {
  withCommand(command: string[]): this;
  withEnvironment(environment: Record<string, string>): this;
  withExposedPorts(...ports: number[]): this;
  start(): Promise<StartedTestStorage>;
}

export interface StartedTestStorage {
  getHost(): string;
  getMappedPort(port: number): number;
  stop(): Promise<void>;
}

const require = createRequire(import.meta.url);
const testcontainersPath = require.resolve("testcontainers", {
  paths: [require.resolve("@testcontainers/postgresql")],
});
const { GenericContainer } = (await import(
  `file:///${testcontainersPath.replace(/\\/g, "/")}`
)) as {
  GenericContainer: new (image: string) => GenericContainerType;
};

export async function startTestStorage(bucket: string): Promise<StartedTestStorage> {
  const image = process.env.TESTCONTAINERS_MINIO_IMAGE ?? "cgr.dev/chainguard/minio:latest";
  const container = await new GenericContainer(image)
    .withCommand(["server", "/data"])
    .withEnvironment({
      MINIO_ROOT_USER: "miniotest",
      MINIO_ROOT_PASSWORD: "miniopassword123",
    })
    .withExposedPorts(9000)
    .start();

  process.env.S3_ENDPOINT = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  process.env.S3_BUCKET = bucket;
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "miniotest";
  process.env.S3_SECRET_ACCESS_KEY = "miniopassword123";
  process.env.S3_FORCE_PATH_STYLE = "true";
  return container;
}
