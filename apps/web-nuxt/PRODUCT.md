# Product

<!-- impeccable:product-schema 1 -->

> Registro inferido de `AGENTS.md`, la especificación funcional y el código existente; no reemplaza esas fuentes de verdad.

## Platform

web

## Users

- El dueño o administrador de una planta purificadora de agua en Perú gestiona la operación, supervisa saldos y resuelve excepciones desde la oficina.
- El personal de ventas registra clientes, pedidos, cobros y comprobantes desde la oficina.
- El personal de planta trabaja con producción e inventario de envases.
- El chofer consulta su ruta del día en la web desde el teléfono; la aplicación móvil sin conexión está fuera de alcance.

## Product Purpose

Yacco reúne la operación diaria de la planta —clientes, ventas, rutas, pagos, envases, producción y comprobantes— en registros auditables. Tiene éxito cuando la oficina puede reconstruir qué ocurrió, quién lo registró y cómo afectó las deudas de dinero y de envases sin depender de cálculos paralelos.

## Positioning

El producto vincula la operación comercial de una planta de agua con dos contabilidades independientes y reconstruibles: el dinero en soles y los envases en unidades. Los movimientos operativos no se corrigen borrándolos; se conservan y se compensan o anulan con trazabilidad.

## Operating Context

- Se usa en una planta peruana; la moneda es soles y los días de negocio se interpretan en America/Lima.
- La oficina registra información que puede llegar por conversación con el chofer o por papel.
- Los catálogos se obtienen de endpoints propios. La interfaz nunca pide identificadores que una persona no pueda reconocer.
- Los comprobantes manuales provienen de talonarios; los electrónicos se emitieron fuera de Yacco y pueden llevar PDF y XML privados.

## Capabilities and Constraints

- Es un monorepo pnpm con API NestJS, Prisma/PostgreSQL, web Nuxt 4 y contratos compartidos.
- Todo monto viaja como texto con dos decimales y toda fecha de negocio como `AAAA-MM-DD`; la web no los convierte mediante `Number` ni `Date`.
- Los comprobantes se registran y auditan, pero Yacco todavía no los emite ante SUNAT ni genera guías de remisión.
- Un comprobante puede cubrir varias ventas completas del mismo cliente. No se edita: se anula o se registra una nota de crédito.
- Los precios son finales con IGV incluido. La tasa y el umbral documental de boleta son configurables por versiones de los datos de facturación.
- La interfaz de este proyecto usa componentes de Nuxt UI y texto en el vocabulario cotidiano de la planta.

## Brand Commitments

- El nombre del producto es Yacco.
- El lenguaje visible es español claro, dirigido al dueño y a su personal, sin jerga técnica.
- La interfaz existente es la autoridad visual para extensiones nuevas.

## Evidence on Hand

- Fuente funcional: `docs/yacco-documentacion.md`.
- Reglas de dominio y operación: `AGENTS.md`.
- Alcance vigente de comprobantes: `.relay/goals/fase3-8-comprobantes-y-guias.md`.
- Implementación y pruebas reales: `apps/api`, `apps/web-nuxt` y `packages/shared`.
- No hay testimonios, métricas comerciales ni afirmaciones promocionales autorizadas; no deben inventarse.

## Product Principles

- Conservar la historia operativa y hacer visibles las anulaciones y correcciones.
- Advertir los juicios de negocio y bloquear únicamente los estados imposibles.
- Mostrar datos reconocibles para la planta, nunca identificadores internos sin catálogo.
- Mantener dinero, envases y fechas de negocio en sus representaciones exactas.
- Diseñar primero para completar una tarea de oficina con claridad y luego para inspeccionarla.

## Accessibility & Inclusion

Las acciones y estados deben ser legibles por texto visible y roles accesibles. El uso desde teléfono forma parte del flujo del chofer, y las pantallas de oficina deben conservar una lectura utilizable en anchos pequeños.
