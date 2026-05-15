# Helm Adaptive Voice Engine — Visuals Module Ship to Production (v2.0)

Pull request / deploy ticket for the visual generation pipeline.

---

## TL;DR

Reemplaza el `buildVisualPrompt` actual con un pipeline de 5 bloques + un
mini-LLM call que traduce `pain_point + caption` en una escena visual concreta
antes de mandar a Flux. Resultado: imágenes que evocan la consecuencia humana
del pain en lugar de output stock-feeling.

**6 archivos a producción. 0 dependencias nuevas (pydantic ya está). 1 nuevo
LLM call (Haiku, ~$0.005 por imagen, ~1-2s extra).**

---

## What's in this ship

Pipeline arquitectónico:

```
PAIN_POINT + CAPTION + BRAND_BIBLE
        |
        v
  build_visual_prompt_ir() ---> mini-LLM call ---> SubjectBlock
        |                       (Haiku 4.5, ~$0.005, ~1.5s)
        |
        v
  VisualPromptIR (5 blocks: Subject + Style + Brand + Platform + Negative)
        |
        v
  validate_visual_prompt_ir()  ---> [list of failures]
        |
        v
  render_for_flux(ir)  ---> flux_prompt_string -> fal.ai
```

Decisiones clave bakeadas:
- Mini-LLM call SÍ (latency aceptable, costo trivial, gran quality lift)
- Per-platform diferenciación SÍ (6 platforms × 1-3 content types definidos)
- Reference images NO (deferido a v1.5 cuando 50+ clientes pidan consistencia)
- Model-agnostic SÍ (IR es renderer-agnostic, Flux es el único renderer en v1)

---

## Archivos a agregar (6 nuevos)

Path sugerido en repo: `lib/voice-engine/visuals/` (o subdirectorio dentro
del módulo de Helm Adaptive Voice Engine si ya está deployado)

| Archivo | Propósito |
|---|---|
| `visual_schema.py` | Pydantic models: VisualPromptIR + 5 blocks (Subject, Style, Brand, Platform, Negative) + 6 enums (StyleType, CameraType, LightingType, AspectRatio, DepthOfField, VisualStrategy) |
| `platform_visual_language.py` | `PLATFORM_VISUAL_LANGUAGE` dict con specs por (platform, content_type), aspect ratio mapping, helpers |
| `visual_subject_extractor.py` | Mini-LLM call. `SUBJECT_EXTRACTION_PROMPT` + `extract_subject_block()` async + JSON parser tolerante |
| `visual_prompt_builder.py` | `build_visual_prompt_ir()` que compone los 5 blocks. Incluye `STYLE_DEFAULTS_BY_ARCHETYPE` (13 archetypes), dynamic negatives helper, y `_generate_cache_key()` para v1.5 cache layer |
| `visual_renderer_flux.py` | `render_for_flux(ir, boost_subject=False)` + `render_negative_prompt()` + `get_image_size_for_fal()` |
| `visual_validator.py` | 6 soft checks (lazy subject, text instructions leak, brand-mood coherence con emotional_anchor, color palette size, negative block completeness, aspect ratio consistency) |

**Origen:** todos en `Helm SEO/helm-adaptive-voice-engine/`.

**No subir:**
- `visual_consolidated.py` — single-file para review interno
- `SHIP_VISUALS.md` — este archivo

---

## Dependencia

Solo `pydantic >= 2.0` (ya debería estar si el módulo UGC ya está deployado).

Si vas a TypeScript en lugar de Python, necesitas:
- `zod` para validación de schemas
- Equivalente del LLM client (Anthropic SDK TS o OpenAI SDK TS)

---

## Archivos existentes a modificar / deprecar

### `lib/visuals/generate.ts` (líneas ~131-168)

`buildVisualPrompt()` actual queda **deprecated**. Reemplazo:

```ts
// Antes
const prompt = buildVisualPrompt(post, brandBible, platform, aspectRatio)
const result = await falAi.generate({ prompt, ... })

// Ahora (asumiendo Python service)
const ir = await fetch('/api/visuals/build-ir', {
  method: 'POST',
  body: JSON.stringify({
    pain_point: research.painPoint,
    caption: post.caption,
    brand_bible: { archetype, photography_mood, image_style, colors },
    platform: 'instagram',
    content_type: 'photo',
  }),
}).then(r => r.json())

const failures = await fetch('/api/visuals/validate', {
  method: 'POST',
  body: JSON.stringify(ir),
}).then(r => r.json())

if (failures.length > 0) {
  // Either regenerate or surface to operator
}

const flux_prompt = await fetch('/api/visuals/render-flux', {
  method: 'POST',
  body: JSON.stringify({ ir, boost_subject: false }),
}).then(r => r.text())

const image_size = ir.platform.aspect_ratio === '1:1' ? 'square_hd' : ...

const result = await falAi.generate({
  prompt: flux_prompt,
  image_size,
})
```

Si vas con TypeScript en el mismo repo, las funciones se llaman directo
sin HTTP overhead.

Mantener `buildVisualPrompt()` viejo deprecated 1 sprint para no romper
consumers. Borrar después.

### Storage layer

Ningún schema change requerido para el módulo de visuals en sí. La columna
`brand_bible.visual` que ya existe sigue funcionando (la `BrandBibleVisualSlice`
es un adapter que extrae los campos correctos en el call site).

Para audit del subject extractor, opcionalmente puedes agregar tabla:

```sql
CREATE TABLE visual_prompt_ir_log (
  id UUID PRIMARY KEY,
  client_id UUID NOT NULL,
  post_id UUID,
  ir_json JSONB NOT NULL,
  flux_prompt TEXT NOT NULL,
  image_url TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cache_key TEXT  -- For future cache lookup
);

CREATE INDEX visual_prompt_ir_log_cache_key_idx ON visual_prompt_ir_log (cache_key);
```

---

## Test plan mínimo antes de shippear

1. **Schema validation:** crear 5 SubjectBlocks de prueba (uno por VisualStrategy excepto BRAND_HERITAGE), verificar que todos pasan `SubjectBlock.model_validate()`. Probar el caso edge donde `visual_strategy=METAPHOR_DRIVEN` y `visual_metaphor=null` debe fallar la validación.

2. **Subject extractor end-to-end:** correr `extract_subject_block()` con 3 pain points reales de clientes existentes. Verificar que el JSON regresa válido y que el mini-LLM call completa en < 3s. Si falla parsing JSON, el retry loop (max 2) debe disparar.

3. **Archetype-driven style:** correr `build_visual_prompt_ir()` con 3 brand archetypes distintos (rebel, sage, caregiver) y verificar que el StyleBlock resultante tiene los defaults correctos por archetype (rebel = dutch angle + harsh shadows, sage = window light + deep focus, etc.).

4. **Dynamic negatives:** correr `build_negative_terms()` con (linkedin, photography), (tiktok, photography), (instagram, illustration). Verificar que cada uno tiene los defaults + las additions correctas, y que no hay duplicados.

5. **Validator end-to-end:** correr `validate_visual_prompt_ir()` sobre 5 IRs construidos manualmente con problemas plantados (lazy subject, text in composition, brand-mood mismatch, palette vacío, aspect ratio mismatch). Verificar que cada problema se detecta con su mensaje correspondiente.

6. **Flux renderer:** correr `render_for_flux()` sobre 3 IRs reales y verificar que el output string:
   - Empieza con el style lead correcto ("Professional photograph", "Editorial illustration", etc.)
   - Incluye todas las secciones (subject, setting, composition, mood, style, brand, platform, aspect ratio, avoid)
   - No tiene placeholders sin resolver
   - Está bajo 1500 chars (Flux truncates prompts largos)

7. **End-to-end con fal.ai:** generar 3 imágenes reales en sandbox de fal.ai con los prompts producidos. Comparar visualmente con 3 imágenes generadas con el `buildVisualPrompt` viejo usando el mismo input. Esto es el test cualitativo final.

---

## Rollback plan

Si algo se rompe en producción:

1. **Feature flag** alrededor de `build_visual_prompt_ir()`. Si flag off, vuelve al `buildVisualPrompt` viejo. Toggle en milisegundos.

2. **DB:** la tabla `visual_prompt_ir_log` (si la creaste) es additive, no toca nada existente. Borrar si necesario.

3. **Mini-LLM call failure:** si Haiku está down o falla, el `extract_subject_block` retries 2 veces. Si falla las 3, raise `SubjectExtractionError`. El call site debería catchearlo y fallback a un SubjectBlock default genérico ("a clean professional setting", etc.) para no bloquear la generación. Implementa el fallback en el call site para resilience.

---

## Memoria de calibración (números actuales)

Calibrar después de 100-200 imágenes en producción. Los actuales son educated guesses:

- Hook word count cap (no aplica a visuals, ese es UGC text)
- Subject extractor model: claude-haiku-4-5 (cambiar si Haiku 4.5 cambia precio o latency)
- Subject extractor max_retries: 2
- Subject extractor max_tokens: 600
- Subject extractor latency esperada: 1-2s
- Cost per call esperado: ~$0.005
- Negative terms count default: 12 (DEFAULT_NEGATIVE_TERMS) + 0-3 platform + 0-3 style = 12-18 typical
- Aspect ratio fallback si platform/content_type no mapeado: square_hd
- Mood coherence opposing pairs: warm/clinical, warm/gritty, aspirational/gritty
- Color palette: 1-5 colors (validation rejects 0 or 6+)
- Cache key: SHA-256 truncated to 16 chars (collision risk acceptable at expected scale)

---

## Lo que NO está en este ship (Phase 1.5 / 2)

Para que sepas qué viene después:

- **Reference images / image-to-image conditioning** — cuando 50+ clientes
  necesiten consistencia visual extrema. Requiere UI de upload + storage +
  fal.ai conditioning param.
- **SubjectBlock cache layer** — cuando el volumen justifique la infra
  (Redis o equivalente). El `cache_key` ya está en VisualPromptMetadata
  para que el día que la implementes, el lookup es trivial.
- **Renderers adicionales** — `visual_renderer_midjourney.py`,
  `visual_renderer_sdxl.py`, `visual_renderer_imagen.py`. La IR ya soporta
  esto, solo falta escribir el archivo.
- **boost_subject A/B test** — el flag está en `render_for_flux` pero off por
  default. Cuando tengas 50+ generations, A/B test boosted vs not-boosted
  y promote default si gana.
- **Image performance reweighting** — análogo al sistema de UGC: aprender
  qué SubjectBlocks performan mejor por cliente y feedearlos al extractor
  como winning_examples. Requiere capa de analytics que aún no existe.
- **Visual learning loop** — extender el feedback_loop_service del Adaptive
  Voice Engine para aprender de imágenes rechazadas/regeneradas por el
  cliente. Slots ya reservados en ClientContext.

---

## Contacto

Archivos en `Helm SEO/helm-adaptive-voice-engine/`. Cualquier duda, abrir
issue o mensaje directo. El consolidated.py tiene todo en un solo archivo
si quieres revisar antes de splittear.
