# Workspace en segundo plano

```sh
alfred workspace
alfred workspace stop
alfred workspace restart
```

Sin subcomando, o con `start`, Workspace se inicia como un proceso separado de la terminal. El comando espera a que el servidor esté escuchando antes de confirmar el inicio. Cerrar la terminal no detiene el daemon. No se instala un servicio de inicio automático al reiniciar el equipo.

`serve` conserva el funcionamiento en primer plano para desarrollo y supervisores externos. `stop` y `restart` gestionan únicamente el daemon, no las instancias iniciadas con `serve`.

Cada directorio de datos identifica un daemon. Usa el mismo `--data-dir` al iniciar, detener o reiniciar una instancia personalizada:

```sh
alfred workspace --data-dir "$HOME/mi-workspace" --port 4320
alfred workspace restart --data-dir "$HOME/mi-workspace" --port 4320
alfred workspace stop --data-dir "$HOME/mi-workspace"
```

**Restart utiliza los argumentos y el entorno actuales**, no guarda las variables de entorno de la ejecución anterior. Vuelve a especificar puerto, interfaz, TLS y demás configuración personalizada. Detener o reiniciar cierra las sesiones activas de terminal y navegador; los datos persistentes se conservan.

La salida del servidor, incluido el código de conexión, se guarda en `workspace.log` dentro del directorio de datos. El archivo se crea con permisos privados en sistemas POSIX. Protege el directorio con los permisos de tu cuenta, especialmente en Windows. El log se añade entre arranques; no hay rotación automática.

El control usa un socket local (named pipe en Windows), no un PID guardado que pudiera pertenecer a otro proceso. Un segundo inicio no duplica un daemon activo. Si el proceso terminó abruptamente y dejó un `daemon.sock` obsoleto, el CLI informa del problema: verifica que no sigue ejecutándose antes de eliminar ese socket. No elimines los datos del workspace.

Pruebas del CLI y del ciclo de vida, sin dependencias externas:

```sh
node --test packages/workspace/tests/cli.test.mjs packages/workspace/tests/daemon.test.mjs
```
