# Plan pre-piloto

Cola de trabajo del agente con los últimos ajustes antes del piloto. Es el
goal que Giancarlo le pasó el 2026-09-24, guardado tal cual para que
sobreviva a un reinicio de sesión (`/clear`): si la sesión se reinicia, se
relee este archivo y se sigue desde el primer ítem sin marcar. Nunca se
depende de «lo que te pasé antes».

Cada PR marca su ítem. Marcas: `[ ]` pendiente, `[x]` hecho (con el PR),
`[bloqueado]` con el motivo.

## Reglas fijas (todas vigentes)

- Yacco tiene datos reales: rigen TODAS las restricciones de AGENTS.md.
  Migraciones solo fuera de 08:00–20:00 de Lima; deny de ramas de Neon sin
  excepción; una migración destructiva o el borrado de un recurso llevan [OK].
- Un PR por ítem, cinco checks verdes (ci, analyze, CodeQL, gitleaks,
  SonarCloud), squash sin `--admin`, borrar la rama, y el deploy verde antes
  del siguiente ítem. **Si el deploy se bloquea, se para la cola.**
- Sonar: 80% de cobertura en código nuevo, 3% de duplicación, sin
  exclusiones.
- Tests: un test que arma a mano el estado esperado no prueba nada. Se
  revierte el cambio, se ve el rojo, se lo reaplica, y la salida en rojo va
  al cuerpo del PR. Si hay un fallback, los datos se eligen para que no
  dispare.
- never-print-secrets siempre.

## Cola (en este orden)

1. [x] (#220) **gcloud fijado a Yacco:** ningún comando de Yacco depende del proyecto
       por defecto de la máquina (hoy es `ayr-steel-erp`, de otro cliente).
       Configuración de gcloud con nombre para Yacco (proyecto y billing
       `yacco-v2-prod`), los scripts de `scripts/` pasan `--project`
       explícito, y la regla va a `.agents/rules/infra.md`.
   - Test: un script falla si el proyecto resuelto no es `yacco-v2-prod`.
   - Verificar, SOLO LECTURA, que en `ayr-steel-erp` no quedó ninguna API
     habilitada ni ningún recurso de estas sesiones, y reportarlo. No se toca
     nada ahí.
2. [x] (#221) **`smoke:viewer` y el secreto de admin:** explicar qué lo corre (CI,
       deploy, a mano) y por qué necesita admin. Ningún camino automático lee
       `yacco-admin-initial-password`. Si hace falta un admin para crear o
       reparar la cuenta VIEWER, es un paso manual aparte (bootstrap),
       documentado, y el smoke usa SOLO la credencial de VIEWER. La rotación
       de F no puede romper ningún smoke.
3. [x] (#222) **Imagen de la API:** sacar npm/npx y todo lo que no se use de la etapa
       final del Dockerfile. Quitar el hallazgo de `deepmerge-ts` si se puede
       sin romper Prisma; si no, se registra con el motivo.
   - Evidencia: el escaneo antes y después, con 0 HIGH como meta, y el smoke
     OK.
4. [x] (#213, #223) **Dependabot:** los menores primero (uno por uno) y después las subidas
       mayores de Nest 12 (#214, #215, #216, #217) juntas en un solo PR si
       dependen entre sí. Leer las notas de migración de Nest 12.
   - Los 1059 tests de la API y los de integración en verde, el ciclo e2e de
     Playwright contra el preview y el smoke de producción OK.
   - Si algo del upgrade exige cambiar código de dominio, se para y se
     reporta.
5. [ ] **Cierre:** PROGRESO.md, backlog y un reporte corto.
   - Quedan como pendientes de Giancarlo: F (rotar la contraseña de admin y
     el token de Vercel con vencimiento), borrar Render y la decisión de un
     team propio en Vercel (A1).
