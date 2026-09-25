# Plan piloto

Cola de trabajo del agente para cerrar el piloto en un solo loop. Es el goal
que Giancarlo le pasó el 2026-09-25, guardado para que sobreviva a un reinicio
de sesión (`/clear`): si la sesión se reinicia, se relee este archivo y se
sigue desde el primer ítem sin marcar. Nunca se depende de «lo que te pasé
antes».

Cada PR marca su ítem. Marcas: `[ ]` pendiente, `[x]` hecho (con el PR),
`[bloqueado]` con el motivo.

## Delegación y cuándo se para

Delegación plena de Giancarlo: las decisiones de producto las toma el agente
como si fuera el cliente, con la recomendación que el repo ya trae, y las
registra en `docs/supuestos-por-validar.md` con la línea «Decidido por Claude
por delegación de Giancarlo (2026-09-25)» y sus cuatro líneas. No se para a
preguntar por dominio. Se para SOLO por, y espera un `[OK]` literal:

- (a) cualquier escritura sobre datos de producción (rama `main` de Neon, por
  API o SQL);
- (b) cualquier borrado;
- (c) el merge de un PR con migración;
- (d) una dependencia nueva.

## Reglas fijas (todas vigentes)

- Un PR por ítem, cinco checks verdes (ci, analyze, CodeQL, gitleaks,
  SonarCloud), squash sin `--admin`, borrar la rama, y el deploy verde (seis
  jobs, smoke de producción incluido) antes de mergear el siguiente. Con el
  deploy bloqueado no se mergea más de un PR.
- Subagente `reviewer` antes de abrir cada PR.
- Nada de columnas nuevas en el schema sin preguntar; el índice del ítem 4 es
  la única migración prevista, y se mergea fuera de 08:00–20:00 de Lima.
- Tests: por cada cambio de producción, revertirlo, ver el ROJO, reaplicarlo;
  la salida en rojo va al cuerpo del PR. Si hay un fallback, los datos se
  eligen para que no dispare. Web: por texto visible y rol accesible.
- Sonar: 80 % de cobertura en código nuevo, 3 % de duplicación, sin
  exclusiones.
- Secretos y contraseñas no se imprimen; `.env*` no se lee ni se escribe.
  Ramas de Neon: no borrar, resetear ni restaurar.
- Ningún nombre, teléfono ni monto de una persona en un output ni en un
  archivo del repo.
- `gh pr update-branch` (nunca force-push) cuando `main` avanzó.

## Cola (en este orden)

1. [ ] **Documentación que hoy miente.**
   - `PROGRESO.md`, «Render, borrado»: lo hizo Claude Code con `[OK]` de
     Giancarlo, no Giancarlo desde los dashboards. La fila de GitHub queda
     pendiente de confirmar.
   - `supuestos-por-validar.md`: el 13 va a Pendientes, sin reescribirlo.
     Quedan 15 pendientes.
   - `backlog-tecnico.md`: «No se puede asignar zona a un cliente desde la
     UI» resuelta (con la fecha del PR del `<select>` de `CustomerForm.vue`);
     «Rama de respaldo de `main` antes del primer dato real» cerrada
     (`backup-pre-roster-20260924`, 2026-09-24).
   - **Agregado al leer el código:** el supuesto 14 dice que las etiquetas
     del sistema viejo «quedan en las notas del cliente». Es falso:
     `customers` no tiene columna de notas y `pnpm load:roster` lee la
     columna `notes` del CSV y la descarta. Se corrige la frase y se registra
     en el backlog.
   - Criterio: `grep -n "hizo Giancarlo desde los dashboards" docs/PROGRESO.md`
     vacío; el 13 aparece una sola vez y bajo `## Pendientes`.
2. [bloqueado] **Zonas del padrón.** Las etiquetas NO están en `main` (ver
   el agregado del ítem 1): 605 clientes, 0 con zona, 0 zonas, y el texto
   «Etiquetas del sistema anterior» no está en ninguna columna. El export y
   los CSV del 24 se borraron. La única fuente es el Firestore del Yacco viejo
   (`yacco-2026`, solo lectura); el export desde la sesión del agente lo
   denegó el control de permisos (datos personales), así que lo corre
   Giancarlo. Se hace igual todo lo que no depende de eso:
   - `scripts/roster-zones.mjs` (`pnpm roster:zones`), mismo patrón que
     `viewer-bootstrap.mjs`: login de admin con la contraseña tecleada sin
     eco (sin TTY no corre), `POST /zones` por cada zona que falte, `PATCH
/customers/:id` con `zoneId` solo a quien no tiene zona. Dry-run por
     defecto; `--commit` escribe. Lee las etiquetas de un archivo
     `código externo → etiquetas` (sin nombres ni teléfonos) que produce un
     comando nuevo de `tools/firestore-export`.
   - Regla de mapeo (de Giancarlo como cliente): etiqueta de lugar → zona;
     de tipo de cliente → no; dos de lugar → la primera, y el cliente va al
     informe; sin etiqueta de lugar → sin zona. Días de reparto vacíos.
   - Pendiente de Giancarlo: correr el export de etiquetas. Después: dry-run
     → informe → `[OK]` → `--commit` → verificación de solo lectura (clientes
     con zona = informe; hash por cliente de nombre/teléfono/dirección igual
     antes y después).
3. [ ] **Envases y choferes: el camino, no el dato.** Recorrido en preview
       (chofer nuevo → ruta → «Mi ruta» en celular → conteo desde 0 → liquidar);
       un paso que exija tocar la API a mano es un ítem nuevo. `docs/DEPLOY.md`:
       saldos conocidos de antemano (CSV `containers` con `confidence`) versus
       contados visita a visita, y el peligro del `upsert` de `load:roster`.
4. Backlog con disparador «antes del piloto de campo», un PR cada una:
   - [ ] 4a · «Precios de lista del catálogo de productos». No hay forma de
         cambiarlos desde la app: `PATCH /products/:id` (ADMIN) y pantalla de
         productos. Sin columna nueva. Los precios los pone el dueño.
   - [ ] 4b · «Producción puede tener catálogos desincronizados del seed y
         nada lo detecta». El smoke (VIEWER lee los tres catálogos) compara
         contra el catálogo del seed.
   - [ ] 4c · «Una liquidación puede quedar desactualizada». La mitad de la
         corrección ya está; falta la del pago rechazado: derivada de
         `payments.rejected_at` contra `settled_at`, sin columna.
   - [ ] 4d · «El auto-deploy de yacco-api puede no dispararse sin error
         visible». Con Cloud Run: un chequeo programado compara el commit de
         `/health` de producción con la punta de `main`.
   - [ ] 4e · «Cada merge de documentación redespliega producción». Filtro en
         el gate del deploy (`paths-ignore` no existe en `workflow_run`).
   - [ ] 4f · «Falta índice en `sales (location_id, sold_at)`». Migración
         expand, sin columnas: `EXPLAIN` antes y después, merge fuera de
         08:00–20:00 de Lima y con `[OK]`. Va última del ítem por la ventana.
5. [ ] **Guion de la reunión con el dueño** — `docs/guion-piloto.md`.
6. [ ] **Cierre** — sección «Piloto — 2026-09-25» en `docs/PROGRESO.md`.
