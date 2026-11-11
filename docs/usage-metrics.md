# Contexto y uso — especificación

## Alcance y estado

Implementación incremental en Workspace. `checklist.md` es el alcance congelado; este documento conserva decisiones y evidencias. La comparación externa previa es motivación de diseño, no evidencia de pruebas locales ni garantía de APIs actuales de terceros.

Se comienza con contratos aditivos, sin cambiar todavía persistencia, eventos ni interfaz. Las conversaciones antiguas siguen usando sus campos existentes; no se reconstruyen desgloses históricos a partir de un total. La integración posterior debe evitar sumar los registros nuevos y los contadores legacy para la misma llamada.

## Semántica

- ContextSnapshot: ocupación de una conversación, nunca consumo acumulado. Distingue medición de última petición y proyección de próxima petición. Incluye revisión de contenido para detectar lecturas desactualizadas, modelo, proveedor y momento de observación.
- UsageRecord: lectura de consumo de una llamada, asociada a conversación y turno. `id` debe ser estable para reconciliar eventos de esa misma llamada; los reintentos reales tienen otro ID. Entrada incluye caché y salida incluye razonamiento: los detalles son subconjuntos, no sumandos adicionales. Un dato ausente no es cero.
- QuotaSnapshot: límite externo de una cuenta identificado mediante referencia opaca, no credencial ni correo. Incluye ventanas y resets; no se deriva de tokens de conversación.
- Procedencia: proveedor, runtime, catálogo o estimador. Calidad (medido, estimado, parcial, no disponible) y vigencia (actual o desactualizado) son ejes independientes.
- Coste: cantidad y moneda con origen reportado o estimado y significado facturado o equivalente API. Cero reportado es válido. Ausencia de precio no implica gratuidad. La estimación debe conservar referencia del precio utilizado en la fase de integración.

## Invariantes de los contratos iniciales

Tokens y límites son enteros seguros no negativos; capacidad y límites de cuota son positivos. Caché leída/escrita son subconjuntos disjuntos de entrada; razonamiento es subconjunto de salida. No se aceptan detalles sin su total padre. Los registros parciales pueden omitir entrada o salida. Una lectura completa debe tener ambas.

El contexto puede superar la capacidad reportada: se conserva el dato y se limita a cero el restante en presentación. El umbral operativo no puede superar capacidad conocida. La reserva no puede superar capacidad conocida. No se asume que umbral y reserva sean complementarios salvo que el runtime lo confirme.

Una lectura no disponible no transporta ocupación ni saldo. Puede conservar capacidad conocida. La proyección de contexto no se etiqueta como medición exacta. Cada ventana de cuota tiene ID único dentro del snapshot y su propia unidad; no se agregan unidades diferentes.

## UX objetivo

Indicador permanente: `Contexto 42% usado`; `≈` para estimación; pendiente de medición o capacidad desconocida sin porcentajes inventados. La cuota se expresa como restante y se presenta separadamente.

Panel: usado/capacidad, restante hasta límite, margen hasta compactación si se conoce, antigüedad, procedencia y aviso de contenido posterior a la medición. Desglose bajo demanda con cobertura y estimación visibles. Acción principal: compactar contexto; ajustes avanzados separados. Compactar no borra consumo acumulado.

Detalle de turno: duración, tokens procesados, llamadas, caché, razonamiento, coste y trabajo delegado. No mostrar dólares sin semántica. Analítica global separada del composer. Alertas deduplicadas, accesibles y accionables.

## Criterios de aceptación de integración

1. Modelo desconocido: tokens disponibles sin porcentaje supuesto.
2. Caché y razonamiento: incluidos una sola vez en el total.
3. Compactación: invalida medición anterior, conserva consumo y atribuye su propia llamada.
4. Modelo o revisión de contenido distintos: lectura anterior explícitamente desactualizada, nunca recuperada como actual.
5. Interrupción: persiste lo observado y declara cobertura parcial.
6. Evento repetido: una llamada se reconcilia sin duplicar; reintento real se contabiliza aparte.
7. Subagente: atribución explícita, sin sumar dos veces un agregado del padre.
8. Coste desconocido no equivale a cero; coste reportado cero no se sustituye por estimación.
9. Cuota vencida conserva su fecha y estado desactualizado hasta refrescar.
10. Historial legacy conserva totales y declara que carece de desglose.
11. Consultar métricas no invoca al modelo ni descubre cuentas o credenciales implícitamente.

## Evidencia inicial

Inspeccionados `shared/contracts.ts`, `shared/context-usage.ts` y scripts de Workspace. Worktree seleccionado: rama `tools-usage`. Existen cambios previos, incluido `context-permissions.tsx`; esta primera entrega no los modifica. Las pruebas de contratos no equivalen a validación de integración, persistencia o UX.

## P0.3 — normalización en el límite del SDK

`normalizeSdkUsage` consume la representación del AI SDK, no JSON nativo del proveedor. Los seis proveedores configurados en Chat convergen en este límite; no se vuelve a sumar caché al total inclusivo de Anthropic ni razonamiento al total de salida. Las pruebas por proveedor son fixtures del contrato SDK, no pruebas contra endpoints reales.

La normalización conserva campos ausentes, ceros reportados y detalles válidos; rechaza contadores negativos, fraccionarios o inseguros. Descarta subconjuntos inconsistentes y declara calidad parcial sin corromper totales válidos. No infiere costes. Chat usa los totales normalizados en respuestas y compactación. Los detalles quedan preparados para su persistencia por llamada en P0.4; los contadores legacy no pueden conservar ese desglose ni la cobertura de compactaciones, que sigue pendiente de P0.7.

Validación: 14 pruebas de normalización, 11 de contratos y 7 de contexto aprobadas; 38 pruebas de chat, continuación y recuperación aprobadas. Typecheck de Workspace aprobado. No se ejecutó la suite completa ni pruebas con proveedores reales. Los errores 401/503 impresos por recuperación corresponden a escenarios simulados que aprobaron.


## P0.4 — persistencia por llamada

`Conversation.usageRecords` es opcional y aditivo: los historiales anteriores siguen siendo válidos sin migración ni desglose inventado. `reconcileUsage` valida identidad, ignora observaciones antiguas o de menor calidad y devuelve la diferencia contable de cada actualización. Repetir un registro con el mismo ID no vuelve a sumar consumo; una corrección puede reducir el total, incluido a cero.

Las respuestas identifican cada paso mediante UUID de intento e índice de paso; los intentos nuevos tienen otro UUID. El registro y la proyección legacy del mensaje se guardan juntos en una transacción del journal antes de continuar. Compactación y regeneración de títulos tienen identidad propia y propósito explícito. Los IDs locales persisten al reabrir el journal; no son IDs de facturación del proveedor. La deduplicación requiere conservar ese ID al reenviar una observación.

Los totales legacy siguen siendo la fuente de la interfaz actual: no se suman de nuevo los registros de respuestas y compactaciones. El consumo auxiliar ya se conserva en el registro, pero aún no aparece en ese contador; su presentación queda para los agregados posteriores. La cobertura de peticiones abortadas sin evento de uso y la atribución de subagentes permanecen pendientes de P0.7. No se inventan tokens para intentos que no reportan uso.

Se extrajeron los identificadores de proveedor a `shared/providers.ts`, reexportados desde contratos para conservar compatibilidad y eliminar la dependencia circular entre contratos y métricas.

Validación P0.4: 81 pruebas aprobadas en nueve archivos (ledger, contratos, normalización, contexto, chat, recuperación, continuación, títulos y journal); typecheck de Workspace aprobado. Incluye reapertura del journal con historial legacy, deduplicación persistida, correcciones, colisiones de identidad, registros distintos por intento y persistencia de compactaciones. Los errores 401/503 de recuperación son fixtures esperados. No se ejecutó la suite completa ni llamadas reales a proveedores. No se modificó la interfaz existente.


## P0.5 — capacidad y política operativa con procedencia

`resolveContextCapacity` separa capacidad de ocupación y resuelve evidencia explícita de runtime, después proveedor y finalmente catálogo. Valida identidad de proveedor/modelo, enteros seguros positivos y referencia no vacía. La política operativa solo se acepta del runtime, con umbral/reserva dentro de capacidad; no se infiere compactación automática restando una reserva ni aplicando un porcentaje.

Chat persiste `capacitySource` y `capacityReference` junto al límite. El esquema sigue aceptando lecturas legacy sin procedencia, sin atribuirles retrospectivamente una fuente. Se conserva `modelContextLimit` como función compatible, pero Chat usa el resolvedor con proveedor explícito.

El catálogo `workspace-legacy-v1` conserva los valores previos, no constituye una consulta actualizada a proveedores. Ahora está limitado a IDs exactos en APIs directas: no se extrapola a ChatGPT, Copilot u OpenCode por coincidencia de nombre. Los modelos sin evidencia quedan sin capacidad. No se amplió el catálogo con valores no verificados.

Limitación explícita: el flujo actual de Chat suministra únicamente catálogo; no se añadieron conectores de descubrimiento remoto. El resolvedor admite evidencia validada de proveedor/runtime para integración posterior. Chat no configura compactación automática, por lo que no publica umbral ni reserva. La procedencia se guarda, pero su presentación queda para P1. No se modificó la interfaz.

Validación: 67 pruebas aprobadas en cinco archivos (23 nuevas de capacidad, contexto, contratos de métricas, chat y recuperación); typecheck de Workspace aprobado. Incluye prioridad de fuentes, modelos/proveedores desconocidos, valores inválidos, umbral explícito y round-trip del esquema conservando procedencia y compatibilidad legacy. Errores 401/503 de recuperación corresponden a fixtures esperados. Sin suite completa ni llamadas reales a proveedores.

## Corrección de descubrimiento y panel para suscripciones

El endpoint de modelos conserva capacidades explícitas del catálogo autenticado de ChatGPT y de Copilot, además de los campos compatibles de los demás catálogos. La interfaz consulta ese endpoint para el modelo seleccionado, permite refrescar la capacidad y descarta respuestas de selecciones anteriores. No requiere otra llamada generativa para actualizar el porcentaje de una conversación existente. Los límites de salida y cuotas de cuenta no se reinterpretan como capacidad de contexto.

El panel común muestra contexto ocupado, restante cuando se conoce capacidad, procedencia, fecha de medición y tokens procesados con una advertencia contable. La compactación principal queda separada de las opciones avanzadas. Si la consulta falla o el catálogo no informa capacidad, el panel distingue ambos estados y conserva los tokens: no garantiza porcentaje para todos los modelos ni inventa límites para cumplir paridad visual.

Validación de cierre: 8 pruebas de presentación aprobadas; 67 pruebas adicionales aprobadas (40 capacidad, 7 proveedores, 20 chat). Typecheck y git diff --check aprobados. El filtro solicitado chatgpt-oauth.test.ts no seleccionó ningún archivo: no se afirma cobertura de una suite OAuth dedicada. No hubo llamadas reales a cuentas ni prueba interactiva del navegador. La compatibilidad de campos opcionales se valida con fixtures, no garantiza que el catálogo de la cuenta concreta los suministre. No se marca P1 completo ni se altera el checklist congelado.
