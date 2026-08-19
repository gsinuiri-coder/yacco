/**
 * Unit test config. Integration tests live in jest.integration.config.js.
 * The package is ESM ("type": "module"), so ts-jest runs in ESM mode and
 * jest is launched with `node --experimental-vm-modules`.
 */
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
};
