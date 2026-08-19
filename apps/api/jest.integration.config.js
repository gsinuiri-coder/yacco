/**
 * Integration test config: real PostgreSQL via Testcontainers.
 * Long timeout covers the image pull on cold CI runners.
 */
import process from "node:process";

export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { types: ["node", "jest"] } }],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["**/test/integration/**/*.int.test.ts"],
  testTimeout: 180000,
  maxWorkers: 1,
  collectCoverage: !!process.env.CI,
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts"],
};
