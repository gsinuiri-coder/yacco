export function validateCustomerDocument(
  documentType?: string | null,
  documentNumber?: string | null,
): string | null {
  const type = documentType?.trim() || null;
  const num = documentNumber?.trim() || null;

  if (!type && !num) return null;
  if (!type && num) return "El tipo de documento es obligatorio si se indica el número";
  if (type && !num) return "El número de documento es obligatorio si se indica el tipo";

  if (type === "RUC") {
    if (!/^\d{11}$/.test(num!)) {
      return "El RUC debe tener exactamente 11 dígitos";
    }
  } else if (type === "DNI") {
    if (!/^\d{8}$/.test(num!)) {
      return "El DNI debe tener exactamente 8 dígitos";
    }
  } else if (type === "CE") {
    if (!/^[a-zA-Z0-9]{4,20}$/.test(num!)) {
      return "El carné de extranjería debe tener entre 4 y 20 caracteres alfanuméricos";
    }
  }

  return null;
}
