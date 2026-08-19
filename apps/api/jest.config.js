/**
 * Unit test config. Integration tests live in jest.integration.config.js.
 * The package is ESM ("type": "module"), so ts-jest runs in ESM mode and
 * jest is launched with `node --experimental-vm-modules`.
 */
import process from "node:process";

export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: { types: ["node", "jest"] } }],
  },
  // NodeNext imports carry a .js suffix; map them back to the .ts source.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["**/src/**/*.test.ts"],
  passWithNoTests: true,
  // Only jest.integration.config.js collected coverage before; unit-tested
  // branches (e.g. env validation failure paths) never reached Sonar. Both
  // configs write lcov under coverage/ (already gitignored) but to separate
  // subdirectories so the CI job's two sequential jest runs don't overwrite
  // each other's report — see sonar-project.properties for both paths.
  collectCoverage: !!process.env.CI,
  coverageDirectory: "coverage/unit",
  collectCoverageFrom: ["src/**/*.ts"],
};
