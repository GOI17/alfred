# Diseño de Alfred Workspace

La interfaz nueva pertenece a Alfred. La referencia de interacción es la organización por espacios de Arc; no se reutilizan componentes, estilos ni recursos del fork anterior.

## Fuente canónica

Los tokens están en `src/renderer/src/assets/main.css`. Colores, tipografías, superficies, bordes y sombras se definen allí. Los controles reutilizables están en `src/renderer/src/components/ui/`, siguiendo la composición de shadcn: variantes en el primitivo y accesibilidad de Dialog mediante Radix.

## Composición

- Barra lateral verde profunda para proyectos, workspaces y conversaciones; área de trabajo clara.
- Jerarquía: espacio → workspace → conversación → panel. Las herramientas son parte de una conversación.
- Texto de producto en español, con nombres de proveedores y términos de Git reconocibles.
- Los estados vacíos explican el siguiente paso. No mostrar conversaciones ni actividad inventadas.
- Las escrituras propuestas presentan el archivo y su contenido antes de aprobar.
- Borrar y quitar deben describir exactamente qué ocurre con las carpetas y procesos.

## Tokens y controles

Usar `--background`, `--surface`, `--surface-muted`, `--foreground`, `--muted`, `--border`, `--primary` y `--accent` para el área de trabajo. Los tokens `--sidebar-*` pertenecen a la navegación. `--terminal*` solo a la terminal. Las diferencias de Git utilizan `--diff-add` y `--diff-remove`.

DM Sans es la tipografía de lectura; Manrope se reserva para títulos y marca. Ambas se distribuyen localmente. La escala base es 11, 13, 14, 18, 28 y 40 px. Las excepciones de 8–10 px son metadatos y marcas compactas; el logo ilustrado usa 66 px. En teléfono los campos editables usan 16 px para evitar zoom involuntario. Preferir la escala antes de agregar tamaños.

Los botones se eligen por `variant` y `size`; no recibirán clases de restyling desde sus consumidores. Los diálogos deben tener título, descripción y cierre accesible. Los botones de icono necesitan un nombre accesible incluso si su etiqueta visible se oculta en teléfono.

Agregar un proyecto abre directamente el selector nativo de carpetas del sistema, desde el navegador local de la computadora que ejecuta Alfred. No construir un explorador de archivos dentro de la web ni pedir una ruta o nombre manuales. El nombre se deriva de la carpeta del proyecto. En clientes remotos, explicar que el alta se realiza en la computadora; los proyectos existentes siguen disponibles.

## Teléfono y teclado

A 700 px o menos, la barra lateral es un cajón y los paneles son pestañas. El cajón cerrado queda inerte para teclado y lectores de pantalla. El contenido no debe provocar desplazamiento horizontal del documento. Las sesiones no terminan al ocultar un panel.

Respetar `prefers-reduced-motion`, foco visible y áreas seguras. Los atajos al estilo tmux usan el prefijo Ctrl+B en todas las plataformas; cualquier nuevo atajo de aplicación debe resolver Cmd en macOS y Ctrl en Windows/Linux.

## Verificación y resolución

`pnpm lint` comprueba hooks, tipos sin assertions y el límite de líneas; `pnpm tc` comprueba TypeScript. La suite Playwright valida escritorio y teléfono en segundo plano. La versión nueva no utiliza Tailwind ni las reglas de lint del fork eliminado.

Si falta una regla: reutilizar primero un patrón existente; después añadir una variante al primitivo; por último documentar un nuevo token o comportamiento aquí. No reintroducir dependencias del fork para resolver una decisión visual.

## Contrato de implementación: adopción incremental

Las reglas siguientes aplican al código nuevo y a los componentes modificados de Workspace. Son requisitos verificables, no una declaración de cumplimiento de toda la interfaz existente. No introducir otro framework visual ni acoplar las capacidades independientes del producto.

### 1. Tokens semánticos

- Elegir tokens por función, no por nombre de color. No agregar colores literales fuera de las definiciones de tokens, salvo recursos externos o contenido del usuario.
- Mantener separados superficie, texto, borde, acción, foco y estado. El foco debe tener un token propio, no depender semánticamente del color de éxito.
- Reutilizar las escalas de tipografía y radios. Incorporar tokens de espaciado, tamaño de controles y duración antes de repetir nuevas constantes. Las dimensiones calculadas de paneles no requieren tokens.
- Documentar propósito, ámbito y combinaciones de fondo admitidas para cada token nuevo. Registrar excepciones con motivo y alcance.
- Migrar por familias de componentes, preservando nombres existentes cuando su significado sea correcto; evitar sustituciones globales ciegas.

### 2. Accesibilidad: objetivo WCAG 2.2 AA

- Usar HTML nativo: botones para acciones, enlaces para navegación y etiquetas asociadas a campos. Un placeholder o tooltip no sustituye una etiqueta.
- Todos los controles requieren nombre accesible. Asociar ayuda y errores mediante `aria-describedby`; utilizar `aria-invalid` cuando corresponda.
- Permitir operar con teclado, sin trampas de foco. Mantener foco visible y no completamente oculto por contenido fijo. No eliminar outline sin alternativa perceptible.
- Reutilizar el diálogo Radix existente con título, descripción, foco inicial deliberado, contención, cierre accesible y retorno al activador.
- Medir contraste real: 4.5:1 para texto normal, 3:1 para texto grande según WCAG y 3:1 para información visual necesaria de controles y estados.
- No comunicar estados únicamente con color. Cumplir objetivos de interacción de 24 × 24 CSS px o excepciones válidas de WCAG 2.2; procurar 44 × 44 CSS px para controles táctiles principales.
- Respetar movimiento reducido y colores forzados. Mantener orden de DOM coherente con lectura y navegación.
- Anunciar cambios breves con regiones de estado apropiadas. Reservar alertas interruptivas para errores urgentes; no anunciar cada token generado.

### 3. Diseño adaptable

- Conservar el contrato móvil de 700 px y adaptar también componentes al espacio disponible dentro del panel, no solo al viewport.
- Verificar reflow a 320 CSS px, texto ampliado al 200 % y zoom al 400 % desde una ventana de 1280 CSS px, sin pérdida de contenido ni acciones.
- Evitar scroll horizontal del documento. Código, tablas, diffs y terminal pueden tener scroll local cuando requieren representación bidimensional.
- No depender de hover para acciones esenciales: deben ser accesibles con teclado y toque. Conservar nombres accesibles si se ocultan etiquetas visibles.
- Permitir textos largos y ofrecer acceso al valor completo cuando se trunque contenido.
- Mantener borradores, aprobaciones y sesiones al redimensionar u ocultar paneles. Ocultar no equivale a cancelar.
- Contemplar teclado virtual, orientación y áreas seguras. No bloquear zoom.

### 6. Interacción con IA y herramientas

- Diferenciar usuario, contenido generado y resultados de herramientas. Mostrar modelo/proveedor solo si el runtime lo informa. No inventar fuentes, confianza, progreso ni resultados.
- Reflejar estados reales del runtime: en cola, ejecutando, esperando aprobación, cancelación solicitada, cancelado, completado y error, según el contrato disponible.
- Separar propuesta, autorización, ejecución y resultado. Una aprobación no prueba ejecución; declarar éxito solo tras confirmación del backend.
- Antes de acciones sujetas a aprobación, mostrar operación, destino, alcance e impacto. Mostrar contenido o diff para archivos y comando/directorio para ejecución. La aprobación corresponde a la operación exacta revisada.
- Ofrecer aprobar y rechazar. La UI no sustituye controles del servidor ni amplía permisos silenciosamente. Revisar de nuevo cambios de alcance cuando corresponda.
- Ofrecer detener si el runtime lo admite. Diferenciar solicitud y confirmación de cancelación; explicar que detener no revierte efectos anteriores.
- Conservar borradores y resultados parciales ante errores. No reintentar automáticamente acciones con efectos cuando el resultado anterior sea incierto.
- Ofrecer deshacer solo cuando exista una operación inversa real y segura; en otro caso explicar recuperación y límites.
- Durante streaming, no robar foco ni forzar scroll cuando la persona lee mensajes anteriores. Anunciar fases o finalización, no cada fragmento.
- Tratar contenido generado y salidas de herramientas como datos no confiables: no ejecutarlos ni convertirlos en HTML sin controles de seguridad. Mostrar fuentes solo cuando existe evidencia disponible.

## Checklist de aceptación de cambios de UI

Cada PR debe indicar criterios aplicables, evidencia y excepciones:

- [ ] Tokens reutilizados; nuevos tokens y excepciones documentados.
- [ ] Nombres, etiquetas, teclado, foco y retorno de diálogos comprobados.
- [ ] Contraste medido; estados comprensibles sin depender del color.
- [ ] Reflow, zoom, texto ampliado y entrada táctil/teclado comprobados.
- [ ] Movimiento reducido y colores forzados revisados cuando corresponda.
- [ ] Estados de IA, aprobación, rechazo, error y cancelación cubiertos si aplican.
- [ ] Sin reintentos inseguros, permisos implícitos ni éxito anticipado.
- [ ] Pruebas de regresión del comportamiento modificado.

Ejecutar `pnpm lint` y `pnpm tc` desde `packages/workspace`, además de las suites Vitest y Playwright pertinentes declaradas en `package.json`. Probar estados de IA con runtimes simulados, sin llamadas reales a proveedores. Complementar automatización con revisión manual de teclado, zoom y lector de pantalla. Una suite automática no demuestra por sí sola conformidad WCAG.

### Secuencia inicial de adopción pendiente

1. Inventariar tokens, colores literales y estados; medir contraste.
2. Migrar foco, campos, botones y diálogos.
3. Adaptar compositor y aprobaciones a paneles estrechos y texto ampliado.
4. Cubrir estados de IA y recuperación con pruebas de regresión.

Añadir estas reglas no migra ni certifica automáticamente los componentes existentes.


### Primer bloque implementado: primitivas compartidas

Foco, campos, botones y diálogos tienen una primera implementación con regresiones automatizadas. Esto no implica que todos los consumidores o controles personalizados estén migrados.

| Token | Propósito y ámbito |
| --- | --- |
| `--focus-ring` | Foco sobre `--surface` y `--surface-muted`; variante por tema, independiente de éxito. |
| `--focus-ring-inverse` | Foco sobre fondos oscuros `--sidebar` y `--terminal`; se asigna localmente al token de foco. |
| `--control-border` | Límite perceptible de campos y botones secundarios sobre superficies normales y atenuadas. `--border` sigue siendo decorativo. |
| `--control-height` | Altura mínima estándar: 38 px. |
| `--control-compact` | Control compacto e icono de escritorio: 30 px. |
| `--control-touch` | Objetivo táctil de primitivas: 44 px en viewport estrecho o puntero grueso. Los overrides de consumidores requieren revisión propia. |
| `--motion-control` | Transición de controles: 150 ms; respetar las reglas de movimiento reducido. |

El texto atenuado del tema claro se oscureció para mejorar contraste. Los campos conservan foco visible interior y admiten `aria-invalid` y `aria-describedby` nativos: cada consumidor sigue siendo responsable de etiquetas y mensajes de error. En colores forzados se usan colores del sistema y borde discontinuo para campos inválidos.

Los botones permiten etiquetas multilínea y las acciones de diálogo pueden envolver. El diálogo limita su altura al viewport dinámico con áreas seguras, enfoca inicialmente el título y devuelve el foco al activador conectado. Conserva los callbacks de autofocus: las confirmaciones siguen enfocando Cancelar.

**Regresión:** ejecutar `pnpm test:ui` desde `packages/workspace`. Usa un fixture aislado de los componentes reales, sin backend ni proveedores. Las 14 pruebas cubren escritorio y 320 px, teclado, contención y retorno de foco, nombres y descripciones accesibles, confirmación/cancelación, deshabilitado, temas claro/oscuro, tokens tipográficos duplicados, colores forzados y contraste de las combinaciones documentadas (texto ≥ 4.5:1; foco y borde ≥ 3:1).

**Validación de esta entrega:** `pnpm test:ui` y `pnpm tc` pasan; ESLint de los archivos TypeScript modificados pasa. `pnpm lint` global informa 79 errores en archivos no modificados por este bloque. No se ejecutó la suite completa de aplicación. La comprobación manual con lector de pantalla y zoom real al 400 % sigue pendiente; la emulación a 320 px no la sustituye.

La siguiente etapa es migrar consumidores, compositor y aprobaciones, no volver a crear las primitivas.


### Segundo bloque implementado: compositor y aprobaciones

- Los controles del pie del compositor envuelven sus etiquetas; se adaptan al ancho del panel mediante container queries, no solo al viewport. Las reglas de consumidor se cargan después de los estilos base en `main.tsx`.
- El compositor conserva el valor mientras envía (solo lectura), recalcula altura cuando cambia de ancho y mantiene el foco al seleccionar sugerencias. La lista dispone de nombre, selección y relación con el campo; Escape la cierra sin enviar.
- `approval-card.tsx` presenta una región con título, rutas completas ajustables y contenido no ejecutable con scroll local y foco de teclado. Mantiene las previsualizaciones individuales para lotes y la advertencia de guardado no atómico.
- Aprobar/rechazar referencia el ID exacto de la propuesta. La decisión se bloquea contra duplicados mientras esa tarjeta esté montada, también tras una respuesta incierta. La UI distingue envío, recepción y ejecución: recepción no significa que la operación se completó. No se reenvía automáticamente. El backend sigue siendo responsable de validar permisos e idempotencia; recargar la página no conserva el bloqueo local.

**Evidencia automatizada:** `pnpm test:ui`: 24 pruebas aprobadas (14 del primer bloque y 10 ejecuciones nuevas, escritorio y teléfono a 320 px). El fixture del segundo bloque usa ComposerInput y ApprovalCard reales, controles de pie representativos y API interceptada, sin proveedores. Cubre borrador al estrechar panel y entrar en solo lectura, texto ampliado mediante tokens, ausencia de overflow del panel/documento, previsualización navegable con teclado, sugerencias, aprobar/rechazar por ID y error de recepción sin reintento. `pnpm tc` y ESLint de los archivos TypeScript del bloque pasan.

**Límites:** el fixture no sustituye una prueba integral del chat con ModelPicker y ContextPermissions reales. No certifica todos los controles personalizados ni cumplimiento WCAG. Pendientes revisión manual con lector de pantalla, teclado virtual y zoom real al 400 %, y cobertura integral de estados de IA, cancelación y recuperación del siguiente bloque.

### Tercer bloque implementado: estados del runtime, detención y recuperación

- `chat-runtime-state.tsx` anuncia fases mediante una región estable `role="status"`, `aria-live="polite"` y `aria-atomic="true"`, sin anunciar cada fragmento generado. Distingue actividad, espera, error, inactividad, detención solicitada y confirmada. Inactividad no equivale a éxito.
- `useChatRequest` serializa envío, detención y modificaciones de cola. Ante una respuesta incierta conserva el bloqueo local y no reintenta: la desconexión no demuestra que el servidor rechazó la operación.
- El panel conserva borrador, adjuntos y resultados parciales cuando no se confirma el envío; solo limpia el borrador y los adjuntos tras respuesta satisfactoria. La detención explica que los efectos anteriores no se revierten. Los errores orientan a revisar resultados y cambios antes de continuar.
- El bloqueo se limita a la instancia montada de la conversación. Recargar o cambiar de conversación no proporciona reconciliación ni idempotencia persistente. El borrador textual usa sessionStorage; los adjuntos no persisten tras desmontaje. No se ha añadido un botón de reintento inseguro ni una promesa de deshacer.

**Evidencia automatizada:** `pnpm test:ui`: 34 ejecuciones aprobadas, incluidas 10 nuevas sobre ChatPanel real con ModelPicker y ContextPermissions, en escritorio y móvil de 320 px. API interceptada y estados simulados, sin proveedores. Se comprueban fases, conservación de resultado parcial y borrador, envío aceptado sin éxito anticipado, envío incierto sin reenvío por teclado en escritorio, foco tras enviar y detención pendiente/confirmada/incierta. En móvil se usa el botón de envío: Enter conserva su comportamiento de salto de línea. Las suites de fixtures se excluyen del servidor E2E general y se ejecutan con la configuración UI.

**Límites:** no es una prueba E2E del transporte WebSocket ni de ejecución real del adaptador. No se certifica accesibilidad integral; siguen pendientes lector de pantalla, teclado virtual físico y zoom real al 400 %. La recuperación tras incertidumbre requiere revisar el estado real antes de recargar o reenviar; no existe reconciliación automática añadida por este bloque.


### Cuarto bloque implementado: streaming sin interrumpir la lectura

- El historial es una región con nombre accesible, foco de teclado e indicador de foco semántico. Los fragmentos no trasladan el foco del compositor ni del historial.
- El seguimiento automático se mantiene al estar al final (tolerancia de 2 px). Al desplazarse hacia contenido anterior se suspende; aparece «Volver a lo más reciente», accesible por teclado y con tamaño táctil.
- Volver explícitamente al final libera los anclajes de restauración y navegación anteriores, reanuda el seguimiento y coloca el foco en el historial porque desaparece el botón activador. Enviar también libera esos anclajes y conserva el foco del compositor.
- El seguimiento usa desplazamiento instantáneo, también con movimiento reducido; no introduce animaciones por fragmento. El historial no se convierte en una región viva que anuncie toda la respuesta a cada actualización.

**Evidencia automatizada:** `pnpm test:ui`: 38 ejecuciones aprobadas, incluidas cuatro nuevas combinando escritorio y móvil de 320 px con preferencias de movimiento normal/reducido. Sobre ChatPanel real se verifica desbordamiento interno efectivo, seguimiento de fragmentos al final, conservación de foco y borrador, PageUp para abandonar el final, conservación de posición al crecer el contenido y retorno explícito mediante teclado. El fixture limita la altura disponible como el contenedor de aplicación; espera a que termine el desplazamiento nativo de PageUp antes de medir estabilidad. `pnpm tc` y ESLint de los archivos TypeScript de este bloque pasan.

**Límites:** fragmentos simulados y API interceptada, sin llamadas a proveedores. No cubre transporte WebSocket, gestos físicos o teclado virtual, ni certifica accesibilidad integral. Siguen pendientes lector de pantalla y zoom real al 400 %. No añade idempotencia de backend, reconciliación ni persistencia de adjuntos. La restauración entre montajes y navegación por citas requieren cobertura específica adicional.
