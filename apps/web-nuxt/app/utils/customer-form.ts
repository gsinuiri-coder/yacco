import { isMoneyInput } from "@yacco/shared";
import type { CreateCustomerBody, Customer, UpdateCustomerBody } from "@yacco/shared";

/** Lo que el formulario edita. `debtBalance` no está: es un saldo del libro, no se escribe. */
export interface CustomerFormValues {
  name: string;
  phone: string;
  address: string;
  addressReference: string;
  documentType: string;
  documentNumber: string;
  legalName: string;
  fiscalAddress: string;
  /** "" es "Sin zona". */
  zoneId: string;
  creditLimit: string;
  active: boolean;
}

export type CustomerFormErrors = Partial<Record<keyof CustomerFormValues, string>>;

export interface ZoneOption {
  id: string;
  name: string;
}

export function blankCustomerForm(): CustomerFormValues {
  return {
    name: "",
    phone: "",
    address: "",
    addressReference: "",
    documentType: "",
    documentNumber: "",
    legalName: "",
    fiscalAddress: "",
    zoneId: "",
    creditLimit: "",
    active: true,
  };
}

export function formFromCustomer(customer: Customer): CustomerFormValues {
  return {
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    addressReference: customer.addressReference,
    documentType: customer.documentType ?? "",
    documentNumber: customer.documentNumber ?? "",
    legalName: customer.legalName ?? "",
    fiscalAddress: customer.fiscalAddress ?? "",
    zoneId: customer.zoneId ?? "",
    creditLimit: customer.creditLimit ?? "",
    active: customer.active,
  };
}

/** Obligatorio y con tope, como CreateCustomerDto: misma respuesta sin ir a la API. */
const REQUIRED_TEXT: ReadonlyArray<{
  key: "name" | "phone" | "address" | "addressReference";
  max: number;
  missing: string;
  tooLong: string;
}> = [
  { key: "name", max: 160, missing: "El nombre es obligatorio", tooLong: "El nombre" },
  { key: "phone", max: 30, missing: "El teléfono es obligatorio", tooLong: "El teléfono" },
  { key: "address", max: 255, missing: "La dirección es obligatoria", tooLong: "La dirección" },
  {
    key: "addressReference",
    max: 255,
    missing: "La referencia de dirección es obligatoria",
    tooLong: "La referencia",
  },
];

export function checkCustomerForm(values: CustomerFormValues): CustomerFormErrors {
  const errors: CustomerFormErrors = {};
  for (const rule of REQUIRED_TEXT) {
    const text = values[rule.key].trim();
    if (text === "") errors[rule.key] = rule.missing;
    else if (text.length > rule.max)
      errors[rule.key] = `${rule.tooLong} no puede superar los ${rule.max} caracteres`;
  }
  const limit = values.creditLimit.trim();
  if (limit !== "" && !isMoneyInput(limit)) {
    errors.creditLimit = 'El límite de crédito debe ser un monto como "150.00"';
  }

  const docType = values.documentType.trim();
  const docNum = values.documentNumber.trim();
  if (docType !== "" && docNum === "") {
    errors.documentNumber = "El número de documento es obligatorio si se indica el tipo";
  } else if (docNum !== "" && docType === "") {
    errors.documentType = "El tipo de documento es obligatorio si se indica el número";
  } else if (docType === "RUC" && !/^\d{11}$/.test(docNum)) {
    errors.documentNumber = "El RUC debe tener 11 dígitos";
  } else if (docType === "DNI" && !/^\d{8}$/.test(docNum)) {
    errors.documentNumber = "El DNI debe tener 8 dígitos";
  } else if (docType === "CE" && !/^[A-Za-z0-9]{4,20}$/.test(docNum)) {
    errors.documentNumber = "El carné de extranjería debe tener entre 4 y 20 caracteres";
  }

  return errors;
}

/**
 * Los opcionales en blanco NO viajan: `zoneId: ""` falla el @IsUUID de la API,
 * y ni zona ni límite tienen contrato para "borrar" con null. Omitirlos deja el
 * valor guardado como está. El límite viaja como string, nunca como número.
 */
function commonBody(values: CustomerFormValues): CreateCustomerBody {
  const zoneId = values.zoneId.trim();
  const creditLimit = values.creditLimit.trim();
  const docType = values.documentType.trim();
  const docNum = values.documentNumber.trim();
  const legalName = values.legalName.trim();
  const fiscalAddress = values.fiscalAddress.trim();
  return {
    name: values.name.trim(),
    phone: values.phone.trim(),
    address: values.address.trim(),
    addressReference: values.addressReference.trim(),
    ...(zoneId === "" ? {} : { zoneId }),
    ...(creditLimit === "" ? {} : { creditLimit }),
    ...(docType === "" ? {} : { documentType: docType }),
    ...(docNum === "" ? {} : { documentNumber: docNum }),
    ...(legalName === "" ? {} : { legalName }),
    ...(fiscalAddress === "" ? {} : { fiscalAddress }),
  };
}

export function createBodyFrom(values: CustomerFormValues): CreateCustomerBody {
  return commonBody(values);
}

export function updateBodyFrom(values: CustomerFormValues): UpdateCustomerBody {
  const docType = values.documentType.trim();
  const docNum = values.documentNumber.trim();
  const legalName = values.legalName.trim();
  const fiscalAddress = values.fiscalAddress.trim();
  return {
    ...commonBody(values),
    documentType: docType || null,
    documentNumber: docNum || null,
    legalName: legalName || null,
    fiscalAddress: fiscalAddress || null,
    active: values.active,
  };
}

/**
 * El catálogo de zonas llega sólo con las activas. Un cliente asignado a una
 * zona que después se retiró la conserva, y el selector tiene que seguir
 * ofreciéndola: si no, guardar sin tocar nada le borraría la zona en silencio.
 */
export function zonesIncludingAssigned(zones: ZoneOption[], customer: Customer): ZoneOption[] {
  const assigned = customer.zone;
  if (assigned === null || zones.some((zone) => zone.id === assigned.id)) return zones;
  return [...zones, { id: assigned.id, name: `${assigned.name} (retirada)` }];
}
