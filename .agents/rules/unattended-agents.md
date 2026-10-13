# Agentes desatendidos

Capítulo de `AGENTS.md`, separado por tamaño (tope de 12.000 caracteres,
D-005). **Ante conflicto, `AGENTS.md` manda.** Esto lo extiende para un caso:
un agente que corre sin una persona mirando, lanzado por `pnpm relay`
(`scripts/relay.mjs`). Uso y advertencias en `docs/RELEVO-USO.md`.

Todo lo de `AGENTS.md` sigue valiendo. Lo que cambia es que acá no hay a quién
preguntar: lo que en una sesión con persona sería «pará y preguntá», acá es
**bloquear y salir**.

## Prohibido, sin excepción

- `gcloud`, `neonctl` y `vercel`, en cualquier forma, y sus equivalentes por
  MCP. Tampoco hay credenciales para usarlos: el relevo no las pasa.
- Disparar un deploy: `gh workflow run`, un `workflow_dispatch` por `gh api`,
  o cualquier otro camino que despliegue.
- Tocar `pnpm.auditConfig` del `package.json` raíz (agregar o sacar un
  `ignoreGhsas`) o el nivel de `pnpm audit` en CI.
- Una migración que no sea expand aditiva: nada de borrar, renombrar o
  cambiar el tipo de una columna o tabla, ni de agregar un `NOT NULL` sin
  default. Y nunca `prisma migrate reset`.
- `--admin` en un merge, `git push --force` en cualquier forma, bajar un
  umbral de Sonar o agregar una exclusión.
- Abrir, leer, imprimir, copiar, modificar o usar valores de un `.env*`. Que
  una herramienta del repo (como Prisma o la configuración de tests de la API)
  lo cargue automáticamente no viola esta regla; el agente igual debe limitarse
  a la base efímera y aislada del test.

## Ante cualquiera de esas, o una ambigüedad de dominio

1. Commiteá y pusheá el WIP en la rama del ítem (nunca solo en el árbol).
2. En `.relay/RELEVO.md`: `status: blocked` y `blocked-reason:` con qué
   hacía falta y por qué no lo hiciste, en español.
3. Salí. El relevo se detiene con código 2 y una persona decide.

## Lo que sí

- Rama, commits, push y PR del ítem en curso.
- Merge (squash) cuando los cinco checks están en verde. La protección de
  rama es el gate; nunca `--admin`.
- Al terminar cada paso: actualizar `last-step`, `next-step` y `updated` de
  `.relay/RELEVO.md`. Una corrida que no lo cambia cuenta como falla, y dos
  seguidas te sacan del relevo: sigue el próximo agente.
- Commitear tu WIP vos. Si al salir dejás cambios sin commitear, el relevo
  los commitea y pushea por vos; si estás en `main`, sin rama o con
  conflictos sin resolver, en cambio, marca `blocked` y para todo.
- Cuando no queda nada en la cola: `status: done`.
