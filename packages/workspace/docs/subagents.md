# Visualización de subagentes: contrato para harnesses

Alfred Workspace es una proyección de solo lectura. No crea, ejecuta, cancela ni elimina subagentes reales. El harness conserva toda la lógica de orquestación. Publicar o quitar una tarjeta solo cambia lo mostrado en la conversación.

## Acceso

Usar la autenticación existente: `POST /api/auth` con `{ "code": "<código del servidor>" }` y conservar la cookie `alfred_session` de la respuesta. No enviar el código en la URL. Las sesiones caducan y se invalidan al reiniciar el servidor. Usar HTTPS fuera de localhost.

Esta integración tiene el mismo nivel de acceso que una sesión de Workspace, **no** credenciales restringidas por harness. `harnessId` es un namespace, no una frontera de autorización. Conectar solo harnesses de confianza. No publicar secretos: el contenido se guarda y se comparte con los clientes autenticados de Workspace.

La conversación debe existir. Su UUID está disponible en `GET /api/state`, dentro de `conversations`. Usar un identificador estable para el harness, codificado como segmento de URL.

```text
POST /api/conversations/:id/harnesses/:harnessId/subagents
GET  /api/conversations/:id/harnesses/:harnessId/subagents
```

GET devuelve `null` si todavía no hay proyección, o `{ harnessId, revision, receivedAt, agents }`. `receivedAt` lo asigna el servidor. Una conversación inexistente devuelve 404.

## Snapshot inicial y resincronización

```json
{
  "type": "snapshot",
  "revision": 1,
  "agents": [
    {
      "id": "explorer",
      "name": "Explorador",
      "task": "Revisar el módulo de autenticación",
      "status": "running",
      "activity": [
        {
          "id": "activity-1",
          "kind": "tool",
          "tool": "read_file",
          "text": "src/server/auth.ts",
          "timestamp": "2026-01-01T12:00:00.000Z"
        }
      ]
    },
    {
      "id": "reviewer",
      "parentId": "explorer",
      "name": "Revisor",
      "task": "Comprobar los casos límite",
      "status": "completed",
      "result": "Revisión completada."
    }
  ]
}
```

Un snapshot sustituye toda la proyección de ese harness, sin afectar a otros. Los agentes sin `parentId` son raíces. Los padres deben pertenecer a la misma proyección; se rechazan ciclos y referencias inexistentes. El harness puede publicar también su agente principal como raíz para mostrar toda su jerarquía.

`status` es texto libre controlado por el harness, no un ciclo de vida impuesto por Alfred. `activity` es opcional (por defecto `[]`); sus entradas tienen `id`, `kind` (`message`, `tool` o `result`) y `text`; `tool` y `timestamp` UTC ISO son opcionales. `result` también es opcional. El texto se representa escapado, sin ejecutar HTML ni herramientas.

## Actualizaciones incrementales

```json
{
  "type": "delta",
  "revision": 2,
  "upsert": [
    {
      "id": "explorer",
      "name": "Explorador",
      "task": "Revisar el módulo de autenticación",
      "status": "completed",
      "activity": [],
      "result": "No se encontraron problemas."
    }
  ],
  "remove": ["reviewer"]
}
```

- `upsert` reemplaza la representación completa de cada agente, **no** aplica un patch parcial ni agrega actividad automáticamente. El harness mantiene y publica la ventana de actividad que quiere mostrar.
- `remove` quita identificadores de la vista, no elimina agentes en el harness. Si se retira un padre, retirar o reasignar también sus descendientes en la misma publicación.
- `upsert` y `remove` son opcionales y por defecto vacíos.
- Las revisiones son enteros positivos seguros de JavaScript, monotónicas por conversación/harness. Un delta requiere `revision = actual + 1` y un snapshot previo.
- Una revisión igual o anterior se ignora: HTTP 200 con `{ "applied": false, "revision": <actual> }`. El payload debe seguir siendo válido. No reutilizar revisiones para contenidos diferentes.
- Una publicación aplicada devuelve `{ "applied": true, "revision": <nueva> }`.
- Ante un salto de delta: HTTP 409. Consultar GET y enviar un snapshot con revisión superior a la actual. Los snapshots sí pueden saltar revisiones. Serializar publicaciones por harness.
- Validación de estructura: 400; conflicto de jerarquía, duplicados o límites de proyección: 409. No se aplica parcialmente una publicación rechazada.

## Persistencia, reconexión y frescura

La última proyección y su actividad se guardan con la conversación. No es un registro ilimitado de eventos: los snapshots y upserts reemplazan datos previos. El estado se incluye en `/api/state` y en los eventos `state` del SSE existente `/api/events`, que envía un snapshot completo al conectar. La UI recupera así la vista al recargar o reconectar, sin reproducir deltas.

Mientras esté conectado, el harness puede publicar un delta vacío cada 30 segundos **con una nueva revisión** como heartbeat. Repetir una revisión no renueva `receivedAt`. Después de 60 segundos sin publicaciones, la UI advierte que no hay actualizaciones recientes y que la conexión no está confirmada. Esto no prueba una desconexión: HTTP no mantiene una sesión de presencia del harness. No se cambia el estado de ningún subagente ni se marca como terminado por ausencia de actividad.

La UI aparece dentro del chat cuando existe al menos una proyección. Agrupa por harness, muestra jerarquía y estados, y permite desplegar tareas, actividad y resultados. No ofrece controles de gestión.

## Límites

- 10 harnesses por conversación; 100 agentes por harness.
- Identificadores: 128 caracteres; nombre: 200; tarea: 4000; estado: 100.
- 100 entradas de actividad por agente, con identificadores únicos; texto: 8000 caracteres; herramienta: 200.
- Resultado: 16000 caracteres; proyección serializada: 200000 caracteres por harness.
- Se aplica además el límite HTTP de cuerpo del servidor. El harness debe agrupar actualizaciones y truncar la actividad según estos límites.

El contrato validado y los tipos TypeScript están en `src/shared/subagents.ts`. La entrada HTTP está en `src/server/subagents.ts`.
