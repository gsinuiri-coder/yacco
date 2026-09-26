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

Viñetas y no lista numerada: prettier renumera una lista con «3a».

- [x] **1 · Documentación que hoy miente** (#226). `PROGRESO.md`, «Render,
      borrado»: lo hizo Claude Code con `[OK]` de Giancarlo. El 13 va a
      Pendientes sin reescribirlo (15 pendientes). Backlog: la zona desde la UI
      resuelta (#158), la rama de respaldo cerrada. **Agregado al leer el
      código:** el supuesto 14 decía que las etiquetas del sistema viejo
      quedaban en las notas del cliente; `customers` no tiene notas y
      `load:roster` descarta la columna (backlog nuevo).
- [x] **2 · Zonas del padrón** (#227, #237, #239). La herramienta:
      `pnpm roster:zones` (dry-run por defecto, `--commit` solo a quien no
      tiene zona, verificación por huella) y `export:tags` en
      `tools/firestore-export` (solo id y etiquetas). Regla del mapeo:
      supuesto 16. Estuvo bloqueado porque las etiquetas no estaban en `main`
      y el export desde la sesión del agente lo negó el control de permisos.
      Giancarlo corrió `export:tags`, el dry-run (#237 clasificó las etiquetas)
      y el `--commit`. Verificado en `main` por SQL de solo lectura
      (2026-09-25): 3 zonas (Parque 476, Surco 58, Casas Parque 3), las tres
      sin días de reparto; 537 clientes con zona y 68 sin zona (los 67 del
      padrón con una etiqueta que no es lugar, más el cliente de prueba).
- [x] **3a · Defecto del recorrido (nuevo)** (#228). «Envases en poder de
      clientes» no dejaba encontrar a un cliente entre ~600 ubicaciones sin pasar
      ~30 páginas, y no filtraba por zona aunque la API lo admite y `/zones`
      existe. Búsqueda por nombre o teléfono (`search` en
      `GET /container-balances`, sin esquema) y filtro de zona.
- [x] **3 · Envases y choferes: el camino, no el dato** (#229). Recorrido en
      preview (chofer nuevo → ruta → «Mi ruta» en celular → conteo desde 0 →
      liquidar); un paso que exija tocar la API a mano es un ítem nuevo.
      `docs/DEPLOY.md`: saldos conocidos de antemano (CSV `containers` con
      `confidence`) versus contados visita a visita, y el peligro del `upsert`
      de `load:roster`.
- **4 · Backlog con disparador «antes del piloto de campo»**, un PR cada una:
  - [x] 4a (#230) · «Precios de lista del catálogo de productos»: el `PATCH` de productos (ADMIN) y pantalla «Productos». Sin columna nueva. Los
        precios los pone el dueño. Supuesto 17.
  - [x] 4b (#231) · «Producción puede tener catálogos desincronizados del seed»: el
        smoke compara métodos de pago y productos contra `seed-catalog.json`.
  - [x] 4c (#232) · «Una liquidación puede quedar desactualizada»: la mitad del
        pago rechazado, sin columna. Supuesto 18.
  - [x] 4e (#233) · «Cada merge de documentación redespliega producción»: filtro en
        el gate (`scripts/deploy-scope.mjs`). Va antes que 4d porque 4d lo usa.
  - [x] 4d (#234) · «El auto-deploy puede no dispararse sin error visible»:
        `drift.yml` cada hora.
  - [x] 4f (#238) · «Falta índice en `sales (location_id, sold_at)`»: migración
        expand, sin columnas; `EXPLAIN` antes y después; merge fuera de
        08:00–20:00 de Lima y con `[OK]`. Mergeado el 2026-09-25 a las 20:03 de
        Lima, deploy en verde (seis pasos) e índice aplicado en `main`.
- [x] **5 · Guion de la reunión con el dueño** (#235) — `docs/guion-piloto.md`.
- [x] **6 · Cierre** (este PR) — sección «Piloto — 2026-09-25» en `docs/PROGRESO.md`.
