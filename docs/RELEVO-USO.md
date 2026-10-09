# Relevo entre agentes: `pnpm relay`

`pnpm relay` corre la cola de Yacco con un agente a la vez. Cuando uno se queda
sin cuota, sigue con el siguiente, en el orden de `relay.config.json` (hoy:
codex, gemini, claude). Si todos están sin cuota, espera `waitMinutes` y vuelve
a empezar por el primero. El traspaso entre agentes es `.relay/RELEVO.md`.

Las reglas que sigue cada agente están en `.agents/rules/unattended-agents.md`.

## Antes de correrlo: dónde y con qué cuenta

**Recomendado: WSL (Ubuntu), con una cuenta que NO tenga gcloud ni Neon
configurados, y solo `gh auth` con un token limitado a este repo.**

Las reglas y los deny frenan lo que un agente _intenta_; no son un límite de
seguridad. Un deny de Bash se compara con el texto del comando, y otro camino
puede escaparse. La única garantía es que no haya credencial que usar:

- **Cuenta aparte en WSL.** Sin `~/.config/gcloud`, sin `neonctl auth`, sin
  `vercel login` y sin `.env*` del proyecto con valores reales.
- **`gh auth login` con un token fine-grained** limitado a este repo:
  Contents, Pull requests y Checks (lectura y escritura), y nada más. Sin
  Actions write, para que no pueda disparar workflows.
- **Docker** disponible, para los tests de integración (Testcontainers).
- **Las CLIs de los agentes** (`codex`, `claude`) instaladas y logueadas en
  esa cuenta. Su sesión vive en el HOME del usuario, que el relevo sí pasa.

## Qué hace el relevo para acotar a cada agente

- **Entorno en lista blanca** (`AGENT_ENV_KEYS` en `scripts/relay.mjs`): pasa
  PATH, HOME/USERPROFILE, lo que necesitan el sistema, node y pnpm, y
  `GH_TOKEN`. Nada más. Una credencial de nube o una `DATABASE_URL` del shell
  no llega al agente. Si una CLI de agente se autentica por una variable (por
  ejemplo, `OPENAI_API_KEY`), hay que loguearla por archivo en vez de
  agregarla a la lista.
- **codex**: `exec --sandbox workspace-write` con red habilitada
  (`-c sandbox_workspace_write.network_access=true`), sin
  `--dangerously-bypass-approvals-and-sandbox`. Escribe solo en el workspace.
- **claude**: `-p --permission-mode dontAsk --permission-prompts none`. Lo que
  pediría aprobación se deniega. Los deny de `.claude/settings.json` aplican
  en todos los modos, y `--disallowedTools` agrega gcloud, neonctl, vercel,
  `gh workflow`, `--admin` y force-push. No `auto`: su clasificador aprueba lo
  que ninguna regla nombra.
- **gemini**: no está instalada, así que `args: null` y el relevo la salta.
  Antes de activarla, verificá con `gemini --help` que corra con su sandbox y
  sin `--yolo`, y anotá la versión en `verifiedWith`.

Las banderas de cada agente salen de su `--help` en la versión anotada en
`verifiedWith`. Al subir de versión una CLI, se vuelven a verificar. Un test
(`relay.test.mjs`) falla si alguna usa un bypass o un modo de aprobación
automática.

## `.relay/RELEVO.md`

Vive en `.relay/`, ignorado por git: no cambia con cada checkout del agente.
El WIP de cada ítem va igual commiteado en su rama. Crealo antes de la primera
corrida con este formato:

```
# Relevo

status: in-progress
item: 11 — <nombre del ítem de docs/plan-final.md>
branch: <rama del ítem>
last-step: (ninguno todavía)
next-step: <qué hacer primero, en español>
blocked-reason:
updated: 2026-10-09 18:00 por Giancarlo
```

- Las claves y los valores de `status` van en inglés: son un enum de máquina.
  El texto de cada campo va en español.
- `status`: `in-progress` (el relevo corre al agente), `blocked` (para con
  código 2 e imprime `blocked-reason`) o `done` (para con 0).
- Cualquier otra línea se ignora. Si una clave se repite, vale la primera.

## Correrlo, pararlo y leer lo que pasó

```
pnpm relay --dry-run   # qué correría y con qué banderas, sin correr nada
pnpm relay             # arranca
touch .relay/stop      # para entre dos corridas (sale con 4)
```

| Código | Por qué paró                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0      | `status: done`                                                                                                                                                                       |
| 1      | Un agente falló dos veces seguidas por algo que no es la cuota (una corrida que sale bien sin tocar RELEVO.md cuenta como falla), no hay ningún agente disponible, o falta RELEVO.md |
| 2      | `status: blocked`                                                                                                                                                                    |
| 3      | Llegó a `maxRuns`                                                                                                                                                                    |
| 4      | `.relay/stop`                                                                                                                                                                        |

- `.relay/lock` tiene el pid del relevo que corre: nunca dos a la vez. Si
  quedó de un relevo que murió, el siguiente lo reemplaza solo. Si Windows
  reusó ese pid, se borra a mano.
- `.relay/log.jsonl` tiene una línea por corrida: agente, inicio, fin,
  resultado, código de salida y, si fue un límite, el patrón y hasta 5 líneas
  que lo dispararon. Esas líneas pasan por una redacción: los valores
  secretos del entorno y todo lo que tiene forma de credencial salen como
  `***`. La salida completa de cada agente va a la terminal, no a disco.
