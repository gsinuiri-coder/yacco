import { jest } from "@jest/globals";
import { reportBootstrapFailure } from "./report-bootstrap-failure.js";

test("logs the error and marks the process for a non-zero exit", () => {
  const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const originalExitCode = process.exitCode;

  try {
    const error = new Error("DB unreachable");
    reportBootstrapFailure(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to start the application:", error);
    expect(process.exitCode).toBe(1);
  } finally {
    consoleErrorSpy.mockRestore();
    process.exitCode = originalExitCode;
  }
});
