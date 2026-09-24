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

1. [ ] **Imagen de la API en CI:** `ci.yml` construye la imagen de la API
       (`docker build`, sin push) en cada PR. Rojo: reintroducir un `COPY` a
       un path inexistente.
2. [ ] **`secrets:gcp --check`:** valida config e ids sin escribir nada. La
       rotación de D-017 lo exige antes del reset.
3. [ ] **Rol de solo lectura** (backlog «Falta un rol de solo lectura»). El
       smoke lo usa para un login real y un GET autenticado. Credencial en
       Secret Manager.
4. [ ] **A4:** identidades de runtime separadas para `yacco-api` y
       `yacco-api-demo`; cada una lee SOLO sus secretos. Verificar que demo no
       puede leer un secreto de producción.
5. [ ] **A5 / D-016:** bucket de logs con retención de 400 días para los
       accesos a Secret Manager y una alerta ante una lectura de una identidad
       que no sea las esperadas.
6. [ ] **A7:** digest fijo de la imagen base, `qs` al día y escaneo de
       vulnerabilidades en Artifact Registry.
7. [ ] **Ramas:** rescatar de `chore/dependency-hygiene` el typecheck del
       tsconfig de `prisma/` y las entradas de backlog que sigan vigentes (PR
       propio). Después [OK] para borrar esa rama, `feat/firestore-export` y
       `docs/backlog-stat-cache`.
8. [ ] **Cierre:** PROGRESO.md, backlog y un reporte corto.
