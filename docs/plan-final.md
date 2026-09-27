# Plan final — triage del backlog (cierre final, 2026-09-26)

Cada entrada de [`backlog-tecnico.md`](./backlog-tecnico.md), revisada contra el
código de `main` y su historial, con uno de tres veredictos:

- **Resuelta** — el código ya hace lo que pide su «Para cerrarla», con el PR
  que lo resolvió.
- **A hacer** — sigue abierta y afecta la operación de la planta, la
  integridad del libro de envases o del dinero, la seguridad, o hace fallar o
  flaquear CI. Se ejecuta en la cola de abajo, un PR por fila, primero lo de
  más riesgo para la operación.
- **Descartada** — con su razón. Por regla del cierre, solo se descarta lo que
  cumple el criterio de «a hacer» si depende de la app sin conexión (fuera del
  alcance) o de cuentas a las que el agente no llega (esas van a «Pendientes
  de Giancarlo»). El resto de las descartadas **no cumple** el criterio de «a
  hacer»: no toca la operación, el libro, el dinero, la seguridad ni CI.

El loop termina cuando esta tabla no tiene filas «a hacer».

> **Modo local (2026-09-27).** Docker es el único entorno de prueba. Todo lo
> que dependía de demo, previews o despliegue automático queda descartado por
> no aplicar; las guardias necesarias para publicar quedan identificadas como
> **Deploy final** y no bloquean el trabajo local.

## Tabla

| Entrada                                                                         | Veredicto              | PR / razón                                                                                                          |
| ------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Refresh token en localStorage                                                   | Resuelta               | #194 (cookie httpOnly; en el web solo queda la marca `yacco.session`)                                               |
| No hay endpoint de usuario actual                                               | Resuelta               | #208 (`GET /auth/me`)                                                                                               |
| Password del admin de producción                                                | Resuelta               | #141. Rotarla es de Giancarlo (Pendientes)                                                                          |
| Precios de lista del catálogo de productos                                      | Resuelta               | #230 (pantalla «Productos»)                                                                                         |
| El detalle de pedido no puede mostrar quién lo registró                         | Descartada             | El dato se guarda (`created_by`); mostrarlo no cambia la operación ni la integridad                                 |
| No se puede asignar zona a un cliente desde la UI                               | Resuelta               | #158, #169                                                                                                          |
| La gestión de usuarios no cambia contraseñas ni roles                           | Resuelta               | #106                                                                                                                |
| La gestión de usuarios no cambia roles                                          | Resuelta               | #110                                                                                                                |
| No hay forma de invalidar un token ya emitido                                   | Resuelta               | #193 (`users.token_version`)                                                                                        |
| La web no descarta la petición en vuelo al cambiar de objetivo                  | Descartada             | Era del web React retirado; el web Nuxt no la reproduce                                                             |
| (sub) Lo que se descartó: `customers-page` no era esto                          | Resuelta               | #109                                                                                                                |
| No hay gestión del catálogo payment-methods                                     | Descartada             | El catálogo se siembra; ningún medio de cobro nuevo está pedido. No toca la operación de hoy                        |
| La matriz de transiciones de envases está duplicada                             | Descartada             | Su disparador era la app de reparto (fuera del alcance); la copia del web cubre 3 tipos y la API valida             |
| Reparto de un pago global entre deudas del cliente                              | Descartada             | El saldo es correcto sin reparto; el supuesto 13 (validado) decidió no repartir                                     |
| Certeza del saldo de apertura de envases en poder del cliente                   | Resuelta               | #46                                                                                                                 |
| Lista fija de migraciones en customer-locations-migration.int.test.ts           | Resuelta               | #49                                                                                                                 |
| Sin lock sobre customer_container_balances al leer-y-reescribir                 | A hacer → cola 2       | Lectura y escritura del saldo sin bloqueo: doce entregas simultáneas daban saldo 2 a 4                              |
| Falta la rutina de cuadre del dinero                                            | A hacer → cola 1       | No existía ninguna comparación de `debt_balance` contra ventas y cobros                                             |
| Clientes con saldo a favor al cierre del cuaderno                               | A hacer → cola 10      | El código está bien; falta el test que su «Para cerrarla» pide (límite de crédito con deuda negativa)               |
| CHECK de no negatividad en customer_container_balances                          | Resuelta               | #51                                                                                                                 |
| El auto-deploy de yacco-api puede no dispararse sin error visible               | Descartada: modo local | No hay auto-deploy; el único deploy es final y manual                                                               |
| Producción puede tener catálogos desincronizados del seed y nada lo detecta     | Resuelta               | #231                                                                                                                |
| Test flaky en apps/web: customers-page falla bajo carga                         | Resuelta               | #109                                                                                                                |
| La suite de web roza el timeout de 5 s bajo cobertura                           | Descartada             | Era la suite del web React retirado                                                                                 |
| Doble envío del formulario de cobranza                                          | Resuelta               | #76 (`idempotencyKey`, también en el web Nuxt)                                                                      |
| HU-18 E1 solo verificada a medias: falta `GET .../account-statement`            | Resuelta               | #71                                                                                                                 |
| `requiresConfirmation` usado como proxy de "es efectivo"                        | Descartada             | Un medio nuevo no tiene camino desde la app (no hay gestión de medios de cobro) y hoy solo Efectivo cumple el proxy |
| Una liquidación puede quedar desactualizada                                     | Resuelta               | #123, #163, #232                                                                                                    |
| Falta índice en `sales (location_id, sold_at)`                                  | Resuelta               | #238, #254                                                                                                          |
| Un pedido asignado a una parada sigue en PENDING                                | Resuelta               | #114                                                                                                                |
| Terminar una ruta no exigía sus paradas resueltas                               | Resuelta               | #115                                                                                                                |
| Los datos de demo no tienen profundidad temporal en el libro                    | Descartada             | Solo la demo                                                                                                        |
| Seis mensajes de RoutesService interpolan el enum crudo                         | A hacer → cola 7       | Mensajes en pantalla con `PLANNED`, `IN_PROGRESS` y similares (rutas, liquidación, cobros)                          |
| Descargar los vacíos al volver de ruta no tiene camino en la app                | Resuelta               | #116                                                                                                                |
| Devolver llenos al galpón no repone el lote del que salieron                    | Resuelta               | #188                                                                                                                |
| Regla: los mensajes de error que llegan a pantalla van en español               | Resuelta               | #111, #81                                                                                                           |
| Los errores de rutas escriben la fecha en formato ISO                           | Resuelta               | #99                                                                                                                 |
| El aviso de inventario negativo diagnostica una causa que puede no ser la real  | A hacer → cola 6       | Manda a registrar ingresos que no faltan cuando el negativo es de camión                                            |
| Los textos de diferencia de la liquidación no concuerdan en singular            | Resuelta               | #184                                                                                                                |
| La columna «Diferencia» del formulario de conteo se lee al revés sin la palabra | Resuelta               | #184                                                                                                                |
| 27 suites de integración levantan un Postgres cada una                          | Descartada             | Lento en la máquina local; en CI no falla ni flaquea                                                                |
| El fail-safe a demo es silencioso                                               | Descartada: modo local | Demo y Cloud Run están fuera; la prueba usa Docker local                                                            |
| Falta un rol de solo lectura                                                    | Resuelta               | #208, #218 (y supuesto 15, validado)                                                                                |
| El preflight no valida el token de Vercel                                       | Deploy final           | #139 queda como guardia del único deploy manual                                                                     |
| Cada merge de documentación redespliega producción                              | Resuelta               | #233                                                                                                                |
| Sin WEB_ORIGIN, producción vuelve a aceptar localhost en silencio               | Resuelta               | #137, #138                                                                                                          |
| El preflight imprime `::error::` en corridas verdes                             | Descartada             | Cosmético: no hace fallar ni flaquear CI                                                                            |
| `pnpm demo:data` no corre contra la demo de Cloud Run                           | Descartada: modo local | No existe servicio demo; los datos de prueba se cargan en Docker                                                    |
| Cambiar la contraseña no invalida los refresh tokens                            | Resuelta               | #193                                                                                                                |
| (auditoría) A1: el token de Vercel alcanza a todo el team                       | Descartada → Giancarlo | Necesita el dashboard del team de Vercel                                                                            |
| (auditoría) A5 / D-016: retención de 400 días y alerta sobre Secret Manager     | Resuelta               | #210                                                                                                                |
| (auditoría) A4: demo y producción comparten la identidad de runtime             | Descartada: modo local | No hay runtime demo ni producción hasta el deploy final                                                             |
| (auditoría) A7: `qs`, digest de la imagen base, escaneo de Artifact Registry    | Resuelta               | #211                                                                                                                |
| (auditoría) CSP completa en el web                                              | Resuelta               | #195                                                                                                                |
| (auditoría) El refresh token fuera de `localStorage`                            | Resuelta               | #194                                                                                                                |
| `git status` reportó 27 archivos de `apps/api` modificados sin cambios reales   | Resuelta               | Diagnóstico local, sin PR                                                                                           |
| CI no construye la imagen de la API                                             | Resuelta               | #206, #222                                                                                                          |
| Web: el primer clic después de cerrar un desplegable no toma                    | Resuelta               | #187                                                                                                                |
| Web: «Hydration completed but contains mismatches» en la consola                | Resuelta               | #187                                                                                                                |
| Web: el ejemplo «25.00» en «Monto cobrado»                                      | Resuelta               | #185                                                                                                                |
| Web: «Arriba del camión» muestra lo cargado, no lo que queda                    | Resuelta               | #186                                                                                                                |
| Demo: 1 bidón lleno varado «en camión» desde la ruta del 16/09                  | Descartada             | Solo la demo; #188 corrigió la causa                                                                                |
| Rotar una credencial de Neon sin validar antes que `secrets:gcp` puede correr   | Resuelta               | #207                                                                                                                |
| Rama de respaldo de `main` antes del primer dato real del piloto                | Resuelta               | `backup-pre-roster-20260924`, registrada en #205                                                                    |
| La corrección de una parada no tiene pantalla                                   | Resuelta               | #202                                                                                                                |
| Retirar el refresh token del cuerpo del login                                   | A hacer → cola 4       | El login todavía devuelve el refresh token en el cuerpo y el refresh acepta el header                               |
| Migración a Prisma 7                                                            | Descartada             | Actualización de dependencia sin efecto en la operación; pide aprobación aparte                                     |
| TypeScript 6                                                                    | Descartada             | Ídem                                                                                                                |
| La imagen de la API trae `npm` con dependencias vulnerables                     | Resuelta               | #222                                                                                                                |
| El cargador del padrón descarta las notas del cliente                           | A hacer → cola 9       | Pierde datos sin avisar: el resumen tiene que decirlo                                                               |
| Cambiar un precio de lista no deja rastro                                       | A hacer → cola 5       | El precio que paga todo el padrón cambia sin saber quién, cuándo ni desde cuánto (migración expand, de noche)       |
| Una baja de llenos en planta no descuenta el lote                               | A hacer → cola 3       | El libro baja y los lotes no; una ruta puede cargar llenos que ya no existen                                        |
| El conteo de la planta no bloquea contra cargas, lotes ni liquidaciones         | A hacer → cola 11      | Nueva (revisión de la cola 2): un conteo simultáneo a una carga compara contra un libro viejo                       |

## Cola, por riesgo para la operación

| #   | Entrada                                               | Estado            |
| --- | ----------------------------------------------------- | ----------------- |
| 1   | Falta la rutina de cuadre del dinero                  | PR #259           |
| 2   | Sin lock sobre customer_container_balances            | PR #260           |
| 3   | Una baja de llenos en planta no descuenta el lote     | en curso          |
| 4   | Retirar el refresh token del cuerpo del login         | pendiente         |
| 5   | Cambiar un precio de lista no deja rastro             | pendiente (noche) |
| 6   | El aviso de inventario negativo                       | pendiente         |
| 7   | Mensajes con el estado en inglés                      | pendiente         |
| 8   | El cargador del padrón descarta las notas del cliente | pendiente         |
| 9   | Clientes con saldo a favor (test del límite)          | pendiente         |
| 10  | El conteo de la planta no bloquea contra cargas       | pendiente         |

## Pendientes de Giancarlo que salen de acá

- **A1:** team propio de Vercel para Yacco (el token de CI alcanza a todo el team).
- **Contraseña del admin de producción:** rotarla desde «Usuarios» y destruir
  la versión de `yacco-admin-initial-password`.
