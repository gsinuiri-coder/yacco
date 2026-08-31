---
name: yacco-conventions
description: Naming and language conventions for all Yacco code. Use whenever
  writing or reviewing any code, Prisma schema, SQL, DTO, enum, or REST route,
  and when translating Spanish domain terms into English identifiers.
---

# Yacco naming conventions

## The rule

Identifiers in English; Spanish only in UI strings and human docs. Retroactive:
rename on sight.

| Layer          | Convention        | Good                  | Bad                 |
| -------------- | ----------------- | --------------------- | ------------------- |
| Classes/types  | PascalCase        | `RouteSettlement`     | `LiquidacionRuta`   |
| Vars/functions | camelCase         | `loadFifo()`          | `cargarFifo()`      |
| DB tables      | snake_case plural | `container_movements` | `MovimientosEnvase` |
| Enum values    | SCREAMING_SNAKE   | `FULL_SALE`           | `VentaCompleta`     |
| REST routes    | kebab-case plural | `/production-batches` | `/lotesProduccion`  |

## Domain glossary (ES business term -> EN identifier)

bidón/envase -> container · parque -> fleet · caño -> spigot ·
lote -> production batch · llenado -> filling · carga -> route load ·
parada -> route stop · canje -> exchange · préstamo -> loan ·
saldo de envases -> container balance · baja -> write-off ·
fiado -> on credit · deuda monetaria -> debt balance · abono -> payment ·
medio de pago -> payment method · liquidación -> settlement ·
preventa -> pre-sale (origin: ORDER) · autoventa -> van sale (VAN_SALE) ·
recarga -> refill (REFILL) · venta completa -> full sale (FULL_SALE) ·
evidencia -> evidence · zona -> zone · repartidor -> driver ·
vendedor -> seller · cuadre -> reconciliation

UI labels stay in Spanish (es-PE): "S/ 1,250.50", dates dd/mm/aaaa.
