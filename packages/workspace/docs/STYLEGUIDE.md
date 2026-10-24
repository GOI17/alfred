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
