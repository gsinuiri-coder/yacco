# Plan de revisión final de producto

Cola de trabajo del agente para la revisión final de producto, en un solo
loop, sin parar, hasta vaciarla. Es el goal que Giancarlo le pasó el
2026-09-25, guardado para que sobreviva a un reinicio de sesión (`/clear`): si
la sesión se reinicia, se relee este archivo y se sigue desde el primer ítem
sin marcar. Nunca se depende de «lo que te pasé antes».

Cada PR marca su ítem. Marcas: `[ ]` pendiente, `[x]` hecho (con el PR),
`[bloqueado]` con el motivo.

## Cuándo se para

Se para SOLO por, y espera un `[OK]` literal de Giancarlo:

- (a) cualquier escritura sobre datos de producción (rama `main` de Neon, por
  API, app o SQL);
- (b) cualquier borrado;
- (c) el merge de un PR con migración;
- (d) una dependencia nueva.

Por dominio NO se para: la recomendación de esta cola ya está decidida.
Ninguno de estos ítems lleva migración ni columna nueva; si alguno parece
necesitarla, se para y pregunta. El 4f (#238) lo mergea Giancarlo después de
las 20:00 de Lima; mientras su deploy corre, no se mergea nada.

## Reglas fijas (todas vigentes)

- Un PR por ítem (D va en un solo PR de docs). Cinco checks verdes (ci,
  analyze, CodeQL, gitleaks, SonarCloud), squash sin `--admin`, borrar la rama
  local y la remota, y el deploy verde (seis jobs, smoke de producción
  incluido) antes de mergear el siguiente. `gh pr update-branch` si `main`
  avanzó; nunca force-push.
- Subagente `reviewer` antes de abrir cada PR.
- Nada de columnas nuevas en el schema sin preguntar. Nada de dependencias
  nuevas.
- Tests: por cada cambio de producción, revertirlo, correr, ver el ROJO,
  reaplicarlo y ver verde; la salida en rojo va en el cuerpo del PR. Un test
  que arma a mano el estado que la feature tendría que producir no prueba la
  feature. Si la rama bajo test tiene un fallback, los datos se eligen para
  que no dispare. Web: por texto visible y rol accesible.
- Sonar: 80 % de cobertura en código nuevo, 3 % de duplicación, sin
  exclusiones ni bajar umbrales: si falla, se extraen componentes o funciones.
- Secretos y contraseñas no se imprimen; `.env*` no se lee ni se escribe.
  Ramas de Neon: no borrar, resetear ni restaurar.
- Ningún nombre, teléfono ni monto de una persona en un output, un test, un PR
  ni un archivo del repo.
- Skills: `yacco-conventions` (siempre), `domain-invariants` (L3, L7),
  `nest-module` (L1, L2, L7), `sprint-close` (cierre).

## Cola (en este orden)

- [x] **D · Docs** (#240; un PR, docs-only: no redespliega).
  - D1: `PROGRESO.md` y `plan-piloto.md`: el ítem 2 ya está hecho. Cifras de
    `main` verificadas por SQL de solo lectura (clientes por zona y sin zona;
    3 zonas sin días de reparto).
  - D2: supuesto 4, en `supuestos-por-validar.md` y `guion-piloto.md`:
    «Asumimos» y «Preguntar» pasan a lo que hay hoy (la persona queda afuera a
    lo sumo 15 minutos): ¿le alcanza, o necesita sacarla en el acto?
  - D3: guion, «Precios de lista»: son cuatro productos (dos recargas, con
    caño y sin caño), no «la recarga».
  - D4: guion, secciones 1 y 3: el peso de Parque en el padrón y el de un
    solo cliente sin zona en la deuda (porcentajes por SQL de solo lectura,
    sin nombre ni monto). Pregunta: «¿esa deuda es real y vigente?».
  - D5: guion, pregunta operativa nueva en «Los envases»: ¿cuántos envases
    tiene hoy la planta (vacíos y llenos, por tipo)?
  - D6: supuesto 19, nuevo: «Registrar un lote sin vacíos suficientes avisa y
    no bloquea». Va al guion y a la hoja de cierre.
- [x] **L4 · «Debe desde» con saldo inicial** (#241). Cuando el cargo que abre la
      deuda actual es el saldo inicial del padrón, la columna muestra «Saldo
      inicial» y no la fecha de corte como si fuera una venta. `replayDebt` no
      cambia su regla; supuesto 13, una línea.
- [x] **L5 · Saldo a favor** (#242). Un saldo negativo se muestra «A favor S/ x.xx»
      en la lista de Clientes y en la ficha. Un solo lugar.
- [x] **L1 · Filtro de zona en «Clientes»** (#243). «Todas», cada zona en uso y «Sin
      zona»; `withoutZone` en `ListCustomersQueryDto`, excluyente con
      `zoneId` (400).
- [x] **L2 · Clientes por zona en «Zonas»** (#244). Activos por zona y, arriba, los
      que quedan sin zona. Desde la API, sin esquema.
- [x] **L3 · Envases en la ficha del cliente** (#245). Saldo por tipo y ubicación,
      último conteo (o «Sin contar») y enlace al conteo ya filtrado.
- [x] **L6 · Enlaces en direcciones y referencias** (#246). URLs http(s) como
      enlace en la ficha y en «Mi ruta», sin `v-html`.
- [x] **L7 · Paradas en lote** (#247). «Agregar pedidos pendientes» en una ruta
      PLANNED; endpoint todo-o-nada con la validación de
      `POST /routes/:id/stops`.
- [ ] **X · Datos de prueba en producción.** SE PARA ANTES y pide `[OK]`:
      contar en 0 la ubicación del cliente de prueba y desactivarlo. Nunca
      borrar. El lote de prueba no se toca: se ajusta contra el stock real
      que dé el dueño (D5), con un mecanismo todavía por decidir (hoy solo
      existe la «Baja por daño»).
- [ ] **Cierre** (`sprint-close`): sección «Revisión final — 2026-09-25» en
      `PROGRESO.md` y «Qué probar como producto final» con L1–L7.
