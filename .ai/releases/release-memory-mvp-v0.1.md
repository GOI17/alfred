# Release memory-mvp-v0.1

`memory-mvp-v0.1` congela el MVP funcional de Alfred Memory para validación de uso real.

## Tag

```
memory-mvp-v0.1 → 865e09e
```

## Commits principales

| Commit | Descripción |
|--------|-------------|
| `f484caf` | feat(memory): add namespace partition |
| `95f5881` | feat(memory): add deterministic memory policy |
| `0885911` | feat(memory-client): add official memory api client |
| `1eb0b07` | feat(memory-mcp): add mcp adapter for memory api |
| `d013e37` | docs(memory-mcp): add codex e2e integration guide |
| `cdfe4c3` | feat(memory-openapi): add ChatGPT Actions OpenAPI schema for Alfred Memory |
| `78d67ab` | chore(memory-e2e): add reproducible E2E environment for memory MVP validation |
| `865e09e` | fix(memory-e2e): make E2E environment runnable without psql and with correct postgres wiring |

## Funcionalidades incluidas

- **Memory Core** (`packages/memory`): CRUD de memorias, namespaces, tipos (`preference`, `fact`, `decision`, `workflow`, `project`, `correction`, `source`), metadatos, confianza, expiración, PostgreSQL e in-memory stores.
- **MemoryPolicy**: reglas determinísticas para decidir cuándo buscar/guardar/contextualizar memoria.
- **memory-client** (`packages/memory-client`): cliente HTTP oficial para la Memory API.
- **memory-mcp** (`packages/memory-mcp`): servidor MCP para integrar Alfred Memory con Codex / Claude / OpenCode / Copilot.
- **memory-openapi** (`packages/memory-openapi`): esquema OpenAPI 3.1 para ChatGPT Actions, con autenticación Bearer y operaciones `searchMemories`, `listMemories`, `createMemory`, `updateMemory`, `deleteMemory`.
- **memory-e2e** (`packages/memory-e2e`): entorno reproducible con Docker Compose para PostgreSQL, scripts de inicio de API, túneles Cloudflare/ngrok, smoke tests para Codex/MCP y ChatGPT Actions, `.env.example` y README/checklist.

## Decisiones arquitectónicas relevantes

- **Namespace por defecto**: `personal` cuando no se especifica; `project:<projectId>` cuando se envía `projectId`.
- **Namespace inmutable**: no se permite cambiar `namespace` mediante `PATCH`; para mover una memoria se requiere un endpoint futuro (`memory_move`).
- **Auth MVP**: JSON estático `MEMORY_API_KEYS` mapeando API key a `userId`.
- **ChatGPT Actions**: usa Bearer token (`Authorization: Bearer <apiKey>`) porque ChatGPT Actions no soporta custom headers como `x-api-key`.
- **MCP para agentes locales**: `memory-mcp` expone herramientas `memory_search`, `memory_create`, `memory_update`, `memory_delete`, `memory_list`.
- **Sin memoria nativa de ChatGPT**: Alfred Memory es un servicio externo invocado por Actions, no una integración con la memoria nativa de ChatGPT.

## Estado de validación E2E

- PostgreSQL 16 levantado vía Docker Compose.
- Memory API conectada a PostgreSQL.
- Smoke test **Codex/MCP** (`packages/memory-e2e/scripts/smoke-codex.mjs`): ✅ create/search/delete.
- Smoke test **ChatGPT Actions** (`packages/memory-e2e/scripts/smoke-chatgpt.mjs`): ✅ create/list/delete.
- Validación manual de ChatGPT Actions con HTTPS público: **pendiente** (requiere túnel Cloudflare/ngrok y config de Custom GPT).

## Limitaciones conocidas

- **User Provisioning & Identity**: la tabla `alfred_memories` tiene una FK a `alfred_memory_users(id)`. La API key resuelve un `userId`, pero si el usuario no existe previamente en `alfred_memory_users`, la creación de memoria falla. Los clientes actuales (`memory-mcp`, `memory-openapi`, `memory-client`) no crean usuarios automáticamente.
- **Auth compartida**: `MEMORY_API_KEYS` es una única JSON map. Funciona para uso personal, no para multiusuario real.
- **Búsqueda textual simple**: búsqueda por `ILIKE` sobre contenido, tags, metadata, etc. No embeddings ni búsqueda híbrida.
- **Sin dashboard**: gestión de memorias solo vía API/MCP.
- **Sin move/merge/dedupe**: no se pueden mover memorias entre namespaces ni fusionar duplicados.

## Issues abiertos

- [#59 User Provisioning & Identity](https://github.com/GOI17/alfred/issues/59): diseño de modelo de identidad, API key lifecycle, flujo de bootstrap y compatibilidad con MCP/ChatGPT Actions. **No implementar todavía**; solo diseño/decisión.

## Criterios para avanzar a v0.2

Antes de implementar nuevas funcionalidades, se requiere evidencia de uso real que confirme al menos una de estas fricciones recurrentes:

1. **User Provisioning bloquea uso diario** → implementar issue #59.
2. **Administrar memorias manualmente se vuelve difícil** → dashboard mínimo.
3. **Búsqueda textual es insuficiente** → embeddings / búsqueda híbrida.
4. **Mover memorias entre contextos es necesario recurrentemente** → `memory_move`.

Regla de decisión: una fricción documentada 3 veces se convierte en issue; si aparece una vez, se documenta y observa.

## Notas de uso

- Copiar `packages/memory-e2e/.env.example` a `.env` y ajustar secrets.
- Ejecutar `pnpm --filter @alfred-labs/memory-e2e setup` para levantar PostgreSQL.
- Ejecutar `pnpm --filter @alfred-labs/memory-e2e start` para iniciar la API.
- Para ChatGPT Actions, levantar túnel con `pnpm --filter @alfred-labs/memory-e2e tunnel:cloudflare` o `tunnel:ngrok`.

## Validación

- `git diff --check -- packages/memory-openapi packages/memory-e2e`
- `node --check packages/memory-openapi/test/openapi.test.js`
- Smoke tests ejecutados contra PostgreSQL real en el contenedor E2E.
