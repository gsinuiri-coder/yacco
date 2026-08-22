import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SlowRequestNotice } from "./slow-request-notice";

describe("SlowRequestNotice", () => {
  it("muestra el aviso cuando show es true", () => {
    render(<SlowRequestNotice show={true} />);

    expect(screen.getByRole("status")).toHaveTextContent("Conectando con el servidor");
  });

  it("no renderiza nada cuando show es false", () => {
    render(<SlowRequestNotice show={false} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
