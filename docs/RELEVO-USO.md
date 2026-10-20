# Relevo entre agentes: `pnpm relay`

`pnpm relay` corre la cola de Yacco con un agente a la vez. Cuando uno se queda
sin cuota, sigue con el siguiente, en el orden de `relay.config.json` (hoy:
codex, antigravity, claude; claude siempre último). Si todos están sin cuota,
espera `waitMinutes` y vuelve a empezar por el primero. Un agente que falla
dos veces seguidas por otra cosa queda fuera por el resto del relevo, y se
sigue con el siguiente. El traspaso entre agentes es `.relay/RELEVO.md`.

Claude requiere confirmación humana antes de cada ejecución del relevo. Cuando
le llega el turno, el relevo explica si fue porque los agentes anteriores se
quedaron sin cuota o fallaron dos veces, y sale con código 5 sin lanzar Claude,
sin esperar `waitMinutes` y sin volver al primero. Para continuar esa misma cola
en una ejecución nueva:

```sh
pnpm relay --confirm claude
```

La confirmación vive solamente en ese proceso: no queda guardada para una
ejecución posterior.

Las reglas que sigue cada agente están en `.agents/rules/unattended-agents.md`.

## codex y antigravity corren sin sandbox en Windows

**Decisión de Giancarlo (2026-10-10).** En Windows, el sandbox
`workspace-write` de codex deja `.git` de solo lectura (openai/codex #18918):
`.git` es una ruta protegida, y ni `--add-dir` ni `writable_roots` la vuelven
escribible (probado con codex-cli 0.162.0). Sin crear la rama del ítem, codex
no puede trabajar. Por eso corre con `--sandbox danger-full-access` y
`-c approval_policy="never"`: `exec` no acepta `-a`, su política ya es
`never`, y la bandera la fija para que ninguna `config.toml` la cambie. Nunca
con `--dangerously-bypass-approvals-and-sandbox`.

**antigravity, misma opción (autorización de Giancarlo, 2026-10-10).** Su
`--sandbox` en Windows pide Windows 11 24H2 con la actualización de agosto
2026, y esta máquina tiene 22H2 (build 22621). Sin sandbox, el modo headless
(`agy -p`) deniega todo comando de terminal y termina con código 0 sin hacer
nada (verificado con agy 1.3.3). Lo único que lo deja trabajar es
`--dangerously-skip-permissions`, y con eso corre. Si un día anda su
sandbox, se vuelve a verificar y se le saca el bypass.

Es una opción explícita: `"unsandboxed": true` y `unsandboxedReason` en su
entrada de `relay.config.json`. `danger-full-access` o
`--dangerously-skip-permissions` sin esa clave hacen fallar la lectura de la
config, y `--dangerously-bypass-approvals-and-sandbox` falla siempre. Al
arrancar, el relevo imprime «AVISO: <agente> corre sin sandbox: tiene acceso
completo a esta cuenta», uno por agente.

**El riesgo.** Sin sandbox, codex y antigravity pueden leer y escribir todo lo que puede la
cuenta que corre el relevo, y ejecutar cualquier comando con su red. Las
reglas de `unattended-agents.md` siguen valiendo, pero son instrucciones, no
un límite: lo único que lo acota de verdad es que la cuenta no tenga nada que
usar. El entorno en lista blanca no cambia, pero no alcanza: una CLI logueada
guarda su sesión en el HOME, que el relevo sí pasa.

**Antes de correrlo, cerrar en la cuenta que lo corre:**

- [ ] **gcloud:** sin sesión (`gcloud auth list` vacío) ni `~/.config/gcloud`
      con credenciales.
- [ ] **vercel:** sin `vercel login` (sin `auth.json` en su carpeta de
      config).
- [ ] **neonctl:** sin `neonctl auth`, y sin el MCP de Neon en
      `~/.codex/config.toml` (hoy está configurado; falla solo porque no
      tiene token).
- [ ] **Sanity:** sin el token de su MCP en `~/.gemini/settings.json` (y
      rotado, porque quedó en un transcript el 2026-10-10).
- [ ] **antigravity:** sin MCPs con credenciales en
      `~/.gemini/antigravity-cli/settings.json` (`agy mcp list`): con el
      bypass, agy los usa sin preguntar.
- [ ] **`GH_TOKEN` limitado:** fine-grained, solo este repo, Contents, Pull
      requests y Checks; sin Actions ni Administration.
- [ ] **Protección de `main`:** hoy `enforce_admins` está apagado, así que una
      cuenta admin puede saltearse los checks; encenderlo. Los checks
      requeridos son cuatro (`ci`, `gitleaks`, `CodeQL`, SonarCloud):
      sumar `analyze` para que sean los cinco.

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
- **codex**: `exec --sandbox danger-full-access -c approval_policy="never"`,
  **sin sandbox** por la decisión de arriba, sin
  `--dangerously-bypass-approvals-and-sandbox`. Lo acota solo lo que la
  cuenta no tenga.
- **claude**: `-p --permission-mode dontAsk --permission-prompts none`. Lo que
  pediría aprobación se deniega. Los deny de `.claude/settings.json` aplican
  en todos los modos, y `--disallowedTools` agrega gcloud, neonctl, vercel,
  `gh workflow`, `--admin` y force-push. No `auto`: su clasificador aprueba lo
  que ninguna regla nombra.
- **antigravity** (`agy`): `-p {prompt} --dangerously-skip-permissions`,
  **sin sandbox** por la decisión de arriba. Lo acota solo lo que la cuenta
  no tenga. Ojo: `agy` se actualiza sola, así que la versión de
  `verifiedWith` puede no ser la instalada.
- **Modelo fijo**: cada agente declara `model` en `relay.config.json` (hoy
  codex `gpt-5.6-sol`, antigravity `gemini-3.1-pro-high`, claude
  `claude-opus-5-5`). El relevo lo pasa con la bandera de `MODEL_FLAGS`
  (`--model` en las tres, verificada con su `--help`) al final de los args.
  Un `model` en una CLI que no está en `MODEL_FLAGS` corta al leer la
  config. `--dry-run` muestra el modelo de cada uno.

Las banderas de cada agente salen de su `--help` en la versión anotada en
`verifiedWith`. Al subir de versión una CLI, se vuelven a verificar. Un test
(`relay.test.mjs`) falla si alguna usa `--dangerously-bypass-approvals-and-sandbox`
o un modo de aprobación automática, y si una corre sin sandbox
(`danger-full-access`, `--dangerously-skip-permissions`, también en su forma
`--bandera=valor`) sin declararlo.

## Red de seguridad: el WIP que deja un agente

Después de cada corrida, salga bien o mal, el relevo mira `git status`. Si
el agente dejó cambios, los commitea en la rama actual
(`wip(relay): <agente> dejó cambios sin commitear`, con `git add -A` y
`--no-verify`: el hook corre eslint y un WIP a medias puede no pasarlo) y
hace push. Si la rama tiene commits sin pushear (ese WIP o los del propio
agente), también los pushea, con el árbol limpio o no. Si el push falla, el
commit queda local, el relevo lo avisa y lo reintenta después de la
corrida siguiente.

Cada git corre sin prompts (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`)
y con un tope de 2 minutos: unas credenciales vencidas no cuelgan el relevo.

**Lo que commitea es todo lo que `.gitignore` no excluye**, y lo pushea. Un
archivo con un secreto que un agente dejó suelto llega a GitHub antes que
gitleaks (que corre en CI). Es parte del riesgo de los agentes sin sandbox
de arriba.

No commitea, y escribe `status: blocked` con el motivo en RELEVO.md y sale
con 2, si: la rama es `main`, no hay rama (HEAD suelto o un rebase a
medias), quedó un merge/rebase/cherry-pick con conflictos sin resolver, o
`git status`/`git commit` fallan. Una persona revisa el árbol y mueve los
cambios a la rama del ítem.

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

### Ver cómo va

En otra pestaña, el tablero de solo lectura muestra en dos tablas el agente
actual y el estado del relevo, y sus últimas ocho corridas (con la hora de
inicio en hora de Lima):

```sh
pnpm relay:status           # imprime una vez
pnpm relay:status --watch   # redibuja cada 5 segundos hasta Ctrl+C
```

Con `--watch` el tablero usa la pantalla alternativa de la terminal: se
redibuja en el mismo lugar y al salir deja la terminal como estaba, sin nada
acumulado en el historial. Todo se corta al ancho y al alto de la ventana
(mínimo 60 columnas); el último y el siguiente paso ocupan a lo sumo dos
líneas y lo que no entra termina en «…». Para leerlos enteros, `.relay/RELEVO.md`.
Sin terminal (redirigido a un archivo), `--watch` imprime una sola vez. Al pie
va la hora de Lima; con `--watch` en una terminal, además, «Actualiza cada 5 s
· Ctrl+C para salir».

```
pnpm relay --dry-run   # qué correría y con qué banderas, sin correr nada
pnpm relay             # arranca
pnpm relay --confirm claude # confirma Claude solo para esta ejecución
touch .relay/stop      # para entre dos corridas (sale con 4)
```

`--dry-run` también indica qué agentes requieren confirmación. Un nombre pasado
a `--confirm` que no existe en `relay.config.json` termina con un error claro.

| Código | Por qué paró                                                                                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | `status: done`                                                                                                                                                                                  |
| 1      | Todos los agentes fallaron dos veces seguidas por algo que no es la cuota (una corrida que sale bien sin tocar RELEVO.md cuenta como falla), no hay ningún agente disponible, o falta RELEVO.md |
| 2      | `status: blocked`, puesto por un agente o por la red de seguridad (cambios en main o sin rama, conflictos sin resolver, o git que falla)                                                        |
| 3      | Llegó a `maxRuns`                                                                                                                                                                               |
| 4      | `.relay/stop`                                                                                                                                                                                   |
| 5      | El siguiente agente requiere confirmación; no fue lanzado. Continuá con `pnpm relay --confirm <agente>`                                                                                         |

- `.relay/lock` tiene el pid del relevo que corre: nunca dos a la vez. Si
  quedó de un relevo que murió, el siguiente lo reemplaza solo. Si Windows
  reusó ese pid, se borra a mano.
- `.relay/waiting-confirmation.json` identifica al agente pendiente y el motivo
  que muestra `pnpm relay:status`. El relevo lo escribe antes de salir con 5 y
  lo borra al iniciar la próxima ejecución real; `relay:status` nunca lo
  modifica.
- `.relay/log.jsonl` tiene una línea por corrida: agente, inicio, fin,
  resultado, código de salida; si fue un límite, el patrón y hasta 5 líneas
  que lo dispararon; si falló, las últimas 5 líneas de su stderr; y el WIP
  que commiteó la red de seguridad (`wip`: rama, commit y si se pusheó).
  Esas líneas pasan por una redacción: los valores secretos del entorno y
  lo que tiene forma de credencial conocida (`sk-`, `gh*_`, `AIza`,
  `Bearer`, `postgres://`, JWT, `AKIA`, el inicio de una clave PEM) salen
  como `***`. Un secreto con otra forma que no venga del entorno puede
  pasar: `.relay/` es local e ignorado por git: no lo compartas. La salida
  completa de cada agente va a la terminal, no a disco.
