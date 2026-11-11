# Checklist — contexto, consumo y cuotas

## Regla de inmutabilidad

El alcance, los identificadores, el orden y el texto de este archivo quedan congelados tras su creación. La única edición permitida es cambiar `[ ]` por `[x]` en una tarea completada y verificada. No añadir, eliminar, reordenar ni reformular tareas. Evidencias, decisiones, bloqueos y cambios de alcance se documentan fuera de este archivo. No marcar tareas parcialmente realizadas ni pruebas no ejecutadas.

## P0 — Confianza en los datos

- [x] P0.1 Documentar la especificación de métricas, compatibilidad, estados UX y criterios de aceptación.
- [x] P0.2 Implementar contratos validados e independientes ContextSnapshot, UsageRecord y QuotaSnapshot, con pruebas unitarias.
- [x] P0.3 Normalizar métricas por adaptador, sin doble conteo de caché o razonamiento, con pruebas por proveedor.
- [x] P0.4 Persistir registros por llamada con identidad estable, reconciliación y deduplicación, preservando datos históricos.
- [x] P0.5 Resolver capacidad y umbral operativo desde runtime, proveedor o catálogo con procedencia; no inventar límites desconocidos.
- [ ] P0.6 Separar última medición de proyección de próxima petición e invalidar lecturas tras cambios de modelo, contenido o compactación.
- [ ] P0.7 Conservar consumo parcial en interrupciones y atribuir compactaciones, reintentos y subagentes sin duplicarlos.

## P1 — Experiencia de conversación

- [ ] P1.1 Implementar indicador compacto de contexto con estados medido, estimado, pendiente, parcial, desactualizado y desconocido.
- [ ] P1.2 Implementar panel con usado, restante, capacidad, umbral operativo, procedencia y antigüedad de lectura.
- [ ] P1.3 Presentar compactación recomendada y comprensible, con confirmación y ajustes avanzados separados.
- [ ] P1.4 Mostrar métricas por turno bajo demanda: tokens procesados, llamadas, duración y coste reportado o estimado.
- [ ] P1.5 Implementar alertas accesibles y accionables sin repetición por cada actualización.
- [ ] P1.6 Verificar componentes, accesibilidad, estados vacíos y flujos de conversación mediante pruebas de interfaz.

## P2 — Diagnóstico y analítica

- [ ] P2.1 Desglosar contexto por conversación, instrucciones, herramientas, adjuntos y reserva, explicitando estimaciones y cobertura.
- [ ] P2.2 Calcular coste y caché con precios y procedencia, distinguiendo cero reportado, precio desconocido y equivalente API.
- [ ] P2.3 Atribuir y visualizar trabajo delegado y compactaciones en los agregados de consumo.
- [ ] P2.4 Implementar histórico por periodo, proyecto, conversación, proveedor y modelo con cobertura explícita.

## P3 — Cuotas de cuenta

- [ ] P3.1 Implementar conectores de cuotas por proveedor con estado no disponible para capacidades no soportadas.
- [ ] P3.2 Mostrar ventanas, saldo, resets y vigencia sin confundir cuotas con contexto o facturación.
- [ ] P3.3 Implementar refresco independiente y deduplicación de cuentas y entornos sin invocar al modelo.

## Validación final

- [ ] V.1 Verificar modelo desconocido, cambio de modelo, contenido nuevo y compactación sin lecturas falsamente precisas.
- [ ] V.2 Verificar caché, razonamiento, eventos repetidos, interrupciones y subagentes sin doble conteo ni pérdida de consumo registrado.
- [ ] V.3 Verificar precio desconocido, cero reportado, histórico parcial y cuota vencida sin valores engañosos.
- [ ] V.4 Ejecutar tests y typecheck del alcance completo, documentar resultados y revisar compatibilidad de persistencia.
