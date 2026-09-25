# Plan de endurecimiento post-carga

Cola de trabajo del agente después de la carga real del padrón en `main`. Es
el goal que Giancarlo le pasó el 2026-09-24, guardado tal cual para que
sobreviva a un reinicio de sesión (`/clear`): si la sesión se reinicia, se
relee este archivo y se sigue desde el primer ítem sin marcar. Nunca se
depende de «lo que te pasé antes».

Cada PR marca su ítem. Marcas: `[ ]` pendiente, `[x]` hecho (con el PR),
`[bloqueado]` con el motivo.

## Reglas fijas (todas vigentes)

- Yacco ya tiene datos reales: rigen TODAS las restricciones de AGENTS.md.
  Migraciones solo fuera de 08:00–20:00 de Lima; deny de ramas de Neon sin
  excepción; una migración destructiva o el borrado de un recurso llevan [OK].
- Un PR por ítem, cinco checks verdes (ci, analyze, CodeQL, gitleaks,
  SonarCloud), squash sin `--admin`, borrar la rama, y el deploy verde antes
  del siguiente ítem. **Si el deploy se bloquea, se para la cola.**
- Sonar: 80% de cobertura en código nuevo, 3% de duplicación, sin bajar
  umbrales ni agregar exclusiones.
- Tests: un test que arma a mano el estado esperado no prueba nada. Se
  revierte el cambio, se ve el rojo, se lo reaplica, y la salida en rojo va
  al cuerpo del PR. Si hay un fallback, los datos se eligen para que no
  dispare.
- never-print-secrets siempre.

## Cola (en este orden)

1. [x] (#206) **Imagen de la API en CI:** `ci.yml` construye la imagen de la API
       (`docker build`, sin push) en cada PR. Rojo: reintroducir un `COPY` a
       un path inexistente.
2. [x] (#207) **`secrets:gcp --check`:** valida config e ids sin escribir nada. La
       rotación de D-017 lo exige antes del reset.
3. [x] (#208, #213) **Rol de solo lectura** (backlog «Falta un rol de solo lectura»). El
       smoke lo usa para un login real y un GET autenticado. Credencial en
       Secret Manager.
   - **Decidido por Giancarlo (2026-09-24):** `VIEWER` lee SOLO catálogos
     sin datos personales (productos, tipos de envase, métodos de pago) y
     `/auth/me`. Es una cuenta técnica para el smoke, no un rol para
     personas: no aparece en el selector de roles de Usuarios ni en el menú
     del web.
   - Test: un `VIEWER` recibe 403 en `GET /customers`, `/orders`, `/routes`
     y en los reportes, y 200 en los catálogos y en `/auth/me`.
   - Un rol para que alguien de la planta mire sin tocar es OTRO rol, que se
     decide en el piloto: pregunta abierta en `supuestos-por-validar.md`.
   - Lleva migración (valor nuevo de `user_role`): el merge va fuera de
     08:00–20:00 de Lima.
   - `GET /auth/me` no existía: se agrega (devuelve la identidad del token).
   - Va en **dos PRs**, porque la cuenta sólo puede existir en producción
     después de que el deploy aplique la migración, y el smoke corre en ese
     mismo deploy:
     - [x] (#208) **3a** — rol, `/auth/me`, web, `smoke.mjs` con el login válido
           cuando recibe `SMOKE_VIEWER_PASSWORD`, y `pnpm smoke:viewer`. Tras
           su deploy verde: `pnpm smoke:viewer` contra producción.
     - [x] (#213) **3b** — el job 6 de `deploy.yml` lee
           `yacco-production-smoke-viewer-password` por WIF y el chequeo pasa
           a obligatorio. Sin migración.
   - Mientras 3a espera la ventana de las 20:00, se adelanta el ítem 4 si no
     depende de él (no depende).
4. [x] (#209) **A4:** identidades de runtime separadas para `yacco-api` y
       `yacco-api-demo`; cada una lee SOLO sus secretos. Verificar que demo no
       puede leer un secreto de producción.
   - Adelantado al 3a, que espera la ventana de migraciones (no depende de él).
   - **Hecho** tras el deploy verde de `b4e8a6d`: quitado el `secretAccessor` de proyecto a
     `yacco-api-run`. Troubleshooter: demo → producción `CANNOT_ACCESS`, producción → demo
     `CANNOT_ACCESS`, cada una → lo suyo `CAN_ACCESS`; `/health/db` 200 en las dos.
5. [x] (#210) **A5 / D-016:** bucket de logs con retención de 400 días para los
       accesos a Secret Manager y una alerta ante una lectura de una identidad
       que no sea las esperadas.
   - Aplicado con `pnpm gcp:audit` antes del merge (no toca el deploy). El
     canal de email es la cuenta dueña del proyecto. Giancarlo
     confirmó (2026-09-24) que le llegó el email de las lecturas de prueba (20:20, 20:26 y
     21:03 UTC).
6. [x] (#211) **A7:** digest fijo de la imagen base, `qs` al día y escaneo de
       vulnerabilidades en Artifact Registry.
   - Escaneo verificado sobre la primera imagen de un deploy: `api:fd0bd204bd39`
     15 hallazgos (8 HIGH); `api:9fcc56512854` (este ítem) 13, sin los dos de
     `qs`. Los que quedan vienen del `npm` de la imagen base y de Prisma
     (backlog).
7. [x] (#212) **Ramas:** rescatar de `chore/dependency-hygiene` el typecheck del
       tsconfig de `prisma/` y las entradas de backlog que sigan vigentes (PR
       propio). Después [OK] para borrar esa rama, `feat/firestore-export` y
       `docs/backlog-stat-cache`.
   - [OK] de Giancarlo (2026-09-24) para borrar las tres, después del merge.
8. [ ] **Cierre:** PROGRESO.md, backlog y un reporte corto.
