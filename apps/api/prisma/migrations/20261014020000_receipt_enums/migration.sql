-- CreateEnum
-- Los enums de comprobantes viven en su propia migración para que el modelo
-- pueda sumar en otra fila el futuro medio emitido por la app sin reemplazos.
CREATE TYPE "receipt_type" AS ENUM (
    'SALES_RECEIPT',
    'INVOICE',
    'CREDIT_NOTE'
);

CREATE TYPE "receipt_medium" AS ENUM (
    'MANUAL',
    'EXTERNAL_ELECTRONIC'
);
