# Alfred Workspace

Un espacio propio para proyectos, conversaciones y herramientas. Aplicación web local, construida desde cero: la computadora ejecuta el servidor y el teléfono se conecta al mismo espacio.

## Empezar

Workspace es un paquete independiente de Alfred. No requiere Memory ni Agent Harness y no los inicia ni conecta automáticamente. Una instalación del producto que incluya Workspace ofrece ambas entradas:

```sh
alfred workspace serve
alfred-workspace serve
```

`alfred workspace --help` y `alfred-workspace --version` funcionan sin arrancar el servidor. Para otro puerto o un directorio de datos explícito:

```sh
alfred workspace serve --port 4320 --data-dir "$HOME/mi-workspace"
```

Los datos permanecen fuera del paquete instalado, por defecto en `~/.alfred-workspace`; actualizar Alfred no requiere volver a crear este estado. Puedes ejecutar el comando desde cualquier proyecto, incluso si la ruta contiene espacios. El servidor conserva el proyecto de trabajo del invocador y resuelve sus recursos web desde el paquete.

Requiere Node.js 22.12 o posterior y Git 2.25 o posterior. La terminal usa el shell del sistema; no requiere tmux. El navegador es opcional: instala Chromium/WebKit de Playwright cuando quieras usar sus paneles. Su ausencia no impide iniciar Workspace ni usar el resto de las herramientas. Para desarrollo desde la raíz del monorepo, con las dependencias previamente instaladas:

```sh
pnpm --filter @alfred-labs/workspace dev
# Navegadores opcionales (descarga explícita):
pnpm --filter @alfred-labs/workspace browser:install
```

Abre `http://localhost:4310` e introduce el código que aparece en la consola. **Agregar proyecto** abre directamente el selector nativo de carpetas del sistema operativo. Elige una carpeta y Alfred obtiene el nombre automáticamente; cancelar no agrega nada. Solo se aceptan carpetas, incluidas las vacías. Si seleccionas una subcarpeta de un repositorio Git, se agrega la raíz del repositorio con su nombre. Después crea una conversación. Las fuentes se sirven localmente; la interfaz no depende de Google Fonts.

El selector se abre en el escritorio de la computadora que ejecuta Alfred y requiere acceder por `localhost`. macOS usa su diálogo de carpetas y Windows el diálogo del Shell; Linux necesita Zenity o KDialog y una sesión gráfica. El alta mediante selector nativo no está disponible desde un teléfono, otra computadora, una sesión SSH o un servidor sin escritorio. Los proyectos ya agregados siguen disponibles en los clientes remotos. No se suben ni se copian archivos desde el navegador.

Para ejecutar la compilación de producción:

```sh
pnpm --filter @alfred-labs/workspace build
pnpm --filter @alfred-labs/workspace start
```

## Usar desde el teléfono

```sh
alfred workspace serve --share
# O durante el desarrollo:
pnpm --filter @alfred-labs/workspace dev --share
```

El servidor muestra sus direcciones de red. Conecta ambos dispositivos a la misma red, abre la dirección en el teléfono y usa el mismo código. El botón de teléfono en Alfred también muestra las direcciones disponibles. Las conversaciones, paneles y procesos pertenecen al servidor; cerrar una pestaña no termina una sesión.

El modo normal escucha únicamente en loopback. `--share` habilita la red local. HTTP no cifra el tráfico: para una red no confiable o acceso fuera de casa, utiliza HTTPS o una VPN privada. Este servidor es un espacio personal con acceso al shell del usuario, no un servicio multiusuario público.

| Variable                             | Uso                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `ALFRED_WORKSPACE_HOST`                        | Interfaz de escucha; por defecto `127.0.0.1`.                                     |
| `ALFRED_WORKSPACE_PORT`                        | Puerto; por defecto `4310`.                                                       |
| `ALFRED_WORKSPACE_DATA_DIR`                    | Datos; por defecto `.alfred-workspace` dentro de la carpeta personal.             |
| `ALFRED_WORKSPACE_ACCESS_TOKEN`                | Código de conexión opcional. Sin esta variable se genera y guarda uno aleatorio.  |
| `ALFRED_WORKSPACE_TLS_CERT` / `ALFRED_WORKSPACE_TLS_KEY` | Archivos de certificado y clave para servir Alfred por HTTPS. Se necesitan ambos. |

Se conservan `ALFRED_HOST`, `ALFRED_PORT`, `ALFRED_DATA_DIR`, `ALFRED_ACCESS_TOKEN`, `ALFRED_TLS_CERT` y `ALFRED_TLS_KEY` como alias de compatibilidad. Las variables `ALFRED_WORKSPACE_*` tienen prioridad.

Las variables se configuran con el mecanismo del shell o del servicio que inicia Alfred. El servidor no carga automáticamente un archivo `.env`. Ejecuta una sola instancia por directorio de datos. Detrás de un proxy, conserva `Host` y `Origin`; termina TLS en Alfred para mantener la verificación de origen y las cookies seguras.

## Primera etapa

- **Espacios:** agregar, listar y quitar proyectos Git o carpetas normales. Quitar un proyecto conserva sus archivos y worktrees en disco.
- **Worktrees:** listar los worktrees reales de Git, crear una nueva rama desde `HEAD` y eliminar worktrees secundarios. Git rechaza la eliminación si hay cambios locales. La rama se conserva. El modal muestra la ruta completa de destino: por defecto, `<ALFRED_WORKSPACE_DATA_DIR>/worktrees/<proyecto>/<id>` (`~/.alfred-workspace` es el directorio de datos habitual). «Cambiar ruta» permite indicar otra carpeta nueva para ese worktree, mediante una ruta absoluta o `~/…` en el equipo donde se ejecuta Alfred.
- **Conversaciones:** historial persistente por proyecto y workspace, chat nativo en streaming, detener respuestas e indicador de actividad del servidor.
- **Paneles:** conversación, terminal, navegador e historial Git; división horizontal o vertical, redimensionado y cierre. Máximo ocho paneles por conversación. En teléfono se cambia de panel mediante pestañas.
- **Terminal:** PTY real por panel, reconexión con hasta 256 KB de salida y teclas auxiliares para teléfono. Es una herramienta independiente: los agentes no usan una CLI ni se representan mediante terminales.
- **Navegador:** Chromium headless en el servidor, con vista e interacción remotas. Abre HTTP y HTTPS, incluidas páginas que rechazan iframes. La opción de certificados autofirmados aplica al contexto de ese panel en la siguiente navegación; recrearlo borra sus cookies. No se desactiva TLS para las APIs de modelos.
- **Git:** commits paginados, archivos modificados y diffs de commits, cambios preparados y cambios sin preparar. Las vistas grandes se limitan a 2 MB.

Atajos: `Ctrl+B`, seguido de `%` divide con una terminal a la derecha; `"` divide abajo; `o` cambia de panel; `c` crea una conversación. Son atajos de estilo tmux dentro de Alfred, no sesiones de tmux.

## Modelos y cuentas

En Ajustes puedes guardar una API key y el identificador exacto de un modelo de **OpenAI, Anthropic o Google**. Las llamadas salen del servidor. Las claves se cifran con AES-256-GCM y no se incluyen en el estado enviado a los clientes. La clave maestra vive en el mismo servidor: el cifrado protege los archivos de credenciales, no una computadora comprometida. En Windows, protege el directorio de datos con los permisos de tu cuenta del sistema.

También está implementado **Continue with ChatGPT** con el flujo oficial de registro dinámico para aplicaciones locales: PKCE, estado, nonce, verificación de firma del ID token, catálogo de modelos, renovación de tokens y cierre de sesión. Se conservan registros separados por cuenta y cliente. La autorización debe iniciarse desde un navegador en la computadora del servidor, porque el retorno oficial es un listener HTTP en `127.0.0.1`; después la conexión puede usarse desde el teléfono. Si ejecutas Alfred en un host SSH sin navegador local, usa una API key en esta etapa.

Selecciona un modelo después de conectar ChatGPT. El consumo elegible usa tu plan y puede administrarse en [Ajustes de uso de ChatGPT](https://chatgpt.com/settings/usage). La disponibilidad depende de la cuenta y del proveedor. El flujo sigue la [documentación oficial de registro](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) y de [modelos e inferencia](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

El agente puede listar carpetas, leer archivos de texto de hasta 100 KB y proponer escrituras dentro del workspace. **Cada escritura requiere aprobación** con el contenido visible en el chat. No tiene una herramienta de shell. La terminal independiente sí ejecuta lo que escriba el usuario. Los archivos necesarios para responder se comparten con el proveedor seleccionado.

## Integración con runtimes

El contrato público `@alfred-labs/workspace/session-port` define `SessionPort`; `@alfred-labs/workspace/session-adapter` define `SessionAdapter` y su factory. Un integrador puede pasar `sessionAdapter` a `createApp` desde `@alfred-labs/workspace/app`. El runtime elegido es dueño de la ejecución y reporta sus capacidades; Workspace no instala herramientas ni configuración del adaptador de compatibilidad en un runtime inyectado. Esta API no declara soporte ACP ni presupone otro componente de Alfred.

El arranque autónomo conserva el adaptador de ejecución legacy de este proyecto. Las credenciales, configuración y recursos que se describen abajo pertenecen a ese modo de compatibilidad.

## Recursos de agent harnesses

En **Ajustes → Agent harnesses**, Alfred descubre comandos, skills, definiciones de agentes, instrucciones y MCPs locales de Codex, Claude Code, OpenCode y Pi. Muestra su archivo de origen y permite activarlos por conversación. Los comandos aparecen al escribir `/`; los MCPs se importan como referencias y mantienen los permisos de Alfred. El catálogo se actualiza sin recargar la aplicación.

Alfred ejecuta estos prompts con su motor de chat. Los hooks, plugins y la orquestación nativa permanecen en cada harness; los estados de subagentes llegan mediante la API de actividad. Consulta [rutas, compatibilidad y funcionamiento](docs/HARNESSES.md).

## Límites de esta base

- Las sesiones de terminal y navegador sobreviven a desconexiones, pero no a un reinicio del servidor. Proyectos, conversaciones y disposición de paneles sí se conservan.
- El navegador transmite imágenes aproximadamente dos veces por segundo. Incluye navegación, clics, teclado y desplazamiento; no implementa descargas, cargas de archivos, audio, permisos del navegador ni arrastre.
- El chat conserva el historial visible, pero envía hasta los últimos 60 mensajes al modelo y admite hasta 12 pasos de herramientas por turno. No hay compactación automática ni gestión de presupuestos todavía.
- Las operaciones de Git, archivos y terminal ocurren siempre en el host del servidor. No hay ejecución SSH desde el cliente ni administración de múltiples servidores.
- Las pruebas de modelos y OAuth usan respuestas controladas y JWT firmados de prueba. No se han hecho llamadas de pago ni autorizado una cuenta real. La validación local se realizó en macOS; Windows y Linux requieren ejecutar la misma suite en esas plataformas.

## Desarrollo y validación

```sh
pnpm --filter @alfred-labs/workspace tc
pnpm --filter @alfred-labs/workspace test
pnpm --filter @alfred-labs/workspace build
pnpm --filter @alfred-labs/workspace test:package
pnpm --filter @alfred-labs/workspace test:e2e
pnpm --filter @alfred-labs/workspace test:chat
pnpm --filter @alfred-labs/workspace lint
```

Las pruebas usan repositorios temporales, PTYs reales y Chromium headless. Cubren worktrees, persistencia, orígenes y autenticación, secretos cifrados, aprobaciones, OAuth, navegador HTTP/HTTPS y flujos de escritorio y teléfono. El selector nativo se sustituye por respuestas controladas; se prueban selección, cancelación, acceso local y cierre al desconectarse. `ORCA_BACKGROUND_LAUNCH=1` impide abrir el diálogo real durante las pruebas. La validación visual nativa queda para una sesión manual o un escritorio aislado. No abren ventanas ni toman el foco. `test:e2e` recompila antes de probar.

La arquitectura está en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y las reglas de interfaz en [docs/STYLEGUIDE.md](docs/STYLEGUIDE.md).

## Actividad y notificaciones PWA

La campana de la barra superior abre **Actividad y notificaciones**: muestra los chats en ejecución o esperando aprobación y permite abrirlos. El contador se actualiza con el estado del servidor; sin conexión se avisa de que puede estar desactualizado.

Pulsa **Activar alertas** y concede permiso en cada dispositivo para recibir notificaciones de finalización, error y aprobación. Puedes desactivarlas desde el mismo panel. No se envía el contenido ni el título del chat. Tocar una alerta abre la conversación; si la sesión expiró, primero debes autenticarte. Las suscripciones persisten entre reinicios del servidor hasta desactivarlas o revocar el permiso en el navegador.

- Requiere HTTPS con certificado confiable (localhost permite pruebas de escritorio), un navegador con Web Push y el servidor encendido con acceso a Internet. HTTP mediante una IP de red local no funciona.
- En iPhone/iPad se necesita iOS/iPadOS 16.4+, añadir Alfred a la pantalla de inicio y abrirlo desde allí.
- Configura `ALFRED_PUSH_SUBJECT` con un contacto del administrador en formato `mailto:tu-correo@dominio.com` o una URL HTTPS. Las claves VAPID se generan automáticamente y se guardan cifradas, igual que las suscripciones.
- Usa una dirección HTTPS estable: permisos e instalación están asociados al origen. Para abrir el chat, el dispositivo necesita acceso al servidor.
- La entrega depende de la conexión y de los ajustes del sistema; los avisos caducan tras diez minutos y se agrupan por conversación.
- No son Live Activities nativas ni aparecen en Dynamic Island. No hay modo offline: el service worker no almacena chats, credenciales ni respuestas de la API en caché.

Las pruebas de notificaciones simulan el proveedor push; la entrega real en un teléfono requiere una comprobación manual con permisos concedidos.

La procedencia del snapshot y las adaptaciones están en [UPSTREAM.md](UPSTREAM.md).
