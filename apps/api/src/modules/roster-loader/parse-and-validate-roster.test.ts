import { parseAndValidateRoster } from "./parse-and-validate-roster.js";
import type { RosterSourceFiles } from "./parse-and-validate-roster.js";

const CUSTOMERS_HEADER = "external_code,name,phone,zone,status,notes";
const LOCATIONS_HEADER = "location_code,customer_code,label,address,zone,maps_url,is_primary";
const CONTAINERS_HEADER = "location_code,qty_spout,qty_no_spout,confidence,notes";
const MONEY_HEADER = "customer_code,amount,notes";

/** A minimal, self-consistent set of the 4 files: one customer, one primary location. */
function validFiles(overrides: Partial<RosterSourceFiles> = {}): RosterSourceFiles {
  return {
    customersText: `${CUSTOMERS_HEADER}\nC-1,Cliente Uno,987654321,Surco,ACTIVE,\n`,
    locationsText: `${LOCATIONS_HEADER}\nL-1,C-1,Casa,Jr. Uno 1,Surco,,SI\n`,
    containersText: `${CONTAINERS_HEADER}\nL-1,2,0,HIGH,\n`,
    moneyText: `${MONEY_HEADER}\nC-1,45.00,\n`,
    ...overrides,
  };
}

describe("parseAndValidateRoster — happy path", () => {
  it("parses a self-consistent set of files into a ValidatedRoster with zero issues", () => {
    const result = parseAndValidateRoster(validFiles());

    expect(result.issues).toEqual([]);
    expect(result.roster).toBeDefined();
    expect(result.roster?.customers).toEqual([
      {
        externalCode: "C-1",
        name: "Cliente Uno",
        phone: "987654321",
        zoneName: "Surco",
        status: "ACTIVE",
        line: 2,
      },
    ]);
    expect(result.roster?.locationsByCustomerCode.get("C-1")).toEqual([
      {
        locationCode: "L-1",
        customerCode: "C-1",
        label: "Casa",
        address: "Jr. Uno 1",
        addressReference: "",
        isPrimary: true,
        line: 2,
      },
    ]);
    expect(result.roster?.containersByLocationCode.get("L-1")).toMatchObject({
      qtySpout: 2,
      qtyNoSpout: 0,
      confidence: "HIGH",
    });
    expect(result.roster?.moneyByCustomerCode.get("C-1")).toEqual({
      customerCode: "C-1",
      amount: "45.00",
      line: 2,
    });
  });

  it("normalizes an empty zone cell to null", () => {
    const result = parseAndValidateRoster(
      validFiles({ customersText: `${CUSTOMERS_HEADER}\nC-1,Cliente Uno,987654321,,ACTIVE,\n` }),
    );

    expect(result.roster?.customers[0]?.zoneName).toBeNull();
  });

  it("maps_url becomes addressReference, and address may be empty", () => {
    const result = parseAndValidateRoster(
      validFiles({
        locationsText: `${LOCATIONS_HEADER}\nL-1,C-1,Casa,,Surco,https://maps.example/x,SI\n`,
      }),
    );

    const location = result.roster?.locationsByCustomerCode.get("C-1")?.[0];
    expect(location?.address).toBe("");
    expect(location?.addressReference).toBe("https://maps.example/x");
  });

  it("a blank amount is treated as 0 (not an error), and 0.00 is valid too", () => {
    const result = parseAndValidateRoster(validFiles({ moneyText: `${MONEY_HEADER}\nC-1,,\n` }));
    expect(result.issues).toEqual([]);
    expect(result.roster?.moneyByCustomerCode.get("C-1")?.amount).toBe("0");
  });

  it("a customer absent from opening_money.csv simply has no money row", () => {
    const result = parseAndValidateRoster(validFiles({ moneyText: `${MONEY_HEADER}\n` }));
    expect(result.issues).toEqual([]);
    expect(result.roster?.moneyByCustomerCode.has("C-1")).toBe(false);
  });

  it("a negative amount (credit) is accepted", () => {
    const result = parseAndValidateRoster(
      validFiles({ moneyText: `${MONEY_HEADER}\nC-1,-60.00,\n` }),
    );
    expect(result.issues).toEqual([]);
    expect(result.roster?.moneyByCustomerCode.get("C-1")?.amount).toBe("-60.00");
  });

  it("a second, non-primary location for the same customer is accepted", () => {
    const result = parseAndValidateRoster(
      validFiles({
        locationsText: `${LOCATIONS_HEADER}\nL-1,C-1,Casa,Jr. Uno 1,Surco,,SI\nL-2,C-1,Depósito,Jr. Dos 2,Surco,,NO\n`,
      }),
    );
    expect(result.issues).toEqual([]);
    expect(result.roster?.locationsByCustomerCode.get("C-1")).toHaveLength(2);
  });
});

describe("parseAndValidateRoster — every listed validation, and none of them stop the others", () => {
  it("catches a duplicate external_code", () => {
    const result = parseAndValidateRoster(
      validFiles({
        customersText: `${CUSTOMERS_HEADER}\nC-1,Uno,1,Surco,ACTIVE,\nC-1,Otro,2,Surco,ACTIVE,\n`,
      }),
    );
    expect(result.roster).toBeUndefined();
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "customers.csv",
        line: 3,
        message: expect.stringContaining("external_code duplicado"),
      }),
    );
  });

  it("catches a duplicate location_code", () => {
    const result = parseAndValidateRoster(
      validFiles({
        locationsText: `${LOCATIONS_HEADER}\nL-1,C-1,Casa,X,Surco,,SI\nL-1,C-1,Otra,Y,Surco,,NO\n`,
      }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "locations.csv",
        message: expect.stringContaining("location_code duplicado"),
      }),
    );
  });

  it("catches a customer_code orphan in locations.csv", () => {
    const result = parseAndValidateRoster(
      validFiles({ locationsText: `${LOCATIONS_HEADER}\nL-1,NOPE,Casa,X,Surco,,SI\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "locations.csv",
        message: expect.stringContaining("customer_code huérfano"),
      }),
    );
  });

  it("catches a customer_code orphan in opening_money.csv", () => {
    const result = parseAndValidateRoster(
      validFiles({ moneyText: `${MONEY_HEADER}\nNOPE,10.00,\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "opening_money.csv",
        message: expect.stringContaining("customer_code huérfano"),
      }),
    );
  });

  it("catches a customer with NO primary location", () => {
    const result = parseAndValidateRoster(
      validFiles({ locationsText: `${LOCATIONS_HEADER}\nL-1,C-1,Casa,X,Surco,,NO\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "customers.csv",
        message: expect.stringContaining("no tiene ubicación primaria"),
      }),
    );
  });

  it("catches a customer with MORE THAN ONE primary location", () => {
    const result = parseAndValidateRoster(
      validFiles({
        locationsText: `${LOCATIONS_HEADER}\nL-1,C-1,Casa,X,Surco,,SI\nL-2,C-1,Depósito,Y,Surco,,SI\n`,
      }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "locations.csv",
        line: 3,
        message: expect.stringContaining("más de una ubicación primaria"),
      }),
    );
  });

  it("catches status out of range", () => {
    const result = parseAndValidateRoster(
      validFiles({ customersText: `${CUSTOMERS_HEADER}\nC-1,Uno,1,Surco,PENDIENTE,\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "customers.csv",
        message: expect.stringContaining("status fuera de rango"),
      }),
    );
  });

  it("catches is_primary out of range", () => {
    const result = parseAndValidateRoster(
      validFiles({ locationsText: `${LOCATIONS_HEADER}\nL-1,C-1,Casa,X,Surco,,MAYBE\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "locations.csv",
        message: expect.stringContaining("is_primary fuera de rango"),
      }),
    );
  });

  it("catches confidence out of range", () => {
    const result = parseAndValidateRoster(
      validFiles({ containersText: `${CONTAINERS_HEADER}\nL-1,2,0,MEDIUM,\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "opening_containers.csv",
        message: expect.stringContaining("confidence fuera de rango"),
      }),
    );
  });

  it("catches a negative container quantity", () => {
    const result = parseAndValidateRoster(
      validFiles({ containersText: `${CONTAINERS_HEADER}\nL-1,-2,0,HIGH,\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "opening_containers.csv",
        message: expect.stringContaining("qty_spout no puede ser negativo"),
      }),
    );
  });

  it("catches a non-numeric container quantity", () => {
    const result = parseAndValidateRoster(
      validFiles({ containersText: `${CONTAINERS_HEADER}\nL-1,dos,0,HIGH,\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "opening_containers.csv",
        message: expect.stringContaining("qty_spout debe ser un número entero"),
      }),
    );
  });

  it("catches a location_code orphan in opening_containers.csv", () => {
    const result = parseAndValidateRoster(
      validFiles({ containersText: `${CONTAINERS_HEADER}\nNOPE,2,0,HIGH,\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "opening_containers.csv",
        message: expect.stringContaining("location_code huérfano"),
      }),
    );
  });

  it("catches an unparseable amount", () => {
    const result = parseAndValidateRoster(
      validFiles({ moneyText: `${MONEY_HEADER}\nC-1,150,00,\n` }),
    );
    // "150,00" (comma decimal) splits into 4 CSV columns against a 3-column
    // header, so this is caught as a column-count mismatch — still an issue,
    // still zero writes, which is what matters here.
    expect(result.roster).toBeUndefined();
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("a genuinely unparseable amount (extra characters, still 3 columns) is caught by name", () => {
    const result = parseAndValidateRoster(
      validFiles({ moneyText: `${MONEY_HEADER}\nC-1,150 soles,\n` }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "opening_money.csv",
        message: expect.stringContaining("amount no es un monto válido"),
      }),
    );
  });

  it("collects issues from ALL 4 files at once, not just the first", () => {
    const result = parseAndValidateRoster({
      customersText: `${CUSTOMERS_HEADER}\nC-1,Uno,1,Surco,PENDIENTE,\n`,
      locationsText: `${LOCATIONS_HEADER}\nL-1,C-1,Casa,X,Surco,,MAYBE\n`,
      containersText: `${CONTAINERS_HEADER}\nL-1,-2,0,HIGH,\n`,
      moneyText: `${MONEY_HEADER}\nC-1,abc,\n`,
    });

    const files = new Set(result.issues.map((issue) => issue.file));
    expect(files).toEqual(
      new Set(["customers.csv", "locations.csv", "opening_containers.csv", "opening_money.csv"]),
    );
  });

  it("rejects an unexpected header outright, without touching row data", () => {
    const result = parseAndValidateRoster(
      validFiles({ customersText: "codigo,nombre\nC-1,Uno\n" }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: "customers.csv",
        line: 1,
        message: expect.stringContaining("Encabezado inesperado"),
      }),
    );
  });
});
