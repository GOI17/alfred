# Workspace architecture: ports and adapters

Alfred Workspace is a user interface and integration host, not an agent or a harness.
Execution, tool ownership, recovery and context management belong to runtime adapters.

## Current migration boundary

- `SessionPort` is the application-facing session contract. WorkspaceService depends on it, not on `Chat`.
- `createApp({ sessionAdapter })` accepts a factory. The adapter owns execution and publishes changes via the supplied callback; it supplies session state and partial messages to the existing event channel.
- `GET /api/runtime` is authenticated and returns the adapter descriptor. A null catalog means undisclosed, not an empty catalog. File discovery is not runtime discovery.
- Adapters without `legacyBindings` do not receive local Terminal/MCP implementations or resource-import routes. Tool execution and approval enforcement stay with the runtime.
- `createLegacySessionAdapter` preserves the existing implementation temporarily. It is a compatibility adapter, not Alfred Workspace's identity.

This is an incremental migration, not a completed external harness integration. The default still uses the compatibility adapter. No ACP or native CLI transport is implemented by this change. SessionPort retains provider and resource-selection parameters for API compatibility; a protocol-neutral session/event contract and per-conversation adapter routing remain to be implemented. Existing provider settings and context controls are still compatibility UI, not a universal runtime capability editor.

A production external adapter must implement the harness's supported protocol, translate its events and permission requests, persist its session identifiers, and enforce cancellation and authorization. Do not grant permissions from a discovered file, run tools a second time in the workspace, or wrap another recovery loop around the runtime. Unknown capabilities must remain unavailable rather than inferred.

Validation: `pnpm exec vitest run tests/session-adapter.test.ts` checks dependency injection and exclusion of legacy tool wiring using a fake runtime. It does not claim compatibility with any external harness.

---

The following documentation describes the **legacy resource-import adapter only**, not execution of installed harnesses.

# Recursos de agent harnesses

Alfred descubre los recursos locales de Codex, Claude Code, OpenCode y Pi en la computadora que ejecuta el servidor. En **Ajustes → Agent harnesses**, selecciona una conversación y un harness. El catálogo muestra skills, comandos, definiciones de agentes, instrucciones y MCPs, con su archivo de origen y ámbito (usuario o workspace).

La detección de instalación busca el ejecutable en el `PATH` del servidor sin ejecutarlo. Los archivos se pueden usar aunque la CLI no esté instalada. El directorio personal es el del usuario que ejecuta Alfred, no el del navegador o teléfono conectado.

## Fuentes compatibles

Las rutas de proyecto parten del workspace de la conversación: si es un worktree, se lee ese checkout.

| Harness | Usuario | Workspace |
| --- | --- | --- |
| Codex | `~/.codex/config.toml`, `prompts/*.md`, `skills/**/SKILL.md`, `agents/*.toml`, `AGENTS.md` o `AGENTS.override.md`; `~/.agents/skills` | `.codex` con los mismos recursos; `.agents/skills`; `AGENTS.override.md` o `AGENTS.md` en la raíz |
| Claude Code | `~/.claude/{commands,skills,agents}`, `CLAUDE.md`, `settings.json`; MCPs en `~/.claude.json` | `.claude/{commands,skills,agents}`, `.claude/CLAUDE.md`, `settings.json`, `settings.local.json`; `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`; MCPs del proyecto registrados en `~/.claude.json` |
| OpenCode | `~/.config/opencode/{commands,skills,agents}`, `opencode.json` o `.jsonc`, `AGENTS.md`; skills en `~/.agents` y `~/.claude` | `.opencode` con los mismos recursos, `.agents/skills`, `.claude/skills`; `opencode.json` o `.jsonc`; `AGENTS.md` o, en su ausencia, `CLAUDE.md` |
| Pi | `~/.pi/agent/{prompts,skills}`, `settings.json`, `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`; `~/.agents/skills` | `.pi/{prompts,skills}`, `settings.json`, `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`; `.agents/skills`; `AGENTS.md` en la raíz |

Se respetan `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG` y `PI_CODING_AGENT_DIR`. OpenCode admite también los nombres antiguos de carpetas `command`, `skill` y `agent`, comandos/agentes inline en JSON y referencias locales `{file:ruta}`. Se leen rutas explícitas de skills e instrucciones de OpenCode y de skills/prompts de Pi dentro del ámbito permitido. Codex admite agentes TOML independientes y referencias `agents.<nombre>.config_file`.

El catálogo conserva las definiciones duplicadas e indica cuál tiene prioridad. Para su uso en Alfred, el workspace tiene prioridad sobre el usuario; en skills de Claude Code la prioridad es del usuario. Dentro de un mismo ámbito gana la última fuente leída. Se aplican `skills.config[].enabled` de Codex, `skillOverrides` de Claude Code y los campos de frontmatter `disable-model-invocation` y `user-invocable`.

## Uso en el chat

**Usar estos recursos** guarda la selección por conversación. El checkbox de instrucciones controla la carga de los documentos globales y de la raíz del workspace en cada turno. **Usar instrucciones del agente** añade el prompt de una definición de agente.

Al escribir `/`, el compositor ofrece los recursos del harness seleccionado. Los comandos usan `/harness:nombre`, por ejemplo `/opencode:review API`. Los skills usan `/skill:harness:nombre`. Los nombres con caracteres especiales reciben un sufijo estable para evitar ambigüedades.

Los comandos y los skills de Claude expanden argumentos posicionales y texto completo (`$1`, `$ARGUMENTS`, `$@`, índices y valores por defecto) sin ejecutar shell. Los skills disponibles para el modelo se anuncian por nombre y descripción; el contenido se carga bajo demanda mediante `read_harness_resource`. `read_harness_file` permite leer referencias dentro de la carpeta del skill. Los skills reservados al usuario solo se pueden leer durante un turno que los invoque explícitamente.

El historial conserva el mensaje escrito por el usuario. Las instrucciones y la expansión se añaden a la solicitud al modelo. La selección se persiste en `workspace.json` y se propaga por el SSE existente. El catálogo se refresca cada 15 segundos mientras está visible, al volver a la pestaña y mediante **Actualizar recursos**; al empezar un turno se vuelven a leer los archivos.

## MCP

El catálogo descubre `mcp_servers` en TOML de Codex, `mcpServers` en JSON de Claude y `mcp` en JSON/JSONC de OpenCode. **Importar MCP** guarda una referencia con identificador y huella del recurso, detiene el turno actual y pausa la cola. No conecta durante el escaneo ni durante la importación.

La conexión ocurre en el siguiente turno, con los controles existentes de **Terminal y MCP**. La importación inicial usa permiso `ask`; solo lectura no conecta servidores. Se admiten stdio y Streamable HTTP, argumentos, directorio de trabajo, variables de entorno y headers. Las referencias de entorno se resuelven en el servidor. Se preservan los filtros nativos `enabled_tools` y `disabled_tools`.

El catálogo, la vista previa MCP, las aprobaciones y `agent-access.json` contienen referencias y resúmenes, sin valores de credenciales. Si se modifica la configuración o cambia una credencial resuelta, la huella deja de coincidir y el servidor queda inhabilitado hasta importarlo de nuevo. Quitar o bloquear la referencia revoca su acceso.

## Alcance

Esta integración reutiliza recursos con el motor, modelo y permisos de Alfred. No inicia las CLIs ni reproduce sus runtimes. Los permisos y herramientas declarados dentro de un prompt nativo no conceden acceso adicional en Alfred.

- Las definiciones de agentes son prompts seleccionables. Los subagentes en ejecución se muestran cuando el harness publica sus estados usando el [contrato de actividad](subagents.md); descubrir un archivo no crea un subagente.
- Los hooks, comandos internos de las CLIs, expansiones de shell, plugins ejecutables, paquetes/extensiones de Pi, OAuth nativo de MCP y transportes SSE requieren el harness original. Los MCPs de Pi suelen proceder de extensiones y no se importan como configuración nativa.
- No se importan catálogos de plugins, políticas empresariales, instrucciones de ancestros o subdirectorios arbitrarios, reglas condicionales ni patrones glob/remotos. Los casos detectables que necesitan el runtime original aparecen como avisos o recursos no disponibles.
- No se ejecutan scripts al descubrir recursos. Las lecturas tienen límites de tamaño, profundidad y cantidad; se rechazan rutas privadas, hard links y enlaces de workspace que salgan de su ámbito. Los avisos explican archivos inválidos o recursos omitidos.

## Implementación y validación

`src/server/harness-discovery.ts` adapta los formatos; `harness-files.ts` limita lecturas; `harness-runtime.ts` carga contexto; `harness-mcp.ts` normaliza conexiones. `harness-routes.ts` expone catálogo, vista previa y selección mediante las rutas autenticadas `/api/conversations/:id/harnesses`, `/harnesses/resources/:resourceId` y `/harness`.

`tests/harnesses.test.ts` usa directorios personales y repositorios temporales, un modelo controlado y conexiones MCP simuladas. `tests/harnesses.spec.ts` comprueba catálogo, vista previa, comandos del compositor, selección persistente, importación MCP y actualización sin recargar en escritorio y teléfono. No se usan cuentas reales ni llamadas de pago.

Referencias de formatos: [Codex](https://learn.chatgpt.com/docs/config-file/config-reference), [skills de Claude Code](https://code.claude.com/docs/en/skills), [MCP de Claude Code](https://code.claude.com/docs/en/mcp), [configuración de OpenCode](https://opencode.ai/docs/config/), [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs).
