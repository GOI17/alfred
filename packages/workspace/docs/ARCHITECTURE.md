# Arquitectura de Alfred Workspace

## Límite del paquete

`@alfred-labs/workspace` no depende de las implementaciones Memory ni Agent Harness. Su CLI pública es `alfred-workspace`; el dispatcher del producto delega `alfred workspace` a la misma función `run(args, env)`. Ayuda y versión no cargan el servidor. `startWorkspace` sólo escucha y abre estado tras una invocación explícita.

`createApp({ sessionAdapter })` admite un runtime externo mediante los contratos públicos `SessionPort` y `SessionAdapter`. Ese runtime controla ejecución, herramientas, permisos y recuperación. El descriptor `/api/runtime` refleja lo que reporta el adaptador; `null` representa un catálogo no comunicado y `[]` un catálogo explícitamente vacío. El modo autónomo conserva `createLegacySessionAdapter` como compatibilidad. Workspace no asume ACP ni descubre otros productos Alfred.

Los assets de producción y Vite de desarrollo se resuelven desde el paquete, sin cambiar el directorio del proceso. El estado se guarda fuera de la instalación, normalmente en `~/.alfred-workspace`; el arranque rechaza destinos dentro del paquete, también a través de enlaces simbólicos.

## Un servidor es un host de ejecución

React se conecta a un servidor Fastify mediante HTTP, eventos SSE y WebSockets. El servidor posee los proyectos, worktrees, conversaciones, herramientas y credenciales. El cliente puede vivir en la misma computadora o en el teléfono: nunca interpreta una ruta del servidor como ruta local.

`WorkspaceService` coordina las operaciones de recursos. `Store` guarda snapshots JSON mediante escritura temporal y renombrado, con una cola que evita perder cambios concurrentes dentro del proceso. Las mutaciones de recursos se serializan. Solo debe ejecutarse una instancia por directorio de datos.

## Modelo

- Un **proyecto** registra una carpeta Git o una carpeta normal.
- Un **workspace** es la carpeta del proyecto o uno de sus worktrees de Git. Se vuelve a validar contra Git antes de acceder a sus herramientas.
- Una **conversación** pertenece a un proyecto y workspace. Contiene mensajes y un árbol de paneles.
- Un **panel** es chat, terminal, navegador o Git. Cada conversación mantiene exactamente un chat. Los identificadores de panel son exclusivos entre conversaciones.

El árbol de paneles usa divisiones binarias con proporciones. Escritorio muestra el árbol; teléfono muestra una hoja seleccionada. La selección del cliente es independiente y el árbol se comparte entre dispositivos.

## Agentes nativos

`Chat` es el único propietario del estado de las generaciones: disponible, trabajando, esperando aprobación o error. No infiere estado leyendo una terminal. SSE distribuye el estado y la respuesta parcial a todos los clientes. Perder la conexión significa estado no verificable para el cliente, no que el trabajo haya terminado.

Los adaptadores del AI SDK usan APIs oficiales. El proveedor recibe mensajes y herramientas de archivos acotadas al workspace. Las propuestas de escritura esperan una decisión del usuario; múltiples propuestas se revisan en secuencia. Detener un turno cancela la solicitud y las aprobaciones pendientes.

Las credenciales de API y OAuth se cifran antes de escribirlas. `ChatgptOAuth` mantiene registros por identidad validada y client ID, un identificador estable del host, PKCE por intento y una renovación serializada por sesión. El listener de retorno solo escucha en loopback. Los tokens no llegan al cliente web. Las peticiones de Responses usan `store: false` y streaming.

## Terminal y navegador

La terminal usa `node-pty` y xterm.js. Sus procesos pertenecen al servidor y las conexiones web solo se adjuntan a ellos. La salida se acota; clientes demasiado lentos se desconectan y pueden recuperar el buffer. Al cerrar un panel se termina su PTY.

Cada panel de navegador posee un contexto de Chromium headless. Playwright opera páginas reales y transmite capturas JPEG por WebSocket. Así se conservan cookies, JavaScript y navegación sin modificar el HTML ni eliminar cabeceras de seguridad de terceros. La excepción para certificados es explícita y exclusiva de ese contexto. No existe un proxy que reescriba páginas.

## Git y archivos

`project-selection.ts` conecta el botón de alta con el diálogo nativo del host mediante `native-folder-picker.ts`. Solo admite peticiones autenticadas desde loopback, un diálogo a la vez y carpetas verificadas nuevamente por el servidor. Cancelar o desconectar al cliente no registra un proyecto y termina la espera del proceso. No se enumeran carpetas del servidor para dibujar un selector web. Los adaptadores utilizan [choose folder de macOS](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/PromptforaFileorFolder.html), [BrowseForFolder de Windows](https://learn.microsoft.com/en-us/windows/win32/shell/shell-browseforfolder) y Zenity/KDialog en Linux. Los scripts son estáticos, sin interpolar datos del cliente ni modificar políticas de ejecución.

Los comandos se ejecutan con argumentos separados, sin shell, a través de `runProcess`. La base es Git 2.25: `worktree list --porcelain`, `worktree add`, `worktree remove`, `status`, `log` y `diff`. No se utilizan comandos específicos de GitHub ni recorridos de todos los refs. Los resultados están acotados y las operaciones tienen límite de tiempo.

Quitar un proyecto no borra su carpeta. Eliminar un worktree utiliza Git sin `--force`, conserva la rama y rechaza el workspace principal. Una carpeta normal puede tener conversaciones, terminal y navegador; no recibe controles de worktree o Git.

## Acceso

El primer acceso necesita el código del servidor. El navegador recibe una cookie HttpOnly con SameSite estricto. Las APIs y WebSockets verifican autenticación y origen; el endpoint de conexión tiene límite de intentos. `--share` es explícito y el modo predeterminado usa loopback. HTTPS puede terminar directamente en Fastify.

Este es un servidor personal con permisos del usuario anfitrión. No ofrece aislamiento multiusuario ni un sandbox de sistema operativo. La separación de clientes no es una frontera de permisos entre personas.
