# Backlog técnico

Deuda técnica y actualizaciones pospuestas deliberadamente. Cada entrada
tiene una razón concreta y una condición de desbloqueo verificable — no
"cuando haya tiempo".

## 1. Migración a Prisma 7

**Bloqueada por:** Prisma 7 se distribuye como ESM puro; NestJS (vía
`@nestjs/core`/`@nestjs/common`) sigue siendo CommonJS. Es un conflicto de
arquitectura, no una tarea pendiente — no hay una forma directa de cargar un
paquete ESM-only desde el runtime CJS de Nest sin un puente adicional.

**Desbloqueo:** cualquiera de estas dos condiciones:

- El `generator client` de Prisma soporta `moduleFormat = "cjs"` (o
  equivalente) para seguir emitiendo un cliente CommonJS aunque el paquete
  `prisma`/`@prisma/client` en sí sea ESM.
- NestJS soporta ESM de forma estable (no experimental) en su runtime
  principal.

**Efecto colateral al resolverse:** destraba la alerta de seguridad
`GHSA-ggr8-5vv4-36mx` (`deepmerge-ts`, dismissed con razón `no_bandwidth`,
[alerta #2](https://github.com/gsinuiri-coder/yacco/security/dependabot/2)) —
es una dependencia transitiva que entra con Prisma 7 (se vio en el PR #4,
`chore(deps): bump @prisma/client from 6.19.3 to 7.9.1`, cerrado sin
mergear). También hay que revisar en ese momento el
`pnpm.auditConfig.ignoreGhsas` en el `package.json` raíz, que hoy ignora ese
mismo GHSA a propósito.

**Mientras tanto:** `.github/dependabot.yml` ignora los majors de `prisma` y
`@prisma/client` — sin eso, cada patch de la serie 7.x abre un PR que hay que
cerrar a mano (ya pasó una vez, PR #4).

## 2. TypeScript 6 y ESLint 10

**Pospuestos hasta:** después de la Demo 1 y antes de empezar S1.

**Razón:** no es una razón técnica — la propia auditoría de estas
actualizaciones no encontró breaking changes que bloqueen al repo hoy (ver
comentario de cierre del PR #6). Es una decisión de calendario: el costo de
absorber un major crece sprint a sprint a medida que se escribe más código
contra la versión anterior, y ahora mismo el codebase está en su punto más
pequeño — es el momento más barato para pagarlo.

**Seguimiento:**

- TypeScript 6: PR #6 cerrado manualmente
  (`chore(deps-dev): bump typescript from 5.9.3 to 6.0.3`). Dependabot lo
  va a seguir reabriendo cada semana — es intencional, no hay regla de
  `ignore` para `typescript`.
- ESLint 10: PR #2 (`chore(deps-dev): bump eslint from 9.39.5 to 10.8.1`),
  mismo criterio de calendario que TypeScript.

## 3. Expansión de `$CLAUDE_FILE_PATHS` en el hook `PostToolUse` bajo Windows/MINGW

**Prioridad:** baja — solo ergonomía de desarrollo, no bloquea CI ni ningún
flujo de usuario.

**Síntoma:** el hook `PostToolUse` (`pnpm exec prettier --write
$CLAUDE_FILE_PATHS && pnpm exec eslint --fix $CLAUDE_FILE_PATHS`) falla
consistentemente con `No parser and no file path given, couldn't infer a
parser` en este entorno (Windows + Git Bash/MINGW), independientemente del
tipo de archivo editado (se reprodujo con `.ts`, `.json`, `.js`).

**Primera hipótesis:** mangling de rutas de MSYS — Git Bash reescribe
argumentos que parecen paths estilo Unix antes de pasarlos al proceso hijo,
lo que puede vaciar o corromper `$CLAUDE_FILE_PATHS` al expandirlo. Probar
con `MSYS_NO_PATHCONV=1` antepuesto al comando del hook.

**Mientras tanto:** el flujo de trabajo real no depende de este hook —
`prettier --check`/`--write` y `eslint`/`eslint --fix` se corren a mano
sobre cada archivo tocado antes de cada commit, y `lint-staged` (vía Husky,
en el pre-commit hook real) sí corre correctamente y sí bloquea el commit si
falla.
