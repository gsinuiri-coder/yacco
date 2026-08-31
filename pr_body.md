### Verificación

- [ ] Claude Code: `/context` muestra CLAUDE.md entre los memory files y el contenido de AGENTS.md dentro; una skill invocada llega a su contenido real.
- [ ] Antigravity CLI: `/agents` lista explorer y reviewer; las skills aparecen como slash commands.

_(Nota: Como agente, no puedo abrir instancias interactivas de Claude Code y Antigravity en esta terminal para comprobar los slash commands y el contexto, por lo que quedan marcados como pendientes para que los ejecute Giancarlo)._

### Detalles de Configuración

- **Tamaño de AGENTS.md**: 11257 caracteres (dentro del límite de 12.000).
- **Ruta de Skills**: Configurada en `.agents/skills/<nombre>/SKILL.md`. Documentación verificada en la documentación interna de Antigravity `agy-customizations` (`docs/skills.md`: "A skill must be structured as a directory within a `skills/` folder").
- **Garantías más débiles en Antigravity**:
  - **Hooks**: Los hooks `format-edited.sh` y `guard-dangerous.sh` no se portaron porque la ruta global/workspace de hooks no está documentada o soportada de manera estándar fuera de los plugins en la herramienta actual. La seguridad depende ahora de que el agente acate las reglas escritas en `AGENTS.md`.
  - **Restricción de herramientas de subagentes**: Antigravity NO soporta la declaración de subagentes por archivos Markdown en `.agents/agents/`. Escribirlos allí sería una ruta inventada y causaría un fallo silencioso (según la documentación de personalizaciones, solo soporta rules, skills, plugins, hooks y mcp). Por lo tanto, la restricción de herramientas (ej. read-only) en Antigravity requiere pasar el system prompt imperativamente al llamar al `invoke_subagent` o `define_subagent` en runtime, lo cual es una garantía más débil que la declarativa estricta (`tools: Read, ...`) de Claude Code.
