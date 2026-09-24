# Padrón: corrida contra DEMO (2026-09-24)

Ítem 8 de [`plan-cierre-piloto.md`](./plan-cierre-piloto.md). Solo cuentas: ningún
nombre, teléfono, dirección ni deuda de una persona.

## De dónde sale

- Firestore del Yacco viejo, proyecto `yacco-2026`, **solo lectura**
  (`tools/firestore-export`, credenciales de gcloud). Colección `customers`:
  604 documentos. Cada cliente trae su deuda (`debtAmount`), una locación y sus
  etiquetas; los saldos de envases vienen vacíos en los 604.
- `pnpm to-roster` arma los 4 CSV de `pnpm load:roster`. Reglas en el
  supuesto 14 de [`supuestos-por-validar.md`](./supuestos-por-validar.md).
- El export y los CSV quedaron fuera del repo, en la máquina donde se corrió.

## Cuántos entran y por qué

|                                                           | Clientes |
| --------------------------------------------------------- | -------: |
| Leídos                                                    |      604 |
| Entran                                                    |      604 |
| Descartados (sin nombre, duplicado exacto o sin locación) |        0 |

Avisos (entran igual):

| Aviso                                               | Clientes |
| --------------------------------------------------- | -------: |
| Teléfono compartido con otro cliente (25 teléfonos) |      192 |
| Teléfono que no es un celular de 9 dígitos          |      160 |
| Sin dirección                                       |       40 |

## Resultado de la carga en DEMO

`pnpm load:roster --commit` sobre la rama `demo` de Neon, corte 2026-09-24:

- 604 clientes activos, 604 ubicaciones, todos sin zona.
- 0 envases de apertura (a contar en planta).
- 102 cargos de apertura. Deuda neta: **S/ 113 329,82**.
- Verificado después en la base: la deuda materializada de los 604 es igual a
  la reconstruida desde sus ventas de apertura (S/ 113 329,82 las dos).

## Carga en `main` (2026-09-24, 16:17–16:24 UTC)

Con el OK de Giancarlo, después de la rama de respaldo `backup-pre-roster-20260924`
y de conciliar contra un export fresco de la fuente (604 clientes, S/ 113 329,82,
CSV idénticos a los de esta corrida). Resultado en `main`: 604 clientes y 604
ubicaciones, 102 cargos de apertura, deuda materializada = deuda del libro =
fuente = **S/ 113 329,82**.

Después se borraron de demo los 604 clientes reales y sus cargos, y los archivos
del export. Demo vuelve a tener solo datos inventados.
