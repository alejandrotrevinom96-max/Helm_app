# Helm Adaptive Voice Engine — Ship to Production (v2.0)

Pull request / deploy ticket. Copy-paste lo que necesites.

---

## TL;DR

Sistema de aprendizaje que adapta la generación de contenido por cliente sin tocar las reglas estáticas. Incluye módulo UGC con schema estricto que reemplaza el flujo viejo de `{opening, body, closing}`.

**9 archivos a producción. 1 dependencia nueva. 1 decisión arquitectónica pendiente (Python vs TypeScript).**

---

## What's new in v2.0 (vs v1.1)

Cuatro mejoras al módulo UGC que se derivaron de revisión final con operador:

1. **Hook specificity score (`_check_hook_specificity`)** — scoring algorítmico que rechaza hooks vagos. +1 si tiene número (156 hours, $23k), +1 si menciona brand conocida (Buffer, Notion, ChatGPT), +1 si usa confession verb (used to, dropped, deleted, tried). -1 si tiene vague nouns (something, things, stuff). Score < 0 = reject. Cubre el ~30% de hooks débiles que se escapaban del weak_openers list.

2. **Sales-disguised CTA detector (`_check_cta_not_sales_disguised`)** — rechaza CTAs como "check out", "click the link", "buy now", "use code", etc. Force conversational CTAs.

3. **4 founder voice example archetypes en el prompt** — Technical/contrarian, sales-y, reflective, operational. El modelo ve la RANGE de voces aceptables en lugar de converger a un solo arquetipo. Diversidad explícita evita bias.

4. **Voice-priority line en el reminder** — Cuando el modelo aplica LEARNED_OVERRIDES del cliente, ahora prioriza dimensiones de voz (delivery_style, sentence_cadence, hook_length, banned_vocab) sobre dimensiones de formato (hashtag_count, emoji_usage). UGC quality vive en la voz.

Lo que NO se metió (decisión consciente): compact prompt + fallback (premature optimization), curiosity heuristic (demasiado cualitativo), spoken/overlay contrast enhanced (diminishing returns).

---

## Decisión arquitectónica antes de empezar

El código está en Python (Pydantic v2). Tu app es Next.js / TypeScript.

Tienes 3 opciones:

1. **Python service separado.** Deployar como FastAPI en Railway / Fly / Vercel Python functions. El app TS llama por HTTP. Más trabajo de infra, mantiene Python tal como está.
2. **Traducir a TypeScript / Zod.** Más trabajo upfront de traducción, pero todo vive en el mismo monorepo. Recomendado si tu equipo es solo TS.
3. **Vercel Python functions.** Cada archivo `.py` se vuelve un endpoint serverless. Mid-friction, escalable, sin nuevo servicio.

**Mi recomendación:** opción 2 si tu equipo no maneja Python. Opción 3 si quieres ship rápido sin compromiso a otro stack.

Avísame cuando decidas y te armo la versión TS si va por ahí.

---

## Archivos a agregar (9 nuevos)

Path sugerido en repo: `lib/voice-engine/` (o equivalente en tu estructura)

| Archivo | Propósito |
|---|---|
| `client_context.py` | Modelos Pydantic: ClientContext, Override, Signal, AuditEntry, BrandBible, etc. |
| `diff_classifier.py` | Convierte diff (original vs editado) en signals estructurados |
| `feedback_loop_service.py` | Threshold gating, cool-down, override aggregation, audit log |
| `prompt_builder.py` | Compone el prompt final (estático + dinámico per-client) |
| `ugc_schema.py` | Schema Pydantic del UGCBundle (hook + body + cta + overlays + caption) |
| `ugc_prompt.py` | Instrucción de schema UGC que se appendea cuando content_type=ugc |
| `ugc_validator.py` | Validaciones soft post-generation (duración, weak openers, etc.) |
| `ugc_extractor.py` | Extrae script para HeyGen, overlays para video editor, caption para scheduler |
| `platform_tone_instructions.py` | Static scaffold (7 plataformas + 4 content types + composition rules) |

**Origen:** `Helm SEO/helm-adaptive-voice-engine/` (los 8 primeros) y `Helm SEO/platform_tone_instructions.py` (el último).

**No subir:**
- `ugc_consolidated.py` — es solo el single-file para review
- `README.md` — docs

---

## Dependencia nueva

```
pydantic >= 2.0
```

Si vas con TypeScript en lugar de Python:

```
zod
```

Para validación equivalente.

---

## Archivos existentes a modificar / deprecar

### `lib/visuals/generate.ts` (líneas ~131-168)

`extractScriptText()` queda **deprecated**. La nueva forma:

```ts
// Antes
const script = extractScriptText(generatedContent)

// Ahora (asumiendo Python service)
const bundle = await fetch('/api/ugc/parse', { ... }).then(r => r.json())
const script = bundle.script  // o bundle.script_text
const overlays = bundle.overlays
const caption = bundle.caption_with_hashtags
```

Mantener `extractScriptText` deprecado un sprint para no romper consumers viejos. Borrar después.

### Tabla `contentTypes` (DB)

El `template.promptTemplate` para UGC se queda igual a nivel DB pero el prompt builder ahora le appendea el `UGC_OUTPUT_SCHEMA_INSTRUCTION` automáticamente cuando `content_type=ugc`. Cambio invisible al cliente.

### Storage layer

Necesitas tabla nueva para `ClientContext` (o columna JSONB en una tabla existente):

```sql
CREATE TABLE client_contexts (
  client_id UUID PRIMARY KEY,
  context_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Para serializar/deserializar:

```python
# Save
ctx_json = ctx.model_dump_json()
# Load
ctx = ClientContext.model_validate_json(ctx_json)
```

---

## Flujo de integración (pseudo-código)

```
1. Usuario hace click "Generate post"
   ├─ Cargar ClientContext del cliente desde DB
   ├─ Llamar build_generation_prompt(platform, content_type, client_context, pain_point)
   ├─ Si content_type == 'ugc': append_ugc_schema_to_prompt(prompt, platform)
   └─ Mandar a Opus / Claude

2. Recibir output del modelo
   ├─ Si UGC: UGCBundle.model_validate_json(raw_output)
   │   ├─ Si falla: regenerar con el error como context
   │   └─ Si pasa: validate_ugc_bundle(bundle) para soft checks
   ├─ Si no UGC: parse_override_log(raw_output) para separar draft + overrides aplicados
   └─ Devolver al usuario

3. Usuario edita el draft
   ├─ classify_diff(original, edited, platform, content_type, post_id) → list[Signal]
   ├─ record_tiered_feedback(ctx, platform, post_id, tier) → weight
   ├─ Aplicar weight a signals
   ├─ process_signals(ctx, weighted_signals) → muta ctx
   └─ Guardar ctx en DB

4. Usuario publica el post
   └─ increment_post_count(ctx, platform) → guardar ctx
```

---

## Test plan mínimo antes de shippear

1. **Schema validation:** generar 10 UGC bundles con clientes de prueba, verificar que todos pasan `UGCBundle.model_validate_json()` sin crashear.
2. **Soft validators (8 checks):** correr `validate_ugc_bundle()` sobre los 10. Si más de 30% tienen failures, los thresholds están demasiado estrictos. Los 8 checks: total_duration, overlay_timing, overlay_not_verbatim, caption_not_summary, hook_quality, **hook_specificity (v2)**, **cta_not_sales_disguised (v2)**, swipe_test_self_report.
3. **Specificity score sanity:** correr `_check_hook_specificity()` directamente con 5 hooks de prueba — 3 buenos ("I dropped Buffer last month", "I spent 156 hours switching tabs", "Stop using Notion for strategy") y 2 malos ("Let me tell you something", "This thing changed everything"). Verificar que los 3 buenos pasan y los 2 malos fallan.
4. **Sales CTA detector:** correr `_check_cta_not_sales_disguised()` con CTAs de prueba — 2 buenos ("Comment your stack below", "What time do you send?") y 2 malos ("Click the link in bio to sign up", "Use code FOUNDER for 20% off"). Verificar que los buenos pasan y los malos fallan.
5. **Heuristic classifier:** generar 5 posts, editarlos manualmente con cambios obvios (quitar "leverage", acortar hook), verificar que `classify_diff()` produce los signals esperados.
6. **Feedback loop:** procesar los signals con `process_signals()`, verificar que el ClientContext se actualiza y el audit log captura cada cambio.
7. **End-to-end:** generar un nuevo post con el ClientContext actualizado, verificar que el output refleja los learned_overrides (ej. usa hooks más cortos si eso fue lo aprendido) y que las voice dimensions se priorizan.

---

## Rollback plan

Si algo se rompe en producción:

1. **Feature flag** alrededor de `build_generation_prompt(... client_context=...)`. Si flag off, vuelve al prompt builder viejo sin client_context.
2. **DB:** la tabla `client_contexts` es additive, no toca nada existente. Borrarla si necesario.
3. **extractScriptText viejo** queda deprecated 1 sprint, no removido. Si la nueva extracción falla, los consumers TS siguen llamando al viejo.

---

## Memoria de calibración (para futuros tweaks)

Estos son los números que pusimos basados en discusión, no en data real. Recalibrar después de 50-100 bundles en producción:

- Hook word count cap: 9
- Hook duration: 1.0-4.0s
- Body beats: 1-5
- Total UGC duration: 15-60s
- Overlays count: 3-8
- Overlays word count: 5 max
- Maturity stages New/Early/Growing/Mature: 0-8 / 9-20 / 21-60 / 60+
- Min signals to update: 8 / 6 / 5 / 4 según stage
- Magnitude cap por stage: 5% / 10% / 20% / 40%
- Cool-down posts: 3 / 2 / 2 / 1
- Tiered feedback weights: publish_as_is=1.0, minor_edits=0.7, regenerate=-0.5, discard=-1.0

---

## Lo que NO está en este ship (Phase 1.5 / 2)

Para que sepas qué viene después y no te sorprenda:

- LLM batch diff classifier (cuando heurísticas dejen de cubrir 70%+)
- Cross-platform voice fingerprint
- Stale override decay
- Circuit breaker
- Shadow mode
- Exploration sampling 10-15%
- Performance reweighting de winning/losing patterns
- Cohort comparison per segmento

Todos estos tienen slots reservados en `ClientContext` para no requerir migración de schema cuando los agreguemos.

---

## Contacto

Si algo no compila o el flujo no cierra, los archivos están en `Helm SEO/helm-adaptive-voice-engine/`. Cualquier duda, abrir issue o mensaje directo.
