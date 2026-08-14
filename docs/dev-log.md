# SceneForge Development Log

This log records dated implementation and documentation work. Keep entries concise and evidence-oriented.

## 2026-08-04

### T58 / Issue #190 Run Scene Prompt Responses transport

Summary:

- Added a shared server-side LiteLLM Responses method that maps existing messages and token intent to `input` and `max_output_tokens`, maps the authorized strict schema to `text.format`, disables streaming, and sets `store: false`.
- Kept `POST /api/llm/chat` unchanged for callers while routing only exact-whitelisted Illustrious, Anima, and Krea 2 single-image Scene Prompt requests through `/v1/responses`; every other request remains on Chat Completions.
- Accepted only completed assistant `output_text` from a completed Responses result. Reasoning, tool, metadata, refusal, incomplete, failed, empty, malformed, and provider-error payloads cannot become Scene Prompt JSON and do not trigger Chat fallback or parser repair.
- Added a fail-closed compatibility decoder for LiteLLM proxies that ignore `stream: false`: only the final full response inside an official `response.completed` SSE event is normalized. Standard `id`/`retry` fields and one final post-completion `[DONE]` terminator are tolerated; delta assembly, Chat SSE, early/trailing terminators, failure/incomplete/error events, malformed streams, and streams without completion are rejected with enum-only shape diagnostics.
- Narrowed the live-proxy compatibility boundary after a sanitized shape probe: when a completed SSE snapshot explicitly returns `output: []`, SceneForge can restore exactly one uniquely indexed, complete canonical assistant message from `response.output_item.done`. Non-message items and every delta/content-part/output-text completion event remain ignored; missing, invalid, duplicate-index, or multiple terminal message candidates fail closed with safe enum diagnostics.
- Added bounded output-shape diagnostics to the existing sanitized structured-error details and local error log so completed responses can report only a safe normalization category without exposing response keys, raw type strings, output text, ids, models, schemas, or provider data.
- Preserved the existing model/NSFW selection, prompts, token budgets, strict schemas, downstream parsing, safe response contract, and summarized response-format logging.

Validation during implementation:

- Focused Responses/route suite: 3 files, 109 tests passed.
- Full Vitest suite: 162 files, 2,159 tests passed.
- `npm run typecheck` passed.
- `npm run lint` passed with 0 errors and 22 existing `<img>` warnings.
- `npm run build` and `git diff --check` passed.
- Live Anima validation confirmed `scene-prompt` completed through the forced-SSE proxy path, downstream planning completed, and four Preview candidates were generated. A later Preview Scoring interruption was caused by workflow-away hot reload rather than the Responses transport.
- Reviewer Gate returned `APPROVE` after completed assistant messages were tightened to require explicit `status: "completed"`.

## 2026-08-03

### T55 / Issue #183 ReID Preview persistence correction

- Corrected Run persistence so a currently confirmed Krea2 ReID policy-v5 workflow can restore its one-megapixel Preview dimensions instead of applying the ordinary longest-edge-768 limit.
- ReID restoration is authorized only by a ready version-2 prepared reference, the sanitized version-3 ReID reference context, the complete current final-policy contract, a confirmation fingerprint, and matching valid formal dimensions. Restored ReID Preview dimensions must equal the deterministic largest size at or below 1,048,576 pixels that preserves the exact formal aspect ratio, stays 16-pixel aligned, and never upscales either axis.
- Ordinary Preview restoration retains the existing longest-edge-768 behavior. Legacy, forged, or incompatible oversized records therefore still fail closed without weakening generated-image reference or path sanitization.

Validation during implementation:

- `npm run typecheck` passed.
- Focused ESLint and `git diff --check` passed.
- Test Gate updated the superseded 1024x1024 fixture, added current/ordinary/legacy/forged/partial-result regression coverage, and passed 162/162 persistence tests, 152/152 cross-module tests, and the full 2,053/2,053-test suite.
- Typecheck, lint, production build, and `git diff --check` passed; reviewer-agent returned APPROVE with no blocking findings.

## 2026-08-02

### T56 / Issue #185 Run scene-prompt strict JSON schema

Summary:

- Replaced the invalid profile-union pseudo-JSON shape with a genuinely parseable example containing only the selected Illustrious, Anima, or Krea 2 section.
- Added three fixed, strict, closed OpenAI/LiteLLM `json_schema` response contracts. Common scene fields and label/prompt fragments are required; Krea requires its six model-authored prose sections and excludes the locally owned LoRA-trigger section.
- Whitelisted the exact server-authored formats at the shared request-validation boundary, forwarded the accepted contract as `response_format`, and logged only its type, stable name, and strictness.
- Preserved the existing purpose/model routing, `stream: true`, and response normalization. Structured-output provider rejection is sanitized independently at both the LiteLLM client and API route boundaries, exposes only the upstream status and response-format summary, and has no retry or fallback path.

Validation:

- Focused Vitest: 5 files, 61 tests passed.
- Full Vitest: 156 files, 2,004 tests passed.
- `npm run typecheck`
- `npm run lint` (0 errors; 22 pre-existing `<img>` warnings)
- `npm run build`
- `git diff --check`, runtime-artifact scan, and credential-pattern scan
- Live configured LiteLLM probe: strict `json_schema` with `stream: true` returned HTTP 200 and assembled into valid JSON; the existing streaming mode remains unchanged.
### T55 / Issue #183 Krea2 ReID character reference

Summary:

- Removed the filename-text heuristic from Krea workflow profile validation first; RedCraft and other metadata-valid Krea diffusion resources now rely on authoritative profile, storage-kind, and normalized Civitai base-model metadata.
- Replaced the legacy Krea character/dual-image adapter path with a distinct, versioned ReID contract: exact user-installed `krea2_reid_rank32.safetensors`, strength 1.0, `kv_cache=true`, exactly one prepared `image1`, fixed Preview/Final sampling, generated-graph auditing, and no generic Krea reference or Repair fallback.
- Added server-only `onnxruntime-node` preprocessing with the bundled checksum-verified OpenCV Zoo YuNet March 2023 INT8 asset. EXIF/RGB normalization, confidence 0.35, highest-confidence selection, pinned upstream head/shoulders crop math, and the 384×384 pixel budget feed a portal chooser; only the selected prepared PNG is stored.
- Preserved the existing Krea style-image adapter independently. Active ReID pauses its transport without deleting state, keeps the analyzed style prompt exactly once, and restores compatible style conditioning when removed. Illustrious, Anima, prompt-only Krea, and style-only Krea contracts remain separate.
- Added fail-closed request, `object_info`, exact-file, descriptor/version, generated-graph, confirmation, persistence, and queue-time checks. ReID Final uses policy v4 at 8 steps while retaining redraw denoise and compatible Final settings; Repair construction and inpaint validation strip/reject all ReID state.
- Documented local setup, explicit consent/lawful-use UI, experimental Krea/FP8 warning, upstream repositories and licenses, ReID/YuNet checksums, prepared-only privacy boundary, and the absence of runtime model downloads or new environment variables.
- Review iteration 2 aligned YuNet inference with the checksum-pinned model's strict `[1,3,640,640]` float32 metadata contract, restored the pinned floor/ceil source-bbox then Python-round crop ordering, bounded multipart parsing and rejected extra/spoofed image parts, and made Krea policy-v4 gate/final/fallback linkage survive persistence reconciliation.
- The `onnxruntime-node` audit finding reaches `adm-zip` only through its package install helper; SceneForge request-time preprocessing loads the fixed bundled ONNX bytes directly and never accepts ZIP input. The install-time dependency risk remains documented rather than applying an unreviewed runtime downgrade.

Validation during implementation:

- The mandatory RedCraft-first `npm run typecheck` gate passed before ReID implementation began; the completed production update also passes `npm run typecheck`.
- The full pre-Test-Gate Vitest run passed 1,969/1,980 tests. The 11 remaining failures are stale Krea dual-image, dual-context, legacy preflight, and old component-state fixtures intentionally superseded by Issue #183; the Test Gate owns replacing them with ReID coverage.
- `npm run lint` passed with no errors and the existing 22 `<img>` optimization warnings. `npm run build` and `git diff --check` passed; the production route trace contains the bundled YuNet asset.
- The bundled YuNet file checksum matched `321aa5a6afabf7ecc46a3d06bfab2b579dc96eb5c3be7edd365fa04502ad9294`, and the documented user-installed ReID weight checksum is `a80349faee4a2d80eff9a83820cd523c74cd0bbc6039cee21fa34b084d967944`.
- Review iteration 2 directly loaded the bundled YuNet model and completed a real `session.run` with input `[1,3,640,640]`; all expected stride-8/16/32 classifier, objectness, bbox, and landmark tensors were returned, and production preprocessing completed against the real session. The focused preprocessing, runtime-contract, multipart, policy-v4 persistence, and documentation-contract suites passed 175/175 tests, followed by passing typecheck and production build.

### T53 / Issue #178 Anima Run character-reference adapter compatibility

Summary:

- Replaced the incompatible generic `ComfyUI_IPAdapter_plus` graph for Anima character references with the dedicated `AnimaIPAdapterLoader` and `AnimaIPAdapterApply` contract from `LuciferTC9527/ComfyUI-Anima_IP-Adapter`.
- Locked Anima to the exact `ip_adapter-Character_Reference-10.safetensors` adapter, disabled request-driven SigLIP2 downloads, mapped the 0-1 character strength with a 0.8 default, and fixed the verified 512px/SigLIP/IP-CFG/LoRA apply settings.
- Added fail-closed Run preflight before reference upload and queueing for the dedicated node classes, every required input port, and the exact adapter file exposed by ComfyUI `object_info`.
- Preserved generic IPAdapter behavior for Illustrious/default workflows and the existing Krea2 Ostris Edit path; Anima style references and FaceID remain outside this change.

Final validation:

- The focused Issue #178 suite passed 177 tests, the isolated Final/Repair suite passed 97 tests, and the full Vitest suite passed 1,975 tests across 155 files.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed; lint retained 22 existing `<img>` optimization warnings and no errors.
- Live ComfyUI `object_info` confirmed both dedicated node classes, every required Loader/Apply port, and the exact adapter filename option.
- A live 512x512 one-step Anima character-reference queue loaded 728 adapter keys, installed and patched all 28 Anima blocks, encoded `[1, 1024, 768]` SigLIP2 reference tokens at strength 0.8, and completed successfully.
- Test Gate returned `PASS`; Review Gate returned `APPROVE` with no blocking findings.

## 2026-07-29

### T52 / Issue #175 Incremental Civitai recommendation indexing

Summary:

- Kept Civitai parse preview free of embedding calls and derived-index writes, and kept existing-resource imports link-only.
- Added deterministic per-resource FTS source construction plus bounded LiteLLM embedding preparation for only new or changed resource chunks.
- Added empty-library bootstrap and strict nonempty baseline validation across FTS source text, vector chunk metadata, embedding model/dimensions, schema, chunk configuration, global source fingerprint, indexed count, and timestamp.
- Revalidated the baseline after `BEGIN IMMEDIATE`, then committed business rows, categories, image usage, FTS rows, vector chunks, and global metadata atomically. Concurrent changes, malformed provider output, dimension mismatch, and provider failures fail with sanitized messages and no partial database mutation.
- Updated confirmed reanalysis to skip embedding when deterministic search text is unchanged and otherwise replace only the affected resource. Conflict merges remove obsolete derived rows in the same transaction.
- Preserved the complete `civitai:reindex` and `civitai:reindex-embeddings` commands as repair/configuration-change paths.

Final validation:

- Focused Vitest passed 69 tests across persistence, service, import, reanalysis, and recommendation coverage.
- Full `npm test` passed 1,939 tests across 154 files.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed; lint retained 22 pre-existing `no-img-element` warnings outside T52 scope.
- Review Gate approved after fixes added exact FTS5/`unicode61` and vec0 `float[N]` compatibility checks, post-conversion Float32 overflow rejection, correct 409 preservation, one bounded `indexed_at`-only baseline retry, and fail-closed handling when concurrent work changes resource/source compatibility.
- Live LiteLLM smoke validation was not run because it depends on local provider configuration.

### T51 / Issue #172 merge closeout

- Merged PR #173 into `master` with merge commit `3a9c8ab`.
- Confirmed PR-target CI passed and Issue #172 closed automatically.
- Marked T51 `Done` after Test Gate `PASS` and Review Gate `APPROVE`.

## 2026-07-27

### T51 / Issue #172 Run visual-style control

Summary:

- Added one independent Anime/Photoreal Run selector to Simple and Detailed Composer modes, propagated it through suggestion/rewrite, Scene Prompt, resource/parameter advice, style-reference analysis, confirmation, and persistence, and preserved explicit resources and generation settings while staling from Scene Prompt on change.
- Added deterministic profile-aware prompt compilation with an authoritative structured `visualStyleAndMedium` section, exact local positive guidance, minimal opposing-domain negatives, narrow conflict fallback, and Photoreal suppression of only LLM-authored artist fields while preserving selected resource triggers.
- Added per-candidate Preview style assessment as a hard gate separate from defect eligibility, plus fail-closed Final and Repair verification. Mismatched or unavailable Final/Repair artifacts cannot be selected or reused; verified formal-size Preview fallbacks remain available.
- Added persistence identity reconciliation across scoring, Final review, Repair parents/verification, confirmation, retry, and result display. Continuable legacy Runs normalize to Anime and require the current assessment path; completed legacy history restores without provider calls and is labeled `style-unassessed`.
- Kept Story behavior, existing LiteLLM purpose/model routing, and environment configuration unchanged.

Implementation Gate validation:

- `npm run typecheck` passed.
- `npm run lint` passed with zero errors and 23 unrelated pre-existing warnings.
- `npm run build` passed.
- `npx vitest run src/features/editor/ai-prompt/illustrious-prompt.test.ts src/features/editor/ai-prompt/anima-prompt.test.ts src/features/agent-timeline/run-scene-suggestion.server.test.ts src/app/api/agent-timeline/run-scene-suggestion/route.test.ts` passed (4 files, 51 tests).
- `git diff --check` passed.

Test and Review Gate validation:

- Focused visual-style and review-fix coverage passed with 233 tests.
- `npm test` passed with 153 files and 1,908 tests.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed; lint retained 23 unrelated baseline warnings and the build generated 48 static pages.
- Simple and Detailed jsdom UI coverage verified selector propagation, cross-style artifact removal, variant rejection, sidebar/result hiding, and Inpaint suppression. A completed active-workflow browser smoke remains environment-dependent.
- Review Gate returned `APPROVE` after one fix loop cleared stale generation artifacts, added current-style/status action guards, and covered bounded `3D cartoon` and `semi-real illustration` conflict variants.

## 2026-07-26

### T50 / Issue #169 Adult NSFW empty Run suggestions

Summary:

- Required every empty-input candidate in both initial and repair prompts to depict exactly one person as the sole visual subject, excluding additional, coupled, grouped, crowd, and background people. SFW candidates require one female protagonist and diverse safe settings, with campus optional rather than required or default; SFW does not inherit the 21+ rule.
- Conditioned `nsfw: true` prompts to request six clearly adult NSFW concepts with varied mature intensity, require the sole person to be explicitly 21+ without requiring that protagonist to be female, and prohibit minors, ambiguous-age or youth-coded subjects/settings, coercion, exploitation, non-consensual sexual content, and unlawful sexual content.
- Reused the existing `ageGroup` fingerprint as an explicit numeric 21+ declaration. Invalid NSFW age declarations are rejected before ranking through the existing parse/repair/failure path without parsing, reconstructing, or rewriting `sceneRequest`.
- Hardened that declaration to a full-string bounded age-label grammar. Youth/non-adult tokens and unrelated-number phrases such as a shoe size are rejected; supported plus, age/aged, years-old, year-old, adult-prefixed, range, and list forms remain accepted only when every declared age is at least 21.
- Kept person count, background exclusion, and SFW gender as provider contract instructions because existing fingerprints cannot validate them reliably without semantic prompt parsing or schema/history changes. Preserved the NSFW-model/default fallback, six-candidate schema, request budget, deduplication, ranking/selection, shared bounded history/privacy, UI/routes, and all nonempty or downstream workflows.

Implementation Gate validation:

- `npm run typecheck`
- `npx eslint src/features/agent-timeline/run-scene-suggestion.server.ts src/features/agent-timeline/run-scene-suggestion.ts`
- `npx vitest run src/features/agent-timeline/run-scene-suggestion.test.ts src/features/agent-timeline/run-scene-suggestion.server.test.ts` (67 tests)
- `git diff --check`

Closeout:

- Test Gate passed 140 focused tests and 1,850 full-suite tests with typecheck, lint, production build, and diff-check.
- Review Gate returned `APPROVE` after a red-to-green regression pass hardened `ageGroup` against youth-coded labels and unrelated numeric values.
- The lint run reported zero errors and retained 23 unrelated pre-existing warnings.
- Merged PR #170 into `master` after PR #168, closed Issue #169, and confirmed the PR-target CI validation passed.

### T49 / Issue #167 Preview Scoring default-model routing

Summary:

- Locked ordinary, NSFW, and Krea single-image Preview Scoring to `LITELLM_DEFAULT_MODEL` in both the direct timeline adapter and `/api/llm/chat`, ignoring Vision, NSFW, and request-level model overrides for this purpose while preserving the true `nsfw` flag.
- Added a safe recoverable `llm_config` failure before any provider call when the default model is absent; completed Preview candidates remain available for a scoring retry and Final generation does not advance.
- Documented that the configured default must support multimodal image input and a content policy that permits the ordinary or NSFW images it is expected to score. Final Review, Repair, style-reference analysis, Story, and other model routes remain unchanged.

Implementation Gate validation:

- `npm run typecheck`
- `npx eslint src/app/api/llm/chat/route.ts src/features/agent-timeline/t8-server-adapters.ts`
- `git diff --check`

Closeout:

- Test Gate passed 46 focused and 1,820 full-suite tests with typecheck, lint, build, and diff-check.
- Review Gate returned `APPROVE` with no blocking findings.
- Merged PR #168 into `master` and closed Issue #167.

### T48 / Issue #165 Empty Run Suggest diversity

Summary:

- Routed only empty-input Run Suggest through a dedicated thin API and existing LiteLLM client, requesting six complete LLM-authored scene candidates with explicit profile compatibility and bounded concept fingerprints. Nonempty Suggest and Rewrite retain their existing generic-chat path.
- Added pure typed parsing, structured profile validation, duplicate rejection, deterministic history/batch novelty ranking, and the required weighted 3/2/1 candidate selection. Selected `sceneRequest` text is preserved intact except outer trim.
- Added one bounded schema-repair attempt and zero-candidate fail-closed behavior that restores the original Composer/workflow state.
- Added installation-local schema-v1 JSON history with serialized atomic writes, 64 KiB read bound, latest-20 pruning, fingerprint-only avoidance context, nonblocking read/write degradation, and no Civitai, ComfyUI, workflow-start, or asset coupling.

Implementation Gate validation:

- `npm run typecheck` passed.

### T47 / Issue #163 Krea 2 Final second-pass tuning

Summary:

- Kept Krea formal planning and Preview at 8 steps, CFG 1, Euler, and simple while resolving Final Conservative/Balanced/Strong to 4/0.12, 4/0.18, and 6/0.28.
- Reused each selected Preview seed and managed upscale, preserved Detailers and semantic request bindings, and carried resolved Krea steps through the confirmation gate, Final request, execution metadata, and candidate records.
- Introduced a Krea-only policy v3 while leaving ordinary Final policy v2 unchanged. Managed-upscale and exact retry identity now reject older, incomplete, missing-step, or cross-policy Krea work; completed v2 Krea results remain historical display state.
- Documented the Krea-only override without changing source Preview denoise, prompt/resource/style-reference behavior, review, Repair, or Illustrious/Anima/fallback policy.

Implementation Gate validation:

- `npm run typecheck` passed.
- Focused pre-test update run reached 224 passing tests; five expected assertions still described the superseded Krea 8-step/0.45 or v2 fixture contract and are owned by the Test Gate.

### T46 / Issue #161 Krea 2 Environment-Aware Prompt Composition

Summary:

- Added `environmentAndBackground` to the persisted Krea section map, response aliases, and authoritative render order. Generation now explicitly requires the field for ordinary character-and-scene Krea responses; optional parsing remains only as malformed-response and manual-input tolerance, with no historical-project migration or compatibility branch.
- Expanded only the Krea scene-prompt contract with non-overlapping environment/composition ownership, supported foreground/midground/background layers, relative scale, atmospheric depth, subject-background contrast, faithfulness and non-invention rules, cohesive-paragraph output, and approximate 160-240-word guidance without local enforcement.
- Increased only the Krea structured scene-response budget from 900 to 1800 tokens while leaving Illustrious, Anima, and Krea negative-suggestion behavior unchanged.
- Added punctuation-aware local Krea section, selected-LoRA-trigger, and opaque style-reference assembly. Krea confirmation uses matching normalized tail/exact-once validation; other profiles retain their existing style-reference append and validation paths.

Implementation Gate validation:

- `npm run typecheck` passed.
- Targeted ESLint passed for the scoped Krea and timeline modules.
- Focused Krea/T5/T7/T8 Vitest validation passed: 4 files and 117 tests.
- `git diff --check` passed with line-ending warnings only.

Final gates:

- Test Gate passed 5 focused files and 296 tests, then the full 148-file, 1,735-test suite.
- `npm run typecheck`, `npm run lint` (0 errors and 23 existing warnings), `npm run build`, `git diff --check`, and scoped secret/runtime-artifact scans passed.
- Review Gate approved after three fix loops covering authoritative Krea style validation, opaque quoted JSON content, Unicode and prose separators, and distinct exact-token handling for triggers such as `art_style`, `art`, and `art-based`.
- Live LiteLLM and ComfyUI generation remain environment-dependent manual follow-up; deterministic tests cover JSON parsing through final prompt assembly and confirmation.

### T45 / Issue #159 Krea 2 Render Prompt AI Advice

Summary:

- Restored the shared resource-aware Style Advice call for unsaved Krea 2 Run parameters while preserving the saved-parameter skip and local fallback paths.
- Kept the deterministic local Krea renderer authoritative for the final positive prompt while allowing compatible advised resolution, negative-prompt additions, selected-LoRA weights, and rationale through the existing resolver.
- Preserved source dimension and Composer denoise precedence and added strict validation of effective Krea dimensions before the shared resolver can round them.
- Hard-locked the main Krea request to 8 steps, CFG 1, Euler, and simple scheduling in the displayed result, request preview, manual parameter workspace, and confirmed execution boundary. The execution boundary recognizes Krea independently from Run input settings, request metadata, or an existing Krea request profile so a missing or conflicting request profile cannot bypass the lock. Independent Detailer settings remain unchanged.
- Replaced full-payload image data URL regular expressions with fixed-prefix parsing and iterative base64 character validation. This avoids runtime regular-expression stack exhaustion when a formal-size managed Preview fallback is carried into the Final img2img upload path while preserving the accepted PNG/JPEG/WEBP contract.
- Preserved sanitized per-Final execution errors when an error record has valid candidate linkage. A current-policy pre-upscale error may omit fallback metadata; when fallback metadata is present, it must still match the selected Preview and formal dimensions exactly. Malformed completed Final records continue to fail closed with `image_storage_invalid`.
- Clarified the Krea-only scene prompt instructions so the positive prompt and ordered Krea sections remain free of negative language while `negativeSuggestions` still returns concise, English, comma-ready undesirable visual concepts. The prompt forbids sentence-like or imperative instructions, positive desired outcomes, and invented negatives, and permits an empty array when none is justified.

Implementation Gate validation:

- `npm test -- src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-node-adapters.test.ts` passed during implementation; final focused and full-suite totals belong to the Test Gate report.
- `npm run typecheck` passed.
- Targeted ESLint passed for the scoped production modules.
- `git diff --check` passed with line-ending warnings only.
- Follow-up validation passed the focused ComfyUI validation, Final server adapter, and timeline persistence suites: 3 files and 178 tests.
- Persistence reconciliation follow-up passed `src/features/agent-timeline/timeline-workflow-persistence.test.ts`: 1 file and 141 tests.
- Krea negative-suggestion prompt follow-up passed `src/features/agent-timeline/t5-node-adapters.test.ts`: 1 file and 8 tests; targeted ESLint and `npm run typecheck` also passed.

### T44 / Issue #155 Krea 2 FaceDetailer and HandDetailer

Summary:

- Merged PR #157 into `master` as `bae3db0`; Issue #155 closed.
- Enabled the existing independent FaceDetailer and HandDetailer controls for Krea 2 Final requests while retaining the explicit Preview-only disablement.
- Added Krea Final graph wiring from the Krea UNET/CLIP/VAE model context through the selected Detailer nodes before `SaveImage`.
- Added fail-closed Krea Detailer preflight checks for the complete generated graph, required node inputs, KSampler/detailer sampler settings, detector model, and exact Krea local UNET/CLIP/VAE files before any queue request.
- Restored Krea workflows with their persisted Detailer choices, while legacy/missing settings still sanitize to both controls off.
- Synchronized the T44 implementation with merged T42/T43 behavior. Krea Repair now preserves the user's signed Detailer choices without diagnosis-controlled enablement changes; adapter + Detailer Final graphs preserve the selected model context, and Final/Repair keep Hand-before-Face ordering.
- Bound reusable Finals to a canonical semantic request digest so Detailer-only changes cannot reuse an incompatible image while unchanged partial retries still reuse completed siblings. Krea adapter-enabled Finals now persist only a signed, transport-free adapter descriptor; Repair identity includes it and the Repair sampler/Detailers inherit the verified patched model context.

Validation:

- Pre-sync T44 validation passed 272 focused and 1,643 full-suite tests. Final synchronized validation passed 552 focused tests across 12 affected files and 1,673 full-suite tests across 147 files, plus typecheck, lint with no errors, production build, and diff-check. Review Gate approved the T42/T43/T44 integration after Final reuse and adapter-enabled Repair identity hardening.

### T43 / Issue #154 Krea 2 Global Style Prompt and Verified Reference Adapter

Summary:

- Extended the shared sanitized Run style-reference contract to Krea 2: the analyzed `stylePrompt` is appended exactly once to the natural-language Krea prompt and is reconfirmed across staged Preview and Final requests.
- Preserved metadata-only workflow persistence; reference bytes, data URLs, and temporary ComfyUI input names remain outside persisted timeline state.
- Added a visible no-queue Krea adapter preflight plus repeated queue-time fail-closed validation for compatible Krea 2 Turbo diffusion context, `TextEncodeKrea2OstrisEdit`, `Krea2OstrisEditModelPatch`, required ports, `LoraLoaderModelOnly`, and exact `krea2_style_reference.safetensors` availability.
- Built the Krea-specific reference graph instead of reusing generic IPAdapter nodes. Prompt-only generation remains usable when no adapter is selected; a restored or explicitly enabled adapter stays selected and blocks while preflight is pending or unavailable until verification succeeds or the user explicitly opts out. Enabled adapters never queue when preflight or queue-time validation fails.
- Kept ControlNet, entity references, Story, hidden adapter injection, and image-byte persistence outside the Krea scope. Reference edits continue to stale downstream parameter/generation work and cancel prior confirmation. T44 subsequently adds independently selected Detailers without weakening adapter preflight.

## 2026-07-25

### T40 / Issue #147 Civitai Red Import Without Content Filtering

Summary:

- Added an exact Civitai image-page host and path allowlist for `.com`, `.red`, their `www` variants, and pure numeric image IDs; input URLs are reduced to an ID and never become fetch targets.
- Made the explicit Civitai image-ID lookup always send `nsfw=X`, independently of `SCENEFORGE_SHOW_NSFW_BUTTON`, SQLite `supportsNsfw`, and downstream generation context.
- Parse preview and confirmed import each perform their own fixed API lookup; Settings changes do not alter metadata import results.
- Replaced empty-result wording with a neutral unavailable/private/deleted/content-filtered explanation and redacted raw upstream errors from image-import route responses.

Validation:

- Focused validation passed 79 tests across 7 files.
- The full Vitest suite passed 1,595 tests across 140 files.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed; lint reported 23 existing warnings and no errors.
- Review Gate approved the URL/SSRF boundary, settings-independent fixed `nsfw=X` lookup, metadata fidelity, route error redaction, and scope.
- Live Civitai API verification returned image ID `135795968` with referenced model version `3100032`; the follow-up model-version request resolved a downloadable Krea 2 checkpoint with three files. Complete live caching and SQLite persistence remain environment-dependent.

### T39 / Issue #145 Krea 2 Turbo Direct Run Profile

Summary:

- Added the `krea2` prompt/workflow profile, Krea 2 Civitai compatibility filtering, and diffusion-model storage classification while retaining the existing Illustrious and Anima profiles.
- Added a deterministic Krea prompt renderer that emits one faithful natural-language paragraph in the author-recommended subject-to-LoRA order, preserves quoted user text and requested media, avoids fabrication, and deduplicates selected LoRA triggers.
- Added the fail-closed Krea ComfyUI workflow: local UNET, Krea CLIP, Qwen Image VAE, optional `LoraLoaderModelOnly`, empty latent, KSampler, decode, and save. Validation rejects missing required `object_info` nodes/inputs/files and all source, reference/IPAdapter, ControlNet, Detailer, preview, or inpaint inputs.
- Added the confirmation-gated direct Run branch: one 16-aligned txt2img output with 1024×1024 / 8-step / CFG-1 / Euler-simple defaults. Preview, scoring, redraw, review, repair, and verification persist a visible structured `not-applicable` result without an LLM or external generation call.
- Added safe Krea persistence/restore behavior. Legacy source, reference, Detailer, and repair controls are cleared before downstream state can be reused, and restored work requires explicit reconfirmation.
- Documented the Krea user workflow, local ComfyUI prerequisites, and technical direct-branch contract in the README, product specification, and technical specification.
- Review hardening keeps Krea Run-only: Story exposes and persists only Illustrious/Anima profiles, while malformed legacy Story Krea input coerces to Illustrious. Krea profile resolution now requires normalized Krea 2-family metadata plus diffusion storage and never infers from filenames. Confirmation rejects automatic repair, manual parameters normalize to 16-pixel alignment before signing/queueing, scene-context edits preserve or safely map Krea ordered sections, and trigger matching no longer treats substrings as duplicates.

Validation:

- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings and no errors.
- `npm run build` passed.
- `npm test` passed: 143 files, 1,573 tests.
- PR `#146` merged into `master`; Issue `#145` closed.

## 2026-07-24

### T38C / Issue #142 Repair Identity and Error-Boundary Hardening

Summary:

- Made the Repair attempt SHA-256 identity a shared deterministic contract and reject any previous or persisted attempt whose digest does not match the exact workflow, candidate, and parent binding before diagnosis, managed-image work, or ComfyUI queueing.
- Canonicalized workflow and disk-checkpoint attempts through one pure state-aware sanitizer; checkpoint envelopes and nested attempt/image references reject unknown unsafe fields before history, storage, or client propagation.
- Added checkpoint-v3 base request digests to bind Repair attempt identity to validated confirmed generation semantics before diagnosis or mask lookup, without persisting raw prompts or requests.
- Added diagnosis-adjusted Repair request digests and require exact matches before queue submission, history recovery, and managed output storage.
- Required repaired-pair source provenance to match exactly between the top-level result and stored Repair attempt, including the derived output node, across restore, verification, and promotion.
- Legacy or incomplete Repair checkpoints now fail closed, while persistence demotes invalid Repair state without discarding the valid Preview or Final result.
- Added fail-closed checkpoint and managed-image read/store boundaries whose returned and persisted errors use fixed stage-specific codes, messages, and bounded metadata without upstream paths, payloads, prompts, or secrets.
- Applied closed error allowlists to Final-repair and Repair-verification node errors plus failed verification results, and clarified that verification configuration failures leave only Preview and Final selectable.
- Restricted the generic Final-review selector to Preview/Final so Repair promotion remains available only through the verification- and parent-guarded Repair selector.

Validation:

- Focused Repair execution, checkpoint, persistence, verification, privacy, and selection tests passed 170 tests across 4 files.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 pre-existing warnings and no errors.
- `git diff --check` passed with line-ending warnings only.

## 2026-07-22

### T38C / Issue #142 One-Shot Local Final Repair

Summary:

- Upgraded the Run definition to v4 with `final-review -> final-repair -> repair-verification -> result-display` and a default-off Composer authorization covered by generation confirmation.
- Added locally derived contact/object-count repair eligibility, strict single-region mask validation with a 35% before/after-growth ceiling and 64-pixel growth cap, existing high-resolution ComfyUI inpaint execution, managed Repair storage, request-local Detailers, and resumable failure handling that never repeats a successful repair.
- Added one optional SAM2 refinement for a single clear rectangle/ellipse target through existing request, `object_info`, queue/history, and storage boundaries. Unavailable or invalid SAM2 safely retains the independently validated structured mask and records refinement provenance.
- Added per-pair queued/output-ready/stored repair checkpoints, exact Final/review/target parent binding, closed diagnosis cardinality/locality validation, and a repair-specific redacted LiteLLM purpose so interruption, storage failure, changed parents, ambiguous targets, and request/response logging fail safely.
- Added one bounded Preview/Final/Repair verification pass with local recommendation and explicit-only Repair selection in Simple and Detailed result views.
- Added fail-closed persistence sanitization and linkage reconciliation for authorization, candidates, seeds, dimensions, managed images, masks, findings, and recommendations. Legacy workflows restore without automatic repair calls.
- Reconciled exact matching disk/workflow Repair checkpoints monotonically so returned queued/output-ready/stored state outranks an older checkpoint without accepting mismatched attempt linkage. Uncertain `queue-started` outcomes now use a closed `queue-outcome-unknown` reason, show safe manual guidance, and suppress Repair retry in Simple and Detailed modes. The default Repair checkpoint directory is ignored by Git.

Validation:

- `npm run typecheck`, `npm run lint` (23 pre-existing warnings, no errors), the focused T38C unit suite (7 tests), and the combined T38C/existing SAM2 validation (13 tests across 3 files) passed during implementation. Full test, build, and independent Test/Review Gate evidence are recorded during closeout.

### T38B / Issue #139 Preview-Final Review and Result Selection

Summary:

- Upgraded the Run definition to v3 with `comfyui-execution -> final-review -> result-display` and definition-derived API/client generation stages.
- Added one bounded high-detail Vision review for all 1-4 managed Preview/Final pairs, reusing path-safe transient JPEG conversion, ordinary/NSFW fail-closed routing, redacted logging, safe upstream/schema classification, and at most one schema repair.
- Added strict local normalization for five scores per variant plus pose, contact, object-count, and composition-consistency findings. Recommendation/default are computed locally; only a major or blocking issue introduced by Final selects the Preview fallback.
- Persisted and reconciled both managed variants, review state, recommendation/default, and optional user selection. Review failure keeps complete variants selectable and supports review-only retry; legacy workflows do not start review automatically.
- Added shared Simple/Detailed Final/Preview selectors. Explicit selection controls displayed images immediately, autosaves, restores, and does not call LLM/ComfyUI or stale upstream nodes.

Validation:

- Focused T38B validation passed 8 files and 255 tests; the final mixed-attempt review suite passed 29 tests.
- The full Vitest suite passed 1,347 tests across 134 files; `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. Lint reported 23 pre-existing warnings and no errors.
- Test Gate returned PASS and Review Gate returned APPROVE. Browser runtime had no available session, so desktop/mobile visual QA and live LiteLLM Vision/NSFW plus ComfyUI quality validation remain environment-dependent manual follow-ups.
- Merged PR `#140` into `master`; Issue `#139` closed.

## 2026-07-20

### T38A / Issue #136 Preserve Preview Structure in Final Generation

Summary:

- Added a versioned Run Final policy to the signed confirmation contract: selected Previews are deterministically resized with server-side Sharp Lanczos3 to exact formal dimensions and stored as candidate-linked managed `preview-upscale` fallbacks before queueing.
- Made the managed fallback the sole Final img2img source, lowered internal Final denoise to 0.30 for Illustrious and 0.35 for Anima/unknown fallback, and preserved formal settings, seeds, resources, style/IPAdapter context, and enabled Detailers.
- Added safe persistence and reconciliation for Preview/fallback/Final linkage, partial failure, retry reuse, unchanged-fallback no-op detection, incompatible legacy aspect rejection, and completed legacy result display.
- Kept Preview-Final Vision review, automatic fallback quality selection, ControlNet/model upscaling, and repair/inpaint orchestration out of this issue.
- Follow-up upgraded the Final policy to v2 with Conservative, Balanced, and Strong redraw presets. Balanced is the default; Illustrious resolves to 0.30/0.40/0.50 and Anima/fallback to 0.35/0.45/0.55.
- Added one shared Simple/Detailed Composer control with resolved denoise and Strong risk messaging. Preset-only changes retain valid Preview/scoring/selection/seed state, require reconfirmation, and resume from Final without cross-preset Final reuse.
- Restricted persistence to the preset enum, bound resolved preset/family/denoise metadata into confirmation and execution, kept completed v1 results read-only, and requires incomplete v1 Runs to reconfirm.
- Validation: focused Final-policy, settings, workflow, persistence, API, server-adapter, and Simple/Detailed UI coverage passed with 9 files and 290 tests; the full Vitest suite passed 1,313 tests; typecheck, lint, production build, diff-check, Test Gate, Review Gate, and GitHub CI passed.
- Merged PR `#137` into `master`; Issue `#136` closed.

### Issue #133 Scored Run Previews

Summary:

- Upgraded the Run-only single-image definition to v2 with confirmation-gated preview execution, strict multimodal scoring, Top-K selection, and independent final img2img passes.
- Added deterministic pool/dimension/seed contracts, safe preview/final references, partial-final recovery, phase retry actions, legacy Run migration, and Detailed-mode exact-K reselection while leaving Story and Editor execution unchanged.
- Reviewer hardening bound the HMAC confirmation contract to the workflow identity, split Simple generation into server-validated preview/scoring/final stages, and added strict typed restore validation for managed image references and structured scoring.
- Restored scoring now recomputes fixed-weight totals and validates global ranking, AI Top-K selection, manual exact-K selection, and preview/final/result cross-node linkage before allowing continuation or display.
- Live-quality follow-up added model-family Balanced previews (exact-aspect 8-pixel-aligned dimensions up to longest-edge 768 and up to 20 steps for every Run profile), raised final img2img denoise to 0.60/0.65 by family, bound history reads to the queued output node, and turns unchanged fresh final hashes into recoverable rerenders. Extreme ratios that cannot produce an exact aligned downscale fail validation instead of being stretched.
- Scoring follow-up upgraded high-detail comparative Vision output to rubric v2 with typed defect annotations and locally enforced eligibility. Runtime quality correction narrowed blocking eligibility to unusable anatomy/structure, unmistakable physical impossibility, and catastrophic exposure/technical corruption; prompt-detail, prop/contact, appearance, action/gaze, and framing mismatches reduce scores without normally blocking. Eligible-first ranking now fills an exact Top-K with visibly annotated fallback candidates when needed instead of terminating an otherwise usable workflow.
- Runtime hardening simplified the Vision schema to defect-category strings and locally derived eligibility, added exact tolerant normalization for known category/numeric variants plus a bounded safe schema-repair retry, and exposed only safe validation diagnostics. Fixed-seed preview retries advance through non-overlapping candidate windows with safe wraparound under a post-confirmation, server-request-only adapter authorization; persisted/client retry markers are dropped and cannot override a newly confirmed formal seed. Network/runtime failures before a Vision completion now remain safely classified as `llm_upstream`, while only received malformed completions can trigger schema repair or `llm_malformed_response`. Legacy rubric cards explicitly report that eligibility was not assessed. Comparative scoring keeps all 4/6/8 candidates in one call while using transient in-memory quality-85 JPEG copies; managed previews remain untouched for the final pass.
- Removed source-img2img's forced-one delivery behavior and documented the multimodal NSFW model requirement.

Validation:

- `npm run typecheck` passed.
- `npm run lint` passed with 23 pre-existing warnings and 0 errors.
- `npm run build` passed.
- Focused validation passed 204 tests and the full Vitest suite passed 1,175 tests.
- Test Gate and Review Gate passed; browser QA covered Detailed scoring output, Simple/Detailed switching, and desktop/390px layouts without horizontal overflow.
- Live LiteLLM Vision/NSFW and ComfyUI generation remain environment-dependent manual validation.

### Issue #133 Merge

Summary:

- Merged PR #134 for scored Run previews, structured Vision ranking, exact Top-K selection, and second-pass final generation.
- Issue #133 was closed automatically by the merge and T37 was marked done.
- The final Test Gate passed 289 focused tests and all 1,260 tests; typecheck, lint, production build, diff-check, reviewer approval, and GitHub CI Validate passed before merge.
- The merged commit is `d3c6d05500659ae6a841a56252df743488c41451`.

### Issue #130 Merge

Summary:

- Merged PR #131 for the Run global style-reference prompt and optional Illustrious IPAdapter workflow.
- Issue #130 was closed automatically by the merge and T36 was marked done.
- GitHub CI Validate passed before merge; the merged commit is `6cba2862e861397674a78c7907fb22cce062efca`.

## 2026-07-19

### Issue #130 Run Global Style Reference

Summary:

- Extracted the T33 style-reference metadata, analysis, capability, context, prompt, and sequence-style IPAdapter contracts into a workflow-neutral module while retaining the Story-named API surface.
- Added one shared Run style-reference upload/analyze/retry/replace/remove state to simple and detailed Composer modes, including editable analyzed prompt text, prompt-only/IPAdapter capability, defaults `0.45/0/1`, safe persistence/restore, and context mismatch handling.
- Appended the analyzed prompt exactly once after T7 resource-aware formatting, blocked invalid reference states through start/regeneration/confirmation, staled post-start edits from parameter recommendation, and added optional Illustrious IPAdapter upload/validation to confirmed T8 execution without changing img2img, batch, or Detailer ownership.
- Reviewer fix loops tightened confirmation parity in both directions, validate opaque style segments only at comma-delimited boundaries, require a formal checkpoint result whenever a style reference exists, and map reference upload failures to fixed safe client guidance and a static redacted server log without echoing exception names, filesystem paths, tokens, or upstream diagnostics.

Validation:

- `npm run typecheck` passed.
- Focused existing Vitest validation passed with 9 files and 163 tests; full `npm test` passed with 125 files and 1038 tests.
- `npm run lint` passed with 23 pre-existing warnings and 0 errors.
- `npm run build` passed and generated 46 static pages.
- Live LiteLLM vision analysis, live ComfyUI IPAdapter execution, and browser QA remain environment-dependent and were not run during implementation.

### Issue #127 Merge

Summary:

- Merged PR #128 for Run checkpoint/LoRA resources, generation parameters, FaceDetailer/HandDetailer controls, and the refined responsive single-image input layout.
- Issue #127 was closed by the merge and T35 was marked done.
- CI Validate passed before merge; the merged commit is `2978a830437c1403aa65e2e859d40a0a64e055c9`.

## 2026-07-18

### Issue #127 Run Generation Controls

Summary:

- Added typed, sanitized Run scene-input snapshots for explicit ready checkpoint/LoRA resources, saved generation parameters, and independent FaceDetailer/HandDetailer settings.
- Reused workflow-neutral Story style-palette and Detailer contracts and the shared Detailer editor in the simple and detailed Run composers.
- Added manual T7 resource/parameter branches that bypass their AI providers, targeted post-start stale propagation, restore support, img2img precedence, and authoritative Detailer overlays through preview and confirmed T8 requests.
- Kept style references and IPAdapter out of scope for the separate T36 track.

Validation:

- Tester-agent Test Gate: `PASS`.
- Targeted Vitest validation passed with 8 files and 101 tests.
- `npm test` passed with 124 files and 1028 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 pre-existing warnings and 0 errors.
- `npm run build` passed and generated 46 static pages.
- Browser QA and live ComfyUI execution were not run; manual verification remains recommended.

## 2026-07-09

### Issue #125 Reviewer Blocker Fixes

Summary:

- Stopped Story planning immediately after the first node failure so ready sibling nodes in the same planning layer are not run after an error.
- Added regression coverage for a `story-safety-plan` failure while shot dependency, plot state, and character continuity nodes are already ready.
- Passed `LiteLlmError` status code and details into Story planning error logs and documented `SCENEFORGE_LLM_LOG_DIR=off` for split local LLM logging.

Validation:

- `npm test -- src/features/agent-timeline/story-runner.test.ts src/features/llm/llm-local-log.test.ts src/features/agent-timeline/workflow-definition.test.ts` passed with 3 files and 19 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.
- `npm test` passed with 123 files and 1015 tests.

## 2026-07-07

### Issue #122 Merge

Summary:

- Merged PR #123 for Story global style reference support.
- Issue #122 was closed by the merge.
- Updated the development tracker to mark T33 done.

### Issue #122 Reviewer Blocker Fixes

Summary:

- Hardened Story style reference metadata persistence so restored workflow state treats validated `storedFilename` as canonical, derives the sequence-reference URL from it, and drops unsafe display filenames such as paths, URLs, traversal strings, and data URLs.
- Kept `story-style-reference-analysis` on explicit/vision/default model selection even when NSFW routing is enabled, while preserving the NSFW model override for ordinary request purposes.
- Added analysis-context tracking to the `/story` style reference draft so changing Core Settings or the selected checkpoint after analysis blocks start and exposes Retry/Remove before planning can continue.

Validation:

- `npm test -- src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/StoryPlanningPreview.test.tsx src/app/api/llm/chat/route.test.ts src/features/llm/llm-local-log.test.ts` passed with 6 files and 108 tests.
- `npm run typecheck` passed.
- `npm test` passed with 122 files and 1003 tests.
- `npm run lint` passed with 23 existing warnings.

## 2026-07-05

### Issue #122 Story Style Reference

Summary:

- Added one optional global `/story` style reference image input that uploads through sequence-reference storage and analyzes the image through `/api/llm/chat` with the `story-style-reference-analysis` purpose, asking the LLM for Illustrious- or Anima-compatible style prompt text based on Core Settings.
- Persisted Story style reference metadata, analyzed style prompt, selected-model settings, and optional IPAdapter controls while excluding image bytes and data URLs from Story workflow records.
- Appended the analyzed style prompt as a complete segment in Story render prompts and execution requests for final generation and regeneration, preserving the LLM's base-model-specific formatting instead of splitting or re-deduping it.
- Reused the editor sequence IPAdapter reference structures and upload path for Story execution, injecting the style reference only for the Illustrious base model or compatible selected checkpoints with visible `weight`, `start_at`, and `end_at` controls in the `0..1` range.
- Kept Anima and unknown checkpoints prompt-only, and blocked Story start while a style reference upload or analysis is pending, failed, or invalid.
- Redacted image data URLs before local LLM request/error logging so multimodal style-reference analysis does not write uploaded image bytes to `data/logs`.
- Added `LITELLM_VISION_MODEL` documentation for multimodal Story style reference analysis with fallback to `LITELLM_DEFAULT_MODEL`.

Validation:

- `npm test -- --run src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/story-comfyui-execution.test.ts src/features/agent-timeline/components/StoryPlanningPreview.test.tsx src/features/agent-timeline/story-node-output-summary.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/llm/chat/route.test.ts src/features/llm/llm-local-log.test.ts` passed with 8 files and 123 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.
- `npm test` passed with 122 files and 998 tests.

## 2026-07-04

### Issue #118 Story Detailer Toggles

Summary:

- Added a `/story` input Detailers section with FaceDetailer and HandDetailer enable checkboxes plus fine parameter controls for detector, steps, CFG, sampler/scheduler, bbox, SAM, and wildcard fields.
- Added Story-scoped `settingsSnapshot.detailers` sanitization that falls back to ComfyUI detailer defaults and persists the input Detailers section independently from saved Story Parameters.
- Kept detailer settings independent of `stylePalette` and resource selection so users can configure detailers without selecting a checkpoint, and kept resource, parameter, and render LLM payloads from receiving detailer settings.
- Applied Story detailers to final generation and scoped regeneration request assembly while preserving existing preview-mode detailer disabling.
- Updated generation-gate shot summaries and Story workflow persistence restore behavior for detailer visibility and legacy disabled defaults.

Validation:

- `npm test -- --run src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/components/StoryPlanningPreview.test.tsx src/features/agent-timeline/story-node-output-summary.test.ts src/features/agent-timeline/components/StoryNodeOutputSummaryView.test.tsx src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/story/run-planning/route.test.ts src/app/api/agent-timeline/story/confirm-generation/route.test.ts src/app/api/agent-timeline/story/regenerate-shot/route.test.ts src/features/agent-timeline/story-comfyui-execution.test.ts` passed with 11 files and 168 tests.
- `npm test -- --run src/features/editor/ai-prompt/style-palette-prompts.test.ts` passed with 1 file and 5 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.

### Story Illustrious Trigger Selection

Summary:

- Changed Story Illustrious prompt compilation so selected checkpoint and LoRA `trainedWords` are not automatically injected into final prompts.
- Added per-shot `resourceTriggerSelections` with exact original-trained-word validation, prompt warnings for invalid resource ids or non-member words, and preserved legacy automatic trigger injection for non-Story renderer calls.
- Made Story Illustrious rating tags local to Settings NSFW state: `safe` when disabled and `nsfw` when enabled, ignoring LLM-authored rating sections.
- Replaced Story Illustrious negative prompt assembly with a common Illustrious base only, so shot-specific safety text, names, props, brands, and LLM `negativeAdditions` do not leak into generation negatives.
- Updated Story Visual prompt health and rendering so Illustrious sections satisfy identity/action/setting/camera/lighting checks and short negative prompts use the same prompt block styling as long prompts.
- Tightened Story Illustrious LLM instructions so visible person counts, names, and subject descriptors must be emitted directly as high-quality Danbooru-style tags in `subjectIdentity`; local Story compilation no longer performs semantic string rewriting, filtering, or truncation for malformed count phrases, original character names, or repeated generic prefixes, and the common negative base omits `sketch` so framed-sketch stories are not self-negated.
- Added explicit Story Illustrious LLM constraints for coherent multi-person count tags such as `2girls, 1man`, adult-safe gender tags that avoid `1boy` for adult/college-age subjects, no story names in any section, no contradictory age phrases such as `mature young face`, and no vague group phrases that imply extra people.
- Added a resource-trigger validation guard so exact checkpoint trained words that are rating markers, such as `general`, `sensitive`, `nsfw`, `explicit`, or any `rating:*` value, are ignored with prompt warnings instead of overriding the Settings-derived Story Illustrious rating tag.

Validation:

- `npm test -- --run src/features/editor/ai-prompt/illustrious-prompt.test.ts` passed with 1 file and 8 tests.
- `npm test -- --run src/features/agent-timeline/story-planning.test.ts` passed with 1 file and 39 tests.
- `npm test -- --run src/features/agent-timeline/story-llm-adapters.test.ts` passed with 1 file and 37 tests.
- `npm test -- --run src/features/agent-timeline/story-node-output-summary.test.ts` passed with 1 file and 10 tests.
- `npm test -- --run src/features/agent-timeline/components/StoryNodeOutputSummaryView.test.tsx` passed with 1 file and 3 tests.
- `npm test -- --run src/features/agent-timeline/story-input.test.ts` passed with 1 file and 18 tests.
- `npm test -- --run src/app/api/agent-timeline/story/confirm-generation/route.test.ts` passed with 1 file and 6 tests.
- `npm test -- --run src/app/api/agent-timeline/story/regenerate-shot/route.test.ts` passed with 1 file and 4 tests.
- `npm test` passed with 122 files and 977 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.
- `git diff --check` passed with line-ending warnings only.

### Local Plan Story/Timeline Prompt Profile Cleanup

Summary:

- Removed Generic from the shared Agent Timeline/Story prompt profile set, keeping Illustrious and Anima with Illustrious as the default while preserving the legacy editor `PromptModelFormat` generic path.
- Tightened Civitai resource and AI-recommendation prompt-profile validation so non-empty invalid values, including `generic`, return 400 instead of falling back.
- Added safe persistence/UI restore fallbacks so old invalid Timeline/Story profile values do not crash saved workflow restore or visual scene prompt editing.
- Made Timeline resource filtering strictly profile-compatible for Illustrious and Anima and removed SDXL/generic final-prompt fallback expectations from Timeline prompt assembly.
- Added profile-specific Story render-plan normalization and prompt compilation: Anima keeps `animaPromptParts`, while Illustrious uses `illustriousSections` and the existing Illustrious renderer.
- Updated Story Visual summaries and generation-gate previews to show the active profile and use neutral "Prompt sections" wording.

Validation:

- `npm test -- --run src/features/agent-timeline/t5-node-adapters.test.ts` passed with 1 file and 8 tests.
- `npm test -- --run src/shared/prompt-profile.test.ts src/app/api/civitai-lora-library/resources/route.test.ts src/app/api/civitai-lora-library/ai-recommendation/route.test.ts src/features/agent-timeline/t5-node-adapters.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/components/StoryPlanningPreview.test.tsx src/features/agent-timeline/components/StoryNodeOutputSummaryView.test.tsx` passed with 12 files and 199 tests.
- `npm test` passed with 122 files and 971 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.
- `git diff --check` passed with line-ending warnings only.

## 2026-06-29

### Issue #98 Story Selected Resource Loader Coverage

Summary:

- Added direct route-boundary regression coverage for Story selected checkpoint/LoRA loading from the local Civitai library.
- Loaded explicit selected Story checkpoint/LoRA IDs before ranked Civitai candidate retrieval so manual selections can proceed when embedding/index-backed ranking is unavailable.
- Covered selected resources outside ranked candidates, selected checkpoint fallback when ranked loading fails, no-selection ranked failure propagation, missing selected IDs, wrong selected resource type, and unavailable ComfyUI download status.

Validation:

- `npm test -- src/app/api/agent-timeline/story/run-planning/route.test.ts` passed with 1 file and 11 tests.
- `npm test -- src/app/api/agent-timeline/story/run-planning/route.test.ts src/features/agent-timeline/components/StoryPlanningPreview.test.tsx src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/story-planning.test.ts` passed with 5 files and 115 tests.
- `npm run typecheck` passed.
- Earlier Issue #98 validation: `npm run lint` passed with 23 existing warnings.

## 2026-06-28

### Story Visual Diagnostics Reviewer Fixes

Summary:

- Restored Story Visual prompt diagnostics for render-plan and generation-gate shot cards, including prompt health, removed negative diagnostics, and source-image risk readiness.
- Removed the deprecated `negativeConflicts` summary-card field and the unused `negativePrompt` prompt-health input after structured prompt-health diagnostics replaced string overlap checks.
- Added a selected-node error notice so Story Visual mode shows node failures returned inside a successful planning workflow response.
- Restored the Story resource-planning `desiredEffect` compact length boundary before candidate ranking and LLM payload use.
- Clarified shot dependency risk summaries so planning-only continuity/story-order edges are labeled separately from injected source-image edges.

Validation:

- `npm test -- src/features/agent-timeline/story-node-output-summary.test.ts src/features/agent-timeline/components/StoryNodeOutputSummaryView.test.tsx src/features/agent-timeline/components/StoryPlanningPreview.test.tsx src/features/agent-timeline/story-llm-adapters.test.ts` passed with 4 files and 55 tests.
- `npm test -- src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-node-output-summary.test.ts src/features/agent-timeline/components/StoryNodeOutputSummaryView.test.tsx` passed with 3 files and 27 tests after reviewer cleanup.
- `npm test -- src/features/agent-timeline` passed with 27 files and 256 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.

### T23B / Issue #90 Story Render Plan Anima Prompt Parts

Summary:

- Replaced Story render-plan LLM `promptSections` with per-shot `animaPromptParts`.
- Added deterministic Story Anima prompt compilation with the recommended Anima prefix, Anima-style subject/character/series/artist/general order, caption inclusion, and negative additions merged only into the negative prompt.
- Strengthened render-plan LLM guidance to avoid repeating the same visible object, action, setting, camera, lighting, or style wording across tag arrays and the single-frame caption.
- Tightened Story render LLM guidance so `actionTags` and `singleFrameCaption` describe a frozen single-frame tableau instead of ongoing motion or transition phrases.
- Removed Story start label parsing and event-count estimation from automatic shot count; blank shot count now leaves `Beat 1:` / `Final image:` text in `rawIntent` for the LLM outline step to interpret.
- Fixed Story generation confirmation and scoped regeneration to execute the approved `story-render-plan` prompts instead of rebuilding prompts from upstream storyboard nodes.
- Hardened Anima render prompt parsing for snake_case LLM output and empty prompt-part responses, with storyboard fallback warnings instead of prefix-only prompts.
- Restored Civitai AI prompt instruction and response parser regression coverage.
- Updated Story Visual shot cards to display Anima prompt parts alongside final prompts and prompt health.

Validation:

- `npm test -- src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-llm-adapters.test.ts` passed with 2 files and 42 tests.
- `npm test -- src/app/api/agent-timeline/story/confirm-generation/route.test.ts src/app/api/agent-timeline/story/regenerate-shot/route.test.ts src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/story-planning.test.ts src/features/editor/ai-prompt/civitai-ai-context.test.ts` passed with 5 files and 77 tests.
- `npm test -- src/features/agent-timeline src/app/api/agent-timeline/story` passed with 30 files and 262 tests.
- `npm test -- src/features/civitai-lora-library src/features/editor/ai-prompt/civitai-ai-context.test.ts` passed with 11 files and 52 tests.
- `npm test` passed with 120 files and 928 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.
- tester-agent returned PASS and reviewer-agent returned APPROVE during merge-prep review.

### T23D / Issue #92 Story Visual Output Shot Cards

Summary:

- Redesigned Story render plan, generation gate, shot execution, and result Visual summaries around compact shot cards.
- Added prompt health indicators for missing identity/action/setting/camera/lighting, empty or short tag-list prompts, hardcoded-looking prompt fragments, positive/negative conflicts, removed negative conflicts, and high-risk source-image inheritance.
- Kept Raw JSON as the complete debug/artifact view while Visual hides ComfyUI node ids, queue prompt ids, temporary view URLs, and workflow internals.
- Updated Story execution/result Visual panels to prefer stored image URLs and avoid displaying prompt ids.

Validation:

- `npm test -- src/features/agent-timeline/story-node-output-summary.test.ts src/features/agent-timeline/components/StoryNodeOutputSummaryView.test.tsx` passed with 2 files and 7 tests.
- `npm test -- src/features/agent-timeline/components/StoryPlanningPreview.test.tsx` passed with 1 file and 13 tests.
- `npm test -- src/features/agent-timeline` passed with 27 files and 243 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.

### T23C / Issue #91 Story Source-image Risk Decisions

Summary:

- Added deterministic Story source-image risk metadata for major pose/action, camera, composition, and scene reset transitions.
- Downgraded automatic high-risk `img2img-source` dependency output to planning-only continuity while preserving manual high-risk source edges with warnings.
- Added generation-gate and visual-summary source risk metadata including risk level, reason, factors, and source chain.

Validation:

- `npm test -- --run src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/story-node-output-summary.test.ts` passed with 3 files and 61 tests.
- `npm test -- --run src/features/agent-timeline` passed with 26 files and 240 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.

### T23B / Issue #90 Story Anima Natural Visual Clauses

Summary:

- Updated Story render LLM instructions so Anima sections ask for compact comma-separated English visual clauses instead of 1-6 word tag fragments.
- Strengthened Story Anima prompt guidance for adult/age context, distinct multi-character visible descriptions, wardrobe, pose/action, props, location, camera, and lighting.
- Added deterministic negative-addition conflict filtering and warnings when render-plan negatives undermine positive key props, actions, clothing, or environments.

Validation:

- `npm test -- --run src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/story-planning.test.ts` passed with 2 files and 53 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.

### T23A / Issue #89 Story Graph Output Contracts

Summary:

- Tightened Story result visual summaries so stored image locations or filenames are shown without falling back to ComfyUI temporary view URLs.
- Added regression coverage for compact Story render plans, authoritative `resource-plan` execution assembly, legacy per-shot resource compatibility, and Visual-vs-Raw debug boundaries.
- Documented that Story visual summaries hide ComfyUI node ids, temporary URLs, and workflow internals while Raw JSON remains available.

Validation:

- `npm test -- --run src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/story-node-output-summary.test.ts` passed with 2 files and 32 tests.
- `npm test -- --run src/app/api/agent-timeline/story/confirm-generation/route.test.ts src/app/api/agent-timeline/story/regenerate-shot/route.test.ts` passed with 2 files and 8 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings only.

### Story Graph Code-node Optimization

Summary:

- Added anchor-aware Story render prompt compaction so required shot identity, wardrobe, props, action, environment, camera, and lighting anchors are inserted before optional prompt details and missing-anchor coverage is surfaced as non-blocking warnings.
- Reversed the Shot Dependency Graph LLM/UI behavior so `img2img-source` is used only for executable source-image inheritance while `reference`, `continuity`, `story-order`, and `manual` reasons remain editable and non-executable.
- Removed local content-keyword Story resolution inference; local defaults now use explicit numeric dimensions from the request or selected resource metadata, otherwise the neutral story default, leaving Anima/story aspect choices to the LLM parameter-plan node.
- Expanded resource and parameter planning prompts/payloads with selected resource metadata so the LLM can choose LoRA weights and one story-level resolution from checkpoint/LoRA guidance without local style/type caps.

Validation:

- `npm test -- --run src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/components/StoryPlanningWorkspace.test.tsx` passed with 3 files and 50 tests.
- `npm test -- --run src/features/agent-timeline` passed with 26 files and 224 tests.
- `npm test -- --run src/app/api/agent-timeline/story` passed with 3 files and 11 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings only.

## 2026-06-27

### Story Node Output Slimming

Summary:

- Added compact Story node summaries for all 15 Story workflow nodes and wired `/story` Visual Step output to summary-first rendering with collapsible artifact editing.
- Removed new-workflow persistence of full `settingsSnapshot.resourceCandidates`; Story input now keeps candidate counts while Story planning passes candidates transiently to resource planning.
- Slimmed Story render plans and generation gate previews by replacing per-shot full resource objects with lightweight resource references and replacing full gate prompt/anchor copies with prompt preview text and prompt lengths.
- Kept execution correctness by assembling ComfyUI requests from the authoritative `resource-plan` result, with legacy per-shot render-plan resources still tolerated for old workflow records.

Validation:

- `npm test -- --run src/features/agent-timeline` passed with 26 files and 220 tests.
- `npm test -- --run src/app/api/agent-timeline/story` passed with 3 files and 11 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings only.

### Story Graph Fallback Start Removal

Summary:

- Removed the `/story` `Load fallback` sample start action so Story Graph planning starts only from user-entered or AI-suggested story requests.
- Updated the Story Planning Preview regression coverage and technical spec to match the simplified start surface.

Validation:

- `npm test -- --run src/features/agent-timeline/components/StoryPlanningPreview.test.tsx` passed with 12 tests.

### T21 / Issue #66 Story Source-shot img2img Regression

Summary:

- Verified the Story Graph execution path already rebuilds render plans from `img2img-source` dependency edges and injects source shot results into downstream execution.
- Strengthened confirmation and scoped-regeneration regressions so graph-only `img2img-source` edges, even when storyboard `sourceShotIds` are empty, must reach `StoryExecutionRequest.sourceShotIds` and downstream source results.
- Updated deterministic Story planning copy to describe executable source-shot dependencies now that Story execution exists.

Validation:

- `npm test -- --run src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/story-execution.test.ts src/features/agent-timeline/story-comfyui-execution.test.ts src/app/api/agent-timeline/story/confirm-generation/route.test.ts src/app/api/agent-timeline/story/regenerate-shot/route.test.ts` passed with 6 files and 55 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings only.
- `npm test` passed with 117 files and 894 tests.

### Story Dependency Reason Optimization

Summary:

- Scoped the Story Graph shot dependency node to executable source-image dependencies only, so new LLM output and manual UI edits use `img2img-source` instead of planning-only `reference`, `continuity`, or `story-order` reasons.
- Refined the dependency graph LLM instruction so consecutive shots with the same main character, same location, or continuous action normally produce `img2img-source` edges unless the later shot intentionally resets scene/composition or is prompt-only continuity.
- Set Story source-image execution requests to denoise `0.9` while leaving prompt-only txt2img shots on their planned denoise value.
- Kept legacy non-action reasons parseable for old workflow records while coercing saved Shot Dependency workspace edits to `img2img-source`.
- Updated product and technical specs to document that prompt-only continuity belongs in shot notes, plot state, or character continuity rather than shot dependency edges.

Validation:

- `npm test -- --run src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/components/StoryPlanningWorkspace.test.tsx src/features/agent-timeline/story-workflow.test.ts src/features/agent-timeline/story-state.test.ts` passed with 4 files and 35 tests.
- `npm test -- --run src/features/agent-timeline/story-planning.test.ts` passed with 1 file and 22 tests.
- `npm test -- --run src/app/api/agent-timeline/story/confirm-generation/route.test.ts src/app/api/agent-timeline/story/regenerate-shot/route.test.ts` passed with 2 files and 8 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings only.

## 2026-06-26

### Issue #85 Story Graph Workflow Persistence

Summary:

- Extended the shared `sceneforge-timeline-workflow` record envelope so active and named workflow storage can persist both `single-image` and `story-graph` workflows.
- Added Story Graph restore/autosave support on `/story`, including selected Story node, selected shot id, visual/raw JSON display mode, planning artifacts, generation gate state, shot execution state, preview references, and final references.
- Restored interrupted Story Graph nodes and queued/running shots as visible recoverable errors instead of implying background work continued after reload.
- Filtered saved workflow menus by workflow mode so Run opens `single-image` records and Story opens `story-graph` records.
- Strengthened workflow serialization redaction for secrets, `.env.local` values, generated bytes/data URLs, caches, logs, SQLite/resource database paths, and other runtime artifacts.

Files changed:

- `src/features/agent-timeline/timeline-workflow-persistence.ts`
- `src/features/agent-timeline/timeline-workflow-local-disk.ts`
- `src/features/agent-timeline/components/StoryPlanningPreview.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineWorkflowProjectMenu.tsx`
- `src/app/api/agent-timeline/confirm-generation/route.ts`
- `src/app/api/agent-timeline/workflows/route.ts`
- `README.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/timeline-workflow-persistence.test.ts` passed with 7 tests.
- `npm test -- src/features/agent-timeline/components/StoryPlanningPreview.test.tsx` passed with 10 tests.
- `npm test -- src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/timeline-workflow-local-disk.test.ts src/features/agent-timeline/components/StoryPlanningPreview.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/components/TimelineWorkflowProjectMenu.test.tsx src/app/api/agent-timeline/active-workflow/route.test.ts src/app/api/agent-timeline/workflows/route.test.ts src/app/api/agent-timeline/workflows/item/route.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts` passed with 9 files and 83 tests.
- `npm test` passed with 117 files and 891 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings.
- `npm run build` passed.

## 2026-06-20

### Issue #66 Confirm Generation Trust Boundary Follow-up

Summary:

- Fixed Story Graph confirmation so submitted `shot-graph-execution.result` is not reused as initial execution state.
- Kept scoped shot regeneration explicitly dependent on submitted prior execution state so unchanged upstream source results remain available during reruns.

Files changed:

- `src/features/agent-timeline/story-api.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-comfyui-execution.test.ts src/app/api/agent-timeline/story/regenerate-shot/route.test.ts src/app/api/agent-timeline/story/confirm-generation/route.test.ts` passed with 3 files and 17 tests.
- `npm test -- --run src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/story-execution.test.ts src/features/agent-timeline/story-comfyui-execution.test.ts src/app/api/agent-timeline/story` passed with 7 files and 48 tests.
- `npm run typecheck` passed.

### Issue #66 Second Reviewer Blocking Follow-up

Summary:

- Hardened Story ComfyUI source shot image handling so submitted `resultReference` URLs are not trusted during downstream shot execution.
- Rebuilt source ComfyUI image fetches from sanitized `filename`, `subfolder`, and `type`; local generated-image fallback now uses validated storage filenames instead of remote URLs.
- Restricted the default ComfyUI image fetcher to the configured ComfyUI `/view` endpoint before attaching the ComfyUI auth header.
- Fixed preview/no-source execution so object-info validation and queueing use the preview-transformed request.

Files changed:

- `src/features/agent-timeline/story-comfyui-execution.ts`
- `src/features/agent-timeline/story-comfyui-execution.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-comfyui-execution.test.ts src/app/api/agent-timeline/story/regenerate-shot/route.test.ts src/app/api/agent-timeline/story/confirm-generation/route.test.ts` passed with 3 files and 15 tests.
- `npm test -- --run src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/story-execution.test.ts src/features/agent-timeline/story-comfyui-execution.test.ts src/app/api/agent-timeline/story` passed with 7 files and 46 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

## 2026-06-15

### Issue #66 Reviewer Blocking Follow-up

Summary:

- Fixed Story Graph source shot execution semantics so the Story ComfyUI adapter uploads completed source shot images and injects them into downstream ComfyUI requests.
- Uses the first source shot as the img2img `imageName`; additional source shots are appended as IPAdapter character references so multi-source dependencies carry image data instead of only affecting schedule order.
- Hardened Story parameter normalization so LLM/manual per-shot override strings are coerced before render planning and invalid numeric overrides fall back to defaults instead of reaching `.toFixed()`.
- Removed unrelated `next.config.ts` dev-origin drift from the scoped diff.

Files changed:

- `src/features/agent-timeline/story-comfyui-execution.ts`
- `src/features/agent-timeline/story-comfyui-execution.test.ts`
- `src/features/agent-timeline/story-planning.ts`
- `src/features/agent-timeline/story-planning.test.ts`
- `src/features/agent-timeline/story-llm-adapters.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-llm-adapters.test.ts src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/story-execution.test.ts src/features/agent-timeline/story-comfyui-execution.test.ts src/app/api/agent-timeline/story` passed with 7 files and 44 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

### Story Graph Full Real Flow

Summary:

- Added server-side Story Graph planning through `POST /api/agent-timeline/story/run-planning`, with LiteLLM-backed Story node adapters for bible, outline, storyboard shots, safety, dependency, plot, continuity, resource, and parameter planning.
- Kept system-owned Story render plan, consistency check, and generation gate assembly deterministic; hard validation now blocks unknown shot dependencies, dependency cycles, render/source mismatch, and non-executable resource plans.
- Added Story Graph generation APIs for confirmation and scoped shot regeneration; both use the existing Story shot scheduler plus the ComfyUI execution adapter and preserve unrelated shot result references during reruns.
- Updated `/story` to call server planning, expose generation after a ready gate, display shot execution/result state, and trigger per-shot regeneration.
- Removed the old client-side deterministic mock path from the main start flow; the old planning fallback checkpoint is rejected by the executable gate instead of being accepted as a real model.
- Follow-up: `/story` now loads real downloaded local Civitai checkpoint and LoRA candidates before planning and blocks with a clear UI error when no downloaded checkpoint is available.
- Follow-up: Story generation and shot regeneration recompute the render plan server-side from the validated current workflow so tampered submitted `story-render-plan` resources cannot execute.

Files changed:

- `src/app/api/agent-timeline/story/run-planning/route.ts`
- `src/app/api/agent-timeline/story/confirm-generation/route.ts`
- `src/app/api/agent-timeline/story/regenerate-shot/route.ts`
- `src/features/agent-timeline/story-api.ts`
- `src/features/agent-timeline/story-llm-adapters.ts`
- `src/features/agent-timeline/story-runner.ts`
- `src/features/agent-timeline/story-state.ts`
- `src/features/agent-timeline/story-execution.ts`
- `src/features/agent-timeline/components/StoryPlanningPreview.tsx`
- Focused Story adapter, route, scheduler, and UI tests under `src/features/agent-timeline` and `src/app/api/agent-timeline/story`.

Validation:

- `npm test -- --run src/features/agent-timeline/story-llm-adapters.test.ts` passed with 6 tests.
- `npm test -- --run src/app/api/agent-timeline/story` passed with 3 files and 7 tests.
- `npm test -- --run src/features/agent-timeline/components/StoryPlanningPreview.test.tsx` passed with 5 tests.
- `npm test -- --run src/features/agent-timeline` passed with 25 files and 165 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.
- Follow-up validation: `npm test -- --run src/features/agent-timeline/components/StoryPlanningPreview.test.tsx` passed with 6 tests.
- Follow-up validation: `npm test -- --run src/app/api/agent-timeline/story` passed with 3 files and 9 tests.
- Follow-up validation: `npm test -- --run src/features/agent-timeline` passed with 25 files and 166 tests.
- Follow-up validation: `npm run typecheck` passed.

## 2026-06-14

### T21 / Issue #66 Shot Graph Execution Scheduler

Summary:

- Added a Story Graph shot execution scheduler with per-shot status, queue metadata, result references, and recoverable error state.
- Scheduled `StoryExecutionRequestBatch` inputs topologically so independent shots are ready together, source/img2img shots wait for source results, and multi-reference shots wait for all referenced sources.
- Added an injected shot execution adapter boundary that can wrap existing ComfyUI validation, queue, history, and generated image storage helpers without hard-wiring live network calls into scheduler tests.
- Added selected-shot regeneration that marks only the selected shot and downstream dependent shots stale while preserving unrelated branch result references.
- Replaced the old T21-unavailable Story Graph execution placeholder with confirmation-gated scheduler state.
- Added a server-side Story Graph ComfyUI execution adapter that reuses existing text-to-image validation, `object_info` compatibility checks, queueing, history polling, view reads, and generated-image storage helpers behind the scheduler adapter boundary.

Files changed:

- `src/features/agent-timeline/story-execution.ts`
- `src/features/agent-timeline/story-execution.test.ts`
- `src/features/agent-timeline/story-comfyui-execution.ts`
- `src/features/agent-timeline/story-comfyui-execution.test.ts`
- `src/features/agent-timeline/story-input.ts`
- `src/features/agent-timeline/story-input.test.ts`
- `src/features/agent-timeline/story-state.ts`
- `src/features/agent-timeline/story-types.ts`
- `src/features/agent-timeline/story-workflow.test.ts`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-state.test.ts src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-comfyui-execution.test.ts src/features/agent-timeline/story-execution.test.ts` passed with 4 files and 22 tests after the confirmation-gate stale regression fix and ComfyUI adapter coverage.
- `npm test -- --run src/features/agent-timeline` passed with 24 files and 158 tests.
- `npm test` passed with 113 files and 823 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.
- `npm run build` passed.

### T20A / Issue #77 Story Graph Input and Planning Start Workflow

Summary:

- Added a typed Story Graph start action that normalizes user story input, target shot count, audience rating, NSFW context, and a settings snapshot into `StoryInput`.
- Assembled deterministic, inspectable planning artifacts for Story Graph nodes from user-started input, including story bible, outline, storyboard shots, safety, dependency, plot, continuity, resource, parameter, render, consistency, gate, execution, and result placeholders.
- Updated `/story` so the primary path starts from user input; static sample content is now only a fallback start action.
- Reserved shot execution and result nodes until T21 so the generation gate can show a render/request preview without making shot execution runnable.
- Follow-up: simplified the start surface to only story request and optional shots, derived audience rating from the Settings NSFW switch, removed user-entered title/content warning/NSFW fields, and added story request Suggest/Rewrite through the existing LiteLLM chat boundary.

Files changed:

- `src/features/agent-timeline/story-input.ts`
- `src/features/agent-timeline/story-input.test.ts`
- `src/features/agent-timeline/story-types.ts`
- `src/features/agent-timeline/story-workflow.test.ts`
- `src/features/agent-timeline/components/StoryPlanningPreview.tsx`
- `src/features/agent-timeline/components/StoryPlanningPreview.test.tsx`
- `src/features/agent-timeline/index.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-workflow.test.ts src/features/agent-timeline/story-state.test.ts src/features/agent-timeline/components/StoryPlanningPreview.test.tsx src/features/agent-timeline/components/StoryPlanningWorkspace.test.tsx` passed with 5 files and 20 tests.
- `npm test -- --run src/features/agent-timeline` passed with 22 files and 140 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

### T20 / Issue #65 Story Graph Resource, Parameter, Render, Preview, and NSFW Planning

Summary:

- Added deterministic Story Graph planning helpers for local-only resource plans, formal generation parameter plans, separate preview execution options/results, story render-plan assembly, and execution request batches.
- Reused shared local resource validation so story resource planning selects only validated local candidates and strips model NSFW marker fields from outputs.
- Kept NSFW as content/execution context from the story safety plan at render, generation gate, result, and execution request boundaries instead of using model tags as filters.
- Updated the inactive `/story` planning preview with typed resource, parameter, render, gate, and result sample artifacts.

Files changed:

- `src/features/agent-timeline/story-planning.ts`
- `src/features/agent-timeline/story-planning.test.ts`
- `src/features/agent-timeline/story-types.ts`
- `src/features/agent-timeline/components/StoryPlanningPreview.tsx`
- `src/features/agent-timeline/index.ts`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-planning.test.ts` passed with 5 tests.
- `npm test -- --run src/features/agent-timeline` passed with 20 files and 135 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

### T19 / Issue #64 Story Graph Planning Workspaces

Summary:

- Added Story Graph runtime mutation helpers for story-scoped and shot-scoped manual edits.
- Reused shared workflow stale propagation for Story Graph DAG nodes and recorded downstream shot ids for shot dependency graph edits.
- Added story-facing planning workspaces for storyboard shots, story safety, shot dependency graph, plot-state graph, character continuity, and story-scoped shared JSON nodes.
- Mounted the inactive `/story` planning preview with the same three-column detailed workbench layout style used by the Run route's detailed display mode.
- Kept Story Graph planning code independent of the old editor sequence implementation and did not activate story execution or persistence.

Files changed:

- `src/features/agent-timeline/story-state.ts`
- `src/features/agent-timeline/story-state.test.ts`
- `src/features/agent-timeline/components/StoryPlanningPreview.tsx`
- `src/features/agent-timeline/components/StoryPlanningWorkspace.tsx`
- `src/features/agent-timeline/components/StoryPlanningWorkspace.test.tsx`
- `src/features/agent-timeline/components/index.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/app/story/page.tsx`
- `README.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-workflow.test.ts src/features/agent-timeline/story-state.test.ts src/features/agent-timeline/components/StoryPlanningWorkspace.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 4 files and 45 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.
- `npm run build` passed and generated the `/story` static route.

### T18 / Issue #63 Story Graph Domain Models and DAG

Summary:

- Added typed Story Graph planning artifacts for story input, story bible, outline, storyboard shots, story safety, shot dependencies, plot state, character continuity, and consistency checks.
- Added an inactive Story Graph workflow definition using the shared T16/T17 workflow primitives and the scoped story DAG nodes from Issue #63.
- Added validation for the story workflow DAG, required predecessors, shot dependency cycles, and invalid source shot references.
- Kept the active timeline runtime selector on the existing single-image workflow so story mode remains unreachable until later UI/execution tracks wire it.

Files changed:

- `src/features/agent-timeline/story-types.ts`
- `src/features/agent-timeline/story-workflow.ts`
- `src/features/agent-timeline/story-workflow.test.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/workflow-definitions.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-workflow.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/workflow-definition.test.ts` passed with 3 files and 23 tests.
- `npm test -- --run src/features/agent-timeline` passed with 17 files and 122 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

### T17 / Issue #62 Definition-Driven Single-Image Timeline

Summary:

- Moved the single-image timeline DAG edges into `TimelineWorkflowDefinition` and made the legacy timeline DAG helpers delegate to common workflow-definition utilities.
- Added `workflowMode` to timeline workflow state, defaulted new workflows to `single-image`, and restored legacy persisted workflow records without a mode as `single-image`.
- Drove timeline readiness, `canRun`, stale downstream propagation, LangGraph node/edge registration, and adapter lookup from the single-image workflow definition.
- Routed React timeline step iteration, labels, AI/manual affordance labels, and visual workspace selection through definition metadata while preserving current single-image UI behavior.
- Sanitized confirm-generation API payloads through workflow persistence restore logic before enforcing the generation gate.

Files changed:

- `src/app/api/agent-timeline/confirm-generation/route.ts`
- `src/features/agent-timeline/components/TimelineEditorWorkspace.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/timeline-node-content.ts`
- `src/features/agent-timeline/dag.ts`
- `src/features/agent-timeline/graph.ts`
- `src/features/agent-timeline/state.ts`
- `src/features/agent-timeline/timeline-workflow-persistence.ts`
- `src/features/agent-timeline/types.ts`
- `src/features/agent-timeline/workflow-definition.ts`
- `src/features/agent-timeline/workflow-definitions.ts`
- `src/features/agent-timeline/timeline-workflow-persistence.test.ts`
- `src/features/agent-timeline/workflow-definition.test.ts`
- `src/features/agent-timeline/workflow.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline src/app/api/agent-timeline` passed with 20 files and 137 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

### T16 / Issue #61 Shared Workflow Definitions and Node Primitives

Summary:

- Added reusable workflow primitives for definition version, workflow mode, node metadata, dependency DAGs, readiness, manual edit stale propagation, raw JSON display, workspace routing, AI retry affordances, and adapter result normalization.
- Added adapter artifact scopes for current workflow-scoped single artifacts and future story-scoped or shot-scoped artifacts.
- Extracted a single-image workflow definition data object without migrating current LangGraph registration or changing single-image runtime behavior.
- Extracted shared local resource-plan validation and routed timeline resource recommendation through it.
- Kept common resource-plan behavior independent of model NSFW markers and stripped known NSFW marker fields from shared resource-plan outputs.

Files changed:

- `src/features/agent-timeline/workflow-definition.ts`
- `src/features/agent-timeline/workflow-definitions.ts`
- `src/features/agent-timeline/resource-plan.ts`
- `src/features/agent-timeline/t7-node-adapters.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/workflow-definition.test.ts`
- `src/features/agent-timeline/resource-plan.test.ts`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline` passed with 16 files and 114 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

## 2026-06-13

### T15 / Issue #57 sqlite-vec Civitai Recommendation Index

Summary:

- Added a sqlite-vec derived embedding index for local Civitai `model` and `lora` resources, with metadata tracking for embedding model, dimensions, indexed time, and indexed chunk count.
- Added deterministic source-text fingerprint metadata so request-time readiness detects stale embeddings when FTS `search_text` changes without a resource count change.
- Split per-resource embedding input text into overlapping chunks before LiteLLM requests so long Civitai descriptions do not exceed embedding model input limits; recommendation ranking uses each resource's nearest chunk distance.
- Added chunked embedding schema/chunking metadata and vector-table column validation so legacy single-vector embedding indexes are treated as missing until rebuilt.
- Added `npm run civitai:reindex-embeddings` to rebuild only the derived embedding index after the FTS index exists and is current.
- Added LiteLLM `/v1/embeddings` support for `LITELLM_CIVITAI_EMBEDDING_MODEL`.
- Updated Civitai recommendation candidate loading to require the FTS index and embedding index/config, rank BM25 and embedding retrieval independently, merge with fixed Reciprocal Rank Fusion, and preserve downloaded-resource, prompt-profile, Anima, limit, and LLM validation gates.

Files changed:

- `src/features/llm/litellm-client.ts`
- `src/features/llm/types.ts`
- `src/features/persistence/civitai-embedding-index.ts`
- `src/features/persistence/sqlite-storage.ts`
- `src/features/civitai-lora-library/ai-recommendation.ts`
- `src/features/civitai-lora-library/ai-recommendation.test.ts`
- `src/app/api/civitai-lora-library/ai-recommendation/route.test.ts`
- `scripts/rebuild-civitai-embedding-index.mjs`
- `package.json`
- `README.md`
- `.env.example`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`

Validation:

- `npm run typecheck` passed.
- `npm test -- --run src/features/civitai-lora-library/ai-recommendation.test.ts src/app/api/civitai-lora-library/ai-recommendation/route.test.ts src/features/persistence/sqlite-storage.test.ts` passed with 21 tests.
- Follow-up stale-source validation: `npm test -- --run src/app/api/civitai-lora-library/ai-recommendation/route.test.ts src/features/persistence/sqlite-storage.test.ts` passed with 17 tests; `npm run typecheck` passed.
- Follow-up long embedding input validation: `npm test -- --run src/features/persistence/civitai-embedding-index.test.ts` passed with 5 tests; `npm run typecheck` passed.
- `npm run lint` passed with existing unrelated warnings.
- `npm run build` passed.
- `npm test` passed with 102 files and 755 tests.

### T14 / Issue #55 Simple and Detailed Run Display Modes

Summary:

- Added a persisted global workflow display mode setting with `simple` and `detailed` options, defaulting missing or legacy settings to `simple`.
- Added the Settings page Run display mode selector and restored auto-review behavior so enabled workflows automatically confirm and render at the ComfyUI generation gate.
- Added simple Run mode with the existing command composer controls, compact progress state, generation confirmation or auto-review rendering, and result display while preserving the detailed timeline workbench.
- Reused active timeline workflow autosave for both display modes without adding a second workflow persistence model.

Files changed:

- `src/features/settings/types.ts`
- `src/features/settings/central-settings.ts`
- `src/features/persistence/sqlite-storage.ts`
- `src/app/settings/page.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- Focused tests for settings, SQLite settings persistence, Settings UI, and TimelineShell.

Validation:

- Focused settings and TimelineShell Vitest runs passed, including manual confirmation and auto-review generation-gate coverage.
- `npm test` passed with 102 files and 752 tests.
- `npm run lint` passed with existing unrelated warnings.
- `npm run typecheck` passed.
- `npm run build` passed.

### T13 / Issue #53 Civitai BM25 Recommendation Ranking

Summary:

- Added a rebuildable SQLite FTS5 derived index for local Civitai `model` and `lora` resources, with Unicode-safe search text expansion for Latin tokens, CJK word segmentation, CJK 2-3 grams, and Civitai/domain synonyms.
- Added `npm run civitai:reindex` to rebuild only the derived FTS index from `SCENEFORGE_SQLITE_FILE` or `data/sceneforge.sqlite`.
- Updated Civitai recommendation candidate loading to require the FTS index and use SQLite `bm25()` ranking after downloaded-resource filtering and before the existing LLM selection step.
- Preserved API request/response shape, prompt profile filtering, base model compatibility checks, candidate limits, private-field redaction, and final LLM validation.

Files changed:

- `src/features/persistence/civitai-search-index.ts`
- `src/features/civitai-lora-library/ai-recommendation.ts`
- `src/features/persistence/sqlite-storage.test.ts`
- `src/app/api/civitai-lora-library/ai-recommendation/route.test.ts`
- `scripts/rebuild-civitai-search-index.mjs`
- `package.json`
- `README.md`
- `.env.example`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/persistence/sqlite-storage.test.ts src/features/civitai-lora-library/ai-recommendation.test.ts src/app/api/civitai-lora-library/ai-recommendation/route.test.ts` passed with 17 tests.
- `npm run civitai:reindex` passed against `data/sceneforge.sqlite` and indexed 93 resources.
- `npm run typecheck` passed.
- `npm run lint` passed with existing unrelated warnings.
- `npm test` passed with 748 tests.
- Review follow-up: `npm test -- --run src/features/persistence/sqlite-storage.test.ts src/app/api/civitai-lora-library/ai-recommendation/route.test.ts` passed with 13 tests after readable Chinese synonym regression coverage; `npm run civitai:reindex` passed again against `data/sceneforge.sqlite`.
- Review follow-up: `scripts/rebuild-civitai-search-index.mjs` now loads `SCENEFORGE_SQLITE_FILE` from `.env.local` or `.env` without overriding a shell-provided value, and README / `.env.example` document that Civitai imports or metadata changes require manual reindexing.
- Review follow-up validation: `npm run civitai:reindex` passed against `data/sceneforge.sqlite` with 93 indexed resources; `npm test -- --run src/features/persistence/sqlite-storage.test.ts src/app/api/civitai-lora-library/ai-recommendation/route.test.ts` passed with 14 tests; `npm run typecheck` passed.

## 2026-06-05

### T11 / Issue #49 Named Timeline Workflow Project Management

Summary:

- Added optional timeline workflow project metadata for named records while preserving T10 active autosave record compatibility.
- Added local disk storage and API routes for named timeline workflow list, save, open, rename, and delete operations under `data/timeline-workflows/`.
- Added a Run-header timeline workflow project menu for saving unnamed drafts, updating/opening/renaming saved workflows, refreshing the list, and deleting saved records.
- Preserved active autosave behavior: named workflows remain explicit-save records, while active workflow autosave continues to track the current in-memory workflow and its current named/unnamed status.

Files changed:

- `src/features/agent-timeline/timeline-workflow-persistence.ts`
- `src/features/agent-timeline/timeline-workflow-persistence.test.ts`
- `src/features/agent-timeline/timeline-workflow-local-disk.ts`
- `src/features/agent-timeline/timeline-workflow-local-disk.test.ts`
- `src/features/agent-timeline/timeline-workflow-storage.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/components/TimelineWorkflowProjectMenu.tsx`
- `src/features/agent-timeline/components/index.ts`
- `src/app/api/agent-timeline/workflows/route.ts`
- `src/app/api/agent-timeline/workflows/route.test.ts`
- `src/app/api/agent-timeline/workflows/item/route.ts`
- `src/app/api/agent-timeline/workflows/item/route.test.ts`
- `README.md`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/components/TimelineWorkflowProjectMenu.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/timeline-workflow-local-disk.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/workflows/route.test.ts src/app/api/agent-timeline/workflows/item/route.test.ts` passed with 52 tests.
- `npm test` passed with 738 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings in unrelated files.
- `npm run build` passed and listed `/api/agent-timeline/workflows` and `/api/agent-timeline/workflows/item` as dynamic routes.
- After reviewer follow-up fixes, `npm test -- src/features/agent-timeline/components/TimelineWorkflowProjectMenu.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 30 tests; `npm run lint`, `npm run typecheck`, and `npm run build` passed again.

### T10 / Issue #47 Active Timeline Workflow Persistence

Summary:

- Reviewed the active timeline workflow persistence implementation for Issue #47.
- Added a stale-autosave reconciliation guard so `New scene` cannot leave an old active workflow record behind when an earlier autosave finishes after the clear request.
- Added regression coverage for late autosave completion after clearing the active timeline workflow.

Files changed:

- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 24 tests.
- `npx vitest run src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/timeline-workflow-local-disk.test.ts src/app/api/agent-timeline/active-workflow/route.test.ts` passed with 38 tests after race-condition and API-error regression coverage.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings in unrelated files.

## 2026-06-02

### T9 / Issue #42 Resource-Aware Final Prompt Formatting

Summary:

- Added timeline final positive prompt assembly inside the parameter recommendation path after local checkpoint and LoRA resources are selected.
- Reused Anima and Illustrious prompt renderers, added Pony score-tag formatting, and kept SDXL/generic fallback focused on the semantic prompt plus selected local LoRA trained words.
- Inserted selected LoRA trained words from local metadata into the final prompt with de-duping, while allowing selected LoRAs without trained words to remain valid.
- Tightened resource recommendation validation so unavailable checkpoint or LoRA recommendations fail the node instead of completing; only exact ID or unambiguous local name/model-file matches are mapped.
- Ensured the parameter recommendation request preview carries the final formatted prompt consumed by the generation gate and confirmed ComfyUI request.
- Follow-up: preserved ComfyUI `object_info` mismatch details in the step 9 node error message so missing checkpoints, LoRAs, samplers, or nodes are visible to the user.
- Follow-up: prevented timeline-assembled Anima prompts from being formatted a second time inside shared ComfyUI generation settings.
- Follow-up: included nested API error detail messages in timeline notices for non-OK confirmation responses.
- Follow-up: added explicit timeline prompt/base-model profile selection for Illustrious, Anima, and Generic; defaulted missing selections to Illustrious; made scene prompt generation, local Civitai candidate filtering, and final prompt assembly profile-aware.

Files changed:

- `src/features/agent-timeline/t7-node-adapters.ts`
- `src/features/agent-timeline/t7-node-adapters.test.ts`
- `src/features/agent-timeline/t8-server-adapters.ts`
- `src/features/agent-timeline/t8-server-adapters.test.ts`
- `src/app/api/agent-timeline/confirm-generation/route.test.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/components/TimelineScenePromptWorkspace.tsx`
- `src/features/agent-timeline/t5-node-adapters.ts`
- `src/features/agent-timeline/t5-node-adapters.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.ts`
- `src/features/civitai-lora-library/ai-recommendation.ts`
- `src/features/civitai-lora-library/ai-recommendation.test.ts`
- `src/app/api/civitai-lora-library/ai-recommendation/route.ts`
- `src/app/api/civitai-lora-library/ai-recommendation/route.test.ts`
- `src/shared/prompt-profile.ts`
- `src/features/agent-timeline/types.ts`
- `docs/plan.md`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/t7-node-adapters.test.ts` passed with 13 tests.
- `npm test -- src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/components/TimelineRecommendationWorkspaces.test.tsx` passed with 18 tests.
- Follow-up: `npm test -- src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts` passed with 19 tests.
- Follow-up: `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 12 tests.
- Follow-up: `npm test -- src/app/api/agent-timeline/confirm-generation/route.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/editor/ai-prompt/comfyui-generation-params.test.ts` passed with 44 tests.
- Follow-up: `npm test -- --run src/features/agent-timeline/t5-node-adapters.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/app/api/civitai-lora-library/ai-recommendation/route.test.ts src/features/civitai-lora-library/ai-recommendation.test.ts` passed with 39 tests.
- Follow-up: `npm test` passed with 669 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings in unrelated editor components.
- Follow-up: `npm run build` passed.

### T8 / Issue #40 Confirmed ComfyUI Execution Timeline

Summary:

- Converted the ComfyUI execution and result-display timeline nodes from reserved placeholders into post-confirmation executable graph nodes.
- Kept the generation gate blocking before explicit confirmation and guarded confirmed request conversion so ComfyUI requests are not constructed by T8 adapters before confirmation.
- Added a thin confirmation API route that confirms eligible timeline state, runs LangGraph with server-side T8 adapters, validates against ComfyUI `object_info`, queues the existing text-to-image workflow, polls for one image, and stores the returned image as standalone timeline result state.
- Updated the timeline shell with a `Confirm and render` gate action, queue/result status copy, and visual result display without appending to project generated-image history.

Files changed:

- `src/app/api/agent-timeline/confirm-generation/route.ts`
- `src/features/agent-timeline/graph.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/t8-node-adapters.ts`
- `src/features/agent-timeline/t8-node-adapters.test.ts`
- `src/features/agent-timeline/t8-server-adapters.ts`
- `src/features/agent-timeline/types.ts`
- `src/features/agent-timeline/workflow.test.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/components/timeline-node-content.ts`

Validation:

- `npm test -- src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 29 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `<img>` warnings in unrelated editor components.
- `npm run build` passed and listed `/api/agent-timeline/confirm-generation` as a dynamic route.

## 2026-06-01

### T7 / Issue #38 Timeline Resource and Parameter Recommendations

Summary:

- Activated the timeline resource recommendation and parameter recommendation nodes before the generation gate.
- Added T7 adapters that validate AI checkpoint picks against local Civitai candidates, filter unavailable, duplicate, and incompatible LoRAs, and keep ComfyUI execution blocked for T8.
- Added parameter recommendation output with ComfyUI request previews built from the existing generation settings helpers and sampler options.
- Kept automatic and manual sampler/scheduler selections constrained to the live ComfyUI option set used by the timeline run.
- Added visual workspaces for manual checkpoint, LoRA, and render parameter review before future generation execution.

Files changed:

- `docs/plan.md`
- `src/features/agent-timeline/types.ts`
- `src/features/agent-timeline/t7-node-adapters.ts`
- `src/features/agent-timeline/t7-node-adapters.test.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineResourceRecommendationWorkspace.tsx`
- `src/features/agent-timeline/components/TimelineParameterRecommendationWorkspace.tsx`
- `src/features/agent-timeline/components/TimelineRecommendationWorkspaces.test.tsx`
- `src/features/agent-timeline/components/timeline-node-content.ts`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/workflow.test.ts`
- `src/features/agent-timeline/t5-node-adapters.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/components/TimelineRecommendationWorkspaces.test.tsx` passed with 29 tests.
- `npm test` passed with 646 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `<img>` warnings.
- Browser smoke loaded `http://localhost:3000/`, confirmed the timeline shell shows 10 steps including Model resources and Render prompt, with no browser console errors.

### T6 / Issue #36 Centralized Settings Page

Summary:

- Replaced the `/settings` placeholder with a centralized settings workspace for NSFW status, read-only storage paths, editable Civitai resource paths, and redacted integration status.
- Added server-side `/api/settings` status/update handling so the client does not read environment variables or server-only path helpers.
- Added Civitai resource path validation before SQLite persistence and kept secret-backed integration values redacted.
- Changed the Civitai library panel to link to centralized settings as the primary path editing surface.

Files changed:

- `src/app/settings/page.tsx`
- `src/app/settings/page.test.tsx`
- `src/app/api/settings/route.ts`
- `src/app/api/settings/route.test.ts`
- `src/app/api/civitai-lora-library/settings/route.ts`
- `src/features/settings/`
- `src/features/civitai-lora-library/settings.ts`
- `src/features/civitai-lora-library/settings.test.ts`
- `src/features/comfyui/generated-image-storage.ts`
- `src/features/comfyui/sequence-reference-storage.ts`
- `src/features/editor/components/CivitaiLoraLibraryPanel.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/app/api/settings/route.test.ts src/app/settings/page.test.tsx src/features/civitai-lora-library/settings.test.ts src/features/settings/central-settings.test.ts` passed with 12 tests.
- `npm test` passed with 637 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `<img>` warnings.
- `npm run build` passed.
- `git diff --check` passed with line-ending warnings only.
- Browser verification loaded `/settings`, confirmed General, Storage Paths, Civitai Resource Paths, Integration Status, and invalid-path field errors with no console errors.

### T-AN6 / Issue #33 Anima Natural Prompt Clauses

Summary:

- Strengthened Anima AI prompt instructions to prefer descriptive English visual phrases and short clauses over bare tag-only output.
- Kept Anima output comma-separated and prompt-like while explicitly requesting visible action, expression, scene, lighting, atmosphere, camera/framing, composition, foreground/background relationships, and motion details.
- Added Anima multi-person guidance requiring distinct hairstyle and distinct pose/action per visible person.
- Aligned Anima Comic Sequence storyboard prompt instructions with the same natural visual clause style.
- Preserved non-Anima Illustrious/default prompt instructions, Anima safety defaults, and artist formatting behavior.

Files changed:

- `src/features/editor/ai-prompt/anima-prompt.ts`
- `src/features/editor/ai-prompt/anima-prompt.test.ts`
- `src/features/editor/ai-prompt/comic-sequence-storyboard.ts`
- `src/features/editor/ai-prompt/comic-sequence-storyboard.test.ts`
- `src/features/editor/components/PromptPreviewPanel.tsx`
- `src/features/editor/components/PromptPreviewPanel.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/ai-prompt/anima-prompt.test.ts src/features/editor/components/PromptPreviewPanel.test.tsx src/features/editor/ai-prompt/comic-sequence-storyboard.test.ts` passed with 28 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `<img>` warnings.

### T-AN5 / Issue #31 Anima Prompt Formatting

Summary:

- Added a reusable Anima prompt renderer for `/editor` that activates from Anima workflow profile or base model metadata.
- Ordered Anima positive prompts as quality/meta/year/safety, subject count, character, series/source, artist, and general tags, with case-insensitive dedupe after ordering.
- Routed Anima formatting through prompt preview, AI prompt response rendering, ComfyUI generation settings, Comic Sequence shots, and previous-shot img2img/inpaint requests.
- Split LLM prompt instructions by prompt profile so Anima AI responses use compact anime-style natural-language visual phrases while Illustrious/default responses keep booru-style tag instructions.
- Split Comic Sequence storyboard shot prompts by prompt profile so Anima storyboards use compact anime-style natural-language visual phrases while default storyboards keep booru-style shot tags.
- Synced the Style Palette Artist String render mode with Anima context so Anima checkpoints only show the `@artist` dropdown format and automatically use it in selected cards, active prompt, and saved project settings.
- Added Anima safety behavior: default `safe` is included only when NSFW is disabled, while explicit safety/rating tags are preserved.
- Converted compatible selected Artist String tags into Anima `@artist` syntax when they land in the artist section.
- Kept non-Anima Illustrious/default prompt ordering and negative prompt behavior unchanged.

Files changed:

- `src/features/editor/ai-prompt/anima-prompt.ts`
- `src/features/editor/ai-prompt/anima-prompt.test.ts`
- `src/features/editor/ai-prompt/comic-sequence-storyboard.ts`
- `src/features/editor/ai-prompt/comic-sequence-storyboard.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.test.ts`
- `src/features/artist-string-library/novelai-artist-string.ts`
- `src/features/artist-string-library/novelai-artist-string.test.ts`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/components/PromptPreviewPanel.tsx`
- `src/features/editor/components/PromptPreviewPanel.test.tsx`
- `src/features/editor/components/StylePalettePanel.tsx`
- `src/features/editor/components/StylePalettePanel.test.tsx`
- `src/features/persistence/project-serialization.ts`
- `src/features/persistence/project-serialization.test.ts`
- `src/shared/types/project.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/ai-prompt/anima-prompt.test.ts src/features/editor/ai-prompt/illustrious-prompt.test.ts src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/editor/components/PromptPreviewPanel.test.tsx` passed with 37 tests.
- `npm test -- src/features/artist-string-library/novelai-artist-string.test.ts src/features/editor/components/StylePalettePanel.test.tsx src/features/persistence/project-serialization.test.ts` passed with 69 tests.
- `npm test` passed: 84 files, 622 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.

### T-AN4 / Issue #29 Anima Add-ons

Summary:

- Reused the shared text-to-image add-on graph for Anima so ControlNet, IPAdapter character references, Face Detailer, and Hand Detailer consume the Anima `UNETLoader`, `CLIPLoader`, and `VAELoader` context instead of `CheckpointLoaderSimple`.
- Kept Anima txt2img on `EmptyLatentImage` while preserving the resolved Anima profile metadata in workflow requests.
- Removed the Anima pre-queue blockers for supported add-ons and replaced them with object_info validation for missing ControlNet, IPAdapter, Face Detailer, Hand Detailer, detector model, and model file resources.
- Enabled Anima inpaint and high-res inpaint detailers through the existing shared inpaint model/CLIP/VAE context.

Files changed:

- `src/app/api/comfyui/generate-image/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.test.ts`
- `src/features/comfyui/object-info.ts`
- `src/features/comfyui/object-info.test.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/workflow.ts`
- `src/features/comfyui/workflow.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/comfyui/workflow.test.ts src/features/comfyui/object-info.test.ts` passed with 76 tests.
- `npm test -- src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/inpaint-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed with 34 tests.
- `npm test -- src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed with 25 tests.
- `npm test -- src/features/comfyui/workflow.test.ts src/features/comfyui/object-info.test.ts src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/inpaint-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed with 113 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.

## 2026-05-31

### T-AN3 Anima Img2Img, Inpaint, and Sequence Inheritance

Summary:

- Extended Anima workflow metadata and fixed CLIP/VAE defaults from text-to-image into inpaint request validation, resolution, and workflow generation.
- Added a shared ComfyUI model context builder so Anima inpaint and previous-shot img2img use `UNETLoader`, `CLIPLoader`, `VAELoader`, source-image VAE encoding, and `VAEEncodeForInpaint` without `CheckpointLoaderSimple`.
- Kept high-res and local-region inpaint behavior intact while routing VAE encode/decode and harmonization through the selected Anima VAE context.
- Merged sequence per-shot requests over base requests so `workflowProfile`, base model, storage kind, fixed CLIP/VAE, clip device, and UNET dtype metadata inherit into Anima sequence shots.
- Preserved Anima metadata in generated-image saved parameter records and kept T-AN4 features such as detailers blocked by pre-queue validation for Anima inpaint.

Files changed:

- `src/app/api/comfyui/inpaint-image/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.ts`
- `src/features/comfyui/object-info.test.ts`
- `src/features/comfyui/object-info.ts`
- `src/features/comfyui/types.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/workflow-profiles.ts`
- `src/features/comfyui/workflow.test.ts`
- `src/features/comfyui/workflow.ts`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/comfyui/workflow.test.ts src/features/comfyui/object-info.test.ts src/app/api/comfyui/inpaint-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed with 83 tests.
- `npm test -- src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/persistence/project-serialization.test.ts src/features/comfyui/preview.test.ts` passed with 56 tests.
- `npm test` passed: 83 files, 585 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.
- `npm run build` passed with the existing Turbopack NFT trace warning for `sequence-reference-storage`.
- Merged PR #28 and confirmed Issue #27 closed.

### T-AN2 Fixed Anima Model Settings Persistence

Summary:

- Added Anima profile metadata to ComfyUI text-to-image requests and saved generation parameter serialization.
- Fixed Anima CLIP and VAE model names at the workflow profile level (`qwen_3_06b_base.safetensors` and `qwen_image_vae.safetensors`) while preserving base model, workflow profile, and storage kind metadata through editor request construction, generated-image parameters, Comic Sequence defaults/shots, and project serialization.
- Validated the fixed Anima CLIP/VAE files against ComfyUI `object_info` before queueing.
- Filtered Civitai selected LoRAs and AI recommendations by checkpoint base model so Anima checkpoints only keep Anima-compatible LoRAs.
- Kept Anima CLIP/VAE out of the editor generation dialog so users no longer choose those model files manually; Illustrious/default behavior stays on the existing checkpoint workflow.

Files changed:

- `src/app/api/civitai-lora-library/selected-resources/route.ts`
- `src/app/api/civitai-lora-library/selected-resources/route.test.ts`
- `src/app/api/comfyui/generate-image/route.test.ts`
- `src/features/civitai-lora-library/base-model.ts`
- `src/features/civitai-lora-library/ai-recommendation.ts`
- `src/features/civitai-lora-library/ai-recommendation.test.ts`
- `src/features/civitai-lora-library/download.ts`
- `src/features/civitai-lora-library/index.ts`
- `src/features/civitai-lora-library/resource-files.ts`
- `src/features/comfyui/object-info.ts`
- `src/features/comfyui/object-info.test.ts`
- `src/features/comfyui/preview.test.ts`
- `src/features/comfyui/types.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/workflow-profiles.ts`
- `src/features/comfyui/workflow.ts`
- `src/features/comfyui/workflow.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.test.ts`
- `src/features/editor/components/CivitaiLoraLibraryPanel.tsx`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/components/StylePalettePanel.tsx`
- `src/features/editor/components/StylePalettePanel.test.tsx`
- `src/features/persistence/project-serialization.ts`
- `src/features/persistence/project-serialization.test.ts`
- `src/shared/types/project.ts`

Validation:

- `npm test -- src/features/comfyui/object-info.test.ts src/features/comfyui/workflow.test.ts src/features/comfyui/preview.test.ts src/app/api/comfyui/generate-image/route.test.ts src/app/api/civitai-lora-library/selected-resources/route.test.ts src/features/civitai-lora-library/ai-recommendation.test.ts src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/editor/components/StylePalettePanel.test.tsx src/features/persistence/project-serialization.test.ts` passed with 154 tests.
- `npm test -- src/features/civitai-lora-library/download.test.ts` passed with 4 tests during review.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.
- `npm run build` passed with the existing Turbopack NFT trace warning for `sequence-reference-storage`.

### T-AN1 Anima Workflow Profiles

Summary:

- Added a ComfyUI text-to-image workflow profile boundary with the existing Illustrious/default checkpoint workflow as fallback.
- Added Anima txt2img workflow generation using `UNETLoader`, `CLIPLoader`, `VAELoader`, optional standard `LoraLoader`, `EmptyLatentImage`, `KSampler`, `VAEDecode`, and `PreviewImage`.
- Kept unknown and non-Anima diffusion models on the default checkpoint workflow.
- Made text-to-image `object_info` validation profile-aware so default and Anima profiles validate their own required loader nodes, inputs, and model file options before queueing.
- Preserved preview request metadata while retaining the preview step cap behavior.
- Follow-up: parsed ComfyUI `object_info` optional inputs so Anima `CLIPLoader.device` can be retained when ComfyUI exposes it as optional.
- Follow-up: expanded KSampler sampler/scheduler fallback options and added a server-side sampler-options endpoint so editor dropdowns can use the local ComfyUI `object_info` values.

Files changed:

- `src/features/comfyui/workflow-profiles.ts`
- `src/features/comfyui/workflow.ts`
- `src/features/comfyui/object-info.ts`
- `src/features/comfyui/types.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/index.ts`
- `src/features/comfyui/workflow.test.ts`
- `src/features/comfyui/object-info.test.ts`
- `src/features/comfyui/preview.test.ts`
- `src/app/api/comfyui/generate-image/route.test.ts`
- `src/app/api/comfyui/sampler-options/route.ts`
- `src/app/api/comfyui/sampler-options/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.ts`
- `src/features/editor/ai-prompt/comfyui-generation-options.ts`
- `src/features/editor/ai-prompt/comfyui-generation-options.test.ts`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/comfyui/workflow.test.ts src/features/comfyui/object-info.test.ts src/features/comfyui/preview.test.ts src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/workflow/text-to-image/route.test.ts` passed.
- `npm test -- src/app/api/comfyui/sequence-image/route.test.ts` passed.
- `npm test -- src/features/editor/ai-prompt/comfyui-generation-params.test.ts` passed.
- `npm test -- src/features/editor/ai-prompt/comfyui-generation-options.test.ts src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/comfyui/object-info.test.ts src/app/api/comfyui/sampler-options/route.test.ts` passed.
- `npm test -- src/features/comfyui src/app/api/comfyui src/features/editor/ai-prompt/comfyui-generation-options.test.ts src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/editor/ai-prompt/comfyui-generation-diagnosis.test.ts src/features/editor/ai-prompt/style-palette-prompts.test.ts` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.
- Merged PR #24 and confirmed Issue #23 closed.

### Legacy Editor ComfyUI Preview Generation

Summary:

- Added a shared ComfyUI text-to-image preview request transform that reduces target dimensions to a max 512px side with 8px alignment, limits previews to one image, and disables face/hand detailers.
- Added `preview` flow-through for ordinary `/api/comfyui/generate-image` and `/api/comfyui/sequence-image` requests.
- Added preview generation entries to the legacy `/editor` ComfyUI dialog, Style Palette reuse path, and Comic Sequence shot/sequence controls.
- Follow-up: changed preview acceleration from resolution downscaling to fixed 10-step sampling while preserving the requested width and height; preview still limits output to one image and disables face/hand detailers.
- Follow-up: capped preview sampling at a maximum of 10 steps so low-step requests stay low, added preview handling for Comic Sequence previous-shot img2img/inpaint, and replaced separate preview generation buttons with a Preview toggle that changes the normal Generate action.

Files changed:

- `src/features/comfyui/preview.ts`
- `src/features/comfyui/preview.test.ts`
- `src/features/comfyui/types.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/sequence.ts`
- `src/features/comfyui/index.ts`
- `src/app/api/comfyui/generate-image/route.ts`
- `src/app/api/comfyui/generate-image/route.test.ts`
- `src/app/api/comfyui/inpaint-image/route.ts`
- `src/app/api/comfyui/inpaint-image/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.ts`
- `src/app/api/comfyui/sequence-image/route.test.ts`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/comfyui/preview.test.ts src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `@next/next/no-img-element` warnings in editor image-heavy panels.

## 2026-05-30

### Illustrious Prompt Ordering Refactor

Summary:

- Added a shared pure Illustrious prompt renderer for Stable Diffusion prompt sections, default quality/aesthetic tags, Civitai checkpoint trigger words, and LoRA trigger placement by category/tag.
- Updated `/editor` AI prompt generation to request Illustrious JSON sections with selected Civitai trainedWords context and locally render the final stored prompt, with flat-prompt classification fallback.
- Follow-up: Stable Diffusion AI generation now resolves the current selected Civitai resource previews before building the LLM request so checkpoint/LoRA trainedWords are not omitted while the panel preview fetch is still loading.
- Updated Comic Sequence text-to-image and previous-shot inpaint prompt construction to use the shared Illustrious merge path for Stable Diffusion while preserving generic positive prompt joins.
- Deduped Comic Sequence negative prompts across the base negative prompt and per-shot negative prompt.

Files changed:

- `src/features/editor/ai-prompt/illustrious-prompt.ts`
- `src/features/editor/ai-prompt/illustrious-prompt.test.ts`
- `src/features/editor/components/PromptPreviewPanel.tsx`
- `src/features/editor/components/PromptPreviewPanel.test.tsx`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/ai-prompt/illustrious-prompt.test.ts src/features/editor/components/PromptPreviewPanel.test.tsx` passed.
- Follow-up validation: `npm test -- src/features/editor/components/PromptPreviewPanel.test.tsx` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `@next/next/no-img-element` warnings in editor image-heavy panels.
- `npm test` passed: 80 files, 534 tests.
- `npm run build` passed with the existing Turbopack NFT trace warning for `sequence-reference-storage.ts`.

### Comic Sequence Direct Shot Previous Source Fix

Summary:

- Fixed the legacy `/editor` Comic Sequence shot workspace so saving an image from direct `Generate shot` also binds the saved history record back to that shot.
- Promoted the saved local image URL over the stale ComfyUI temp `/api/comfyui/view` URL in the current session results after saving, preventing previous-shot generation from reusing a deleted temp file.
- Reused the existing bound-image previous-shot source path, preserving imported references, manual previous-source settings, sequence reference uploads, and ComfyUI generated image history.
- Added focused regression coverage for binding saved direct-shot image IDs without duplicating existing shot bindings.

Files changed:

- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/comic-sequence-previous-shot.ts`
- `src/features/editor/comic-sequence-previous-shot.test.ts`
- `src/features/editor/comic-sequence-shot-settings.ts`
- `src/features/editor/comic-sequence-shot-settings.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/comic-sequence-shot-settings.test.ts src/features/editor/comic-sequence-previous-shot.test.ts` passed.
- `npm run typecheck` passed.

PR:

- #17

### Style Palette Resource Selection Stability

Summary:

- Split style palette selected Civitai resource loading from selected artist string loading so artist string changes no longer flip the Civitai selected-resource panel into loading.
- Kept existing selected Civitai cards and quick-picker list data mounted while refreshes are in flight.
- Removed the LoRA picker dependency on selected-resource loading state so checkpoint/LoRA selection and right-side removal do not clear the bottom resource list.
- Optimistically applied clicked checkpoint/LoRA list items to selected-resource preview state so checkpoint-to-LoRA switching can use the clicked checkpoint base model immediately.
- Made missing checkpoint base model metadata a stable empty LoRA picker state, with stale picker rows hidden synchronously and aborted picker fetches guarded from late writes.
- Added regression coverage for artist selection not refetching Civitai selected resources, LoRA toggles not refetching/clearing the picker list, checkpoint-to-LoRA switching using the clicked base model without showing stale checkpoint rows, and missing checkpoint base model metadata not showing stale rows or fetching LoRAs.

Files changed:

- `src/features/editor/components/StylePalettePanel.tsx`
- `src/features/editor/components/StylePalettePanel.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/editor/components/StylePalettePanel.test.tsx` passed.
- `npm test` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `@next/next/no-img-element` warnings.

### Local `/editor` Style Palette UX Fix

Summary:

- Added right-side remove buttons for selected artist strings and selected Civitai resources in the style palette.
- Reversed the visible order of quick-pick suggestions and selected content so quick selections appear above the selected lists when open.
- Revised the style palette prompt refresh key so active/negative prompt drafts refresh on preset, checkpoint, LoRA, selected resource, and AI advice changes.
- Added a Subject Input slot above the style palette ComfyUI prompt flow; it persists across palette/resource changes, prepends into the active prompt, and can call the existing LiteLLM chat endpoint to convert a subject name into Danbooru-style tags with loading/error states.

Files changed:

- `src/features/editor/components/StylePalettePanel.tsx`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/ai-prompt/style-palette-prompts.ts`
- `src/features/editor/ai-prompt/style-palette-prompts.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-draft.ts`
- `src/features/editor/ai-prompt/comfyui-generation-draft.test.ts`
- `src/features/editor/components/StylePalettePanel.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/ai-prompt/comfyui-generation-draft.test.ts src/features/editor/ai-prompt/style-palette-prompts.test.ts src/features/editor/components/StylePalettePanel.test.tsx` passed.
- `npm test` passed.
- `npm run typecheck` passed.
- `npm run lint -- src/features/editor/components/StylePalettePanel.tsx src/features/editor/components/StylePalettePanel.test.tsx src/features/editor/ai-prompt/style-palette-prompts.ts src/features/editor/ai-prompt/style-palette-prompts.test.ts` passed.
- `npm run lint` passed with existing `@next/next/no-img-element` warnings.
- `npm run build` passed with the existing Turbopack NFT warning for `sequence-reference-storage.ts`.
- Browser QA opened `/editor`, opened the style palette, confirmed the Subject Input and quick-pick/selected-content ordering, confirmed right-side remove buttons are visible, and confirmed a subject input is prepended into the Active Prompt draft.

### Comic Sequence Single-Shot Generation Button

Summary:

- Added a `Generate shot` action to the Comic Sequence workspace footer before `Generate sequence`.
- Reused the existing ComfyUI shot submission path while limiting the new action to the currently selected shot.
- Kept the existing sequence action generating from the selected shot onward.

Files changed:

- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/comic-sequence-generation.ts`
- `src/features/editor/comic-sequence-generation.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/comic-sequence-generation.test.ts` passed.
- `npm run typecheck` passed.
- `npm run lint -- src/features/editor/comic-sequence-generation.ts src/features/editor/comic-sequence-generation.test.ts src/features/editor/components/ImageGenerationPanel.tsx` passed with existing `@next/next/no-img-element` warnings in `ImageGenerationPanel.tsx`.

## 2026-05-29

### Issue #11 Node 5 Layout Planning UI Follow-up

Summary:

- Locked the Node 5 layout-planning workspace to the 3D editor canvas and hid the embedded 2D/3D canvas mode switch there.
- Restored prompt-library tag selection in Node 5 as a compact right-side/bottom overlay drawer using the existing prompt-library data and editor store binding flow.
- Made the selected-step workspace width and Step output minimum height stable across timeline nodes.
- Kept Node 5 visual-only in the selected workspace while leaving the normal editor canvas mode switch enabled by default.

Files changed:

- `src/features/editor/components/CanvasViewport.tsx`
- `src/features/editor/components/CanvasViewport.test.tsx`
- `src/features/agent-timeline/components/TimelineEditorWorkspace.tsx`
- `src/features/agent-timeline/components/TimelinePromptLibraryDrawer.tsx`
- `src/features/agent-timeline/components/TimelinePromptLibraryDrawer.test.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/components/CanvasViewport.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/components/TimelinePromptLibraryDrawer.test.tsx` passed: 3 files, 13 tests.
- `npm run typecheck` passed.
- `npm test` passed: 76 files, 498 tests.
- `npm run lint` passed with the existing 22 `<img>` warnings in editor image-heavy panels.

### Issue #11 Node 5 Canvas Binding Review

Summary:

- Removed the prompt tag picker from the Node 5 visual output so layout planning shows the existing 3D canvas only.
- Expanded the Node 5 visual workspace width and canvas height while keeping the three-column workbench shell intact.
- Extracted the reverse prompt-tag missing-library review dialog and semantic matching helpers for reuse by the original character image prompt-tag panel and timeline Node 5.
- Added Node 5 prompt-library review handling for skip, transient bind, and import-and-bind choices before committing timeline prompt tags to the editor store.

Files changed:

- `src/features/editor/components/PromptTagImportReviewDialog.tsx`
- `src/features/editor/components/CharacterImagePromptTagPanel.tsx`
- `src/features/agent-timeline/components/TimelineEditorWorkspace.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/editor-canvas-binding.ts`
- `src/features/agent-timeline/editor-canvas-binding.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with pre-existing `no-img-element` warnings in editor image-heavy panels.

### T5 Timeline Prompt Tag Metadata Fix

Summary:

- Preserved parsed prompt-tag metadata across Node 3 character tag output and Node 5 editor binding.
- Kept weighted tokens such as `reflective yellow jacket:1.25` as enabled editor prompt-tag weights after binding.
- Made explicit negative metadata preservation for allowed character/body-part tag categories.

Files changed:

- `src/features/agent-timeline/`
- `src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline` passed: 6 files, 27 tests.
- `npm test -- src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts` passed: 1 file, 9 tests.
- `npm run typecheck` passed.

### T5 Timeline Tag and Pose Reuse Follow-up

Summary:

- Changed Node 3 character tags to reuse the existing editor text reverse prompt-tag message builder and parser.
- Restored the Node 3 raw result shape to `{ items: [...] }` with direct `targetKind` and optional `bodyPartId` fields.
- Kept Node 4 pose planning on the existing stick-figure text generation helper and isolated its request text to Node 2 scene context.
- Kept Node 5 deterministic and LLM-free while binding Node 3 character/body-part items plus the Node 4 pose to the 3D editor character.

Files changed:

- `src/features/agent-timeline/`
- `src/features/prompt-engine/prompt-library/character-image-prompt-tags.ts`
- `src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts` passed: 1 file, 8 tests.
- `npm test -- src/features/agent-timeline` passed: 6 files, 25 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.

### T5 Timeline Inference and Canvas Binding

Summary:

- Restored the timeline workbench to a responsive three-column desktop layout and ordered the narrow layout so the selected node workspace and scene composer appear before the full workflow list.
- Added T5 LangGraph adapters for scene prompt inference, primary character tag extraction, character action/pose inference, and canvas binding.
- Reused `/api/llm/chat` from the client for all LLM calls and kept resource recommendation, parameter recommendation, ComfyUI execution, image storage, and result display blocked or reserved.
- Added structured parsing and normalization for scene prompt fragments, primary character tags, extra people context, stick-figure pose output, and canvas binding results.
- Bound the inferred primary character to the existing editor store as one editable 3D character/skeleton using existing editor store actions.
- Added run invalidation so superseded or cleared timeline graph runs cannot restore stale workflow output or bind stale canvas/editor state.
- Updated the T5 DAG so prompt generation feeds character tags and action planning as parallel sibling nodes, then layout planning joins prompt, tags, and action.
- Expanded prompt generation into the canonical shared scene context producer with a narrow editable visual table and raw JSON inspection/editing fallback.
- Restricted character tags and action planning to non-editable raw JSON inspection, and kept the existing editor 3D canvas plus prompt tag picker visual workspace on layout planning only.

Files changed:

- `src/features/agent-timeline/`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed: 1 file, 4 tests.
- `npm test -- src/features/agent-timeline` passed: 6 files, 23 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.
- `npm test` passed: 74 files, 482 tests.
- `npm run build` passed with the existing Turbopack NFT trace warning for `next.config.ts` through ComfyUI sequence reference storage.
- `git diff --check` passed with line-ending warnings only.
- Orchestrator evidence for the current pass also includes real Edge headless layout measurement passing on `http://localhost:3001`.
- PR follow-up validation: `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed: 1 file, 4 tests.
- PR follow-up validation: `npm test -- src/features/agent-timeline` passed: 6 files, 23 tests.
- PR follow-up validation: `npm run typecheck` passed.
- PR follow-up validation: `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.
- PR follow-up validation: `npm run build` passed with the existing Turbopack NFT trace warning.
- Earlier PR follow-up browser fallback validation on `http://localhost:3000` confirmed the desktop workbench layout; the product clarification pass below was validated with focused automated timeline coverage.
- Product clarification implementation validation: `npm test -- src/features/agent-timeline` passed: 6 files, 25 tests.
- Product clarification implementation validation: `npm run typecheck` passed.
- Product clarification implementation validation: `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.
- Product clarification implementation validation: `npm test` passed: 74 files, 484 tests.
- Product clarification implementation validation: `npm run build` passed with the existing Turbopack NFT trace warning.
- Product clarification browser validation on `http://localhost:3000` passed in headless Edge: desktop workbench measured as three columns, node 2 rendered the visual scene-context table, nodes 3 and 4 rendered non-editable raw JSON only, node 5 rendered the reused editor canvas and prompt tag binding workspace, node 5 preserved node 2's primary character identity despite conflicting node 3 output, and node 4's LLM request did not include node 3 tag-only output.

### T4 Initial Timeline Shell

Summary:

- Replaced the root route with an in-memory initial scene request screen and vertical timeline shell seeded from the T3 timeline state helpers.
- Added reusable timeline UI primitives for node cards, status pills, manual editing, and AI retry/suggestion affordances.
- Rendered all MVP timeline nodes in dependency order with shell output states, manual edit stale propagation, reserved future nodes, and an explicit ComfyUI confirmation gate notice.
- Redesigned the timeline shell as a modern AI agent workflow workbench with left step navigation, a central selected-step workspace, right-side inspector/activity panels, command-style scene composer, input-transform-output panels, and stable responsive layout CSS.
- Moved the legacy editor shell to `/editor` and added a minimal `/settings` entry target without exposing local paths or secrets.

Files changed:

- `src/app/page.tsx`
- `src/app/editor/page.tsx`
- `src/app/settings/page.tsx`
- `src/features/agent-timeline/components/`
- `README.md`
- `docs/dev-log.md`

Validation:

- `npm run typecheck` passed.
- `npm run lint` passed with 22 pre-existing `<img>` warnings in editor UI components.
- `npm run build` passed with the existing Turbopack NFT trace warning for ComfyUI sequence references.
- `git diff --check` passed with line-ending warnings only.
- Existing dev server responded with HTTP 200 for `/`, `/editor`, and `/settings`.
- `npm test` passed: 72 files, 476 tests.
- Browser verification passed for `/`, `/editor`, and `/settings`; the root route submitted a scene request into the vertical timeline shell with no console errors.
- PR #10 was merged to `master`; Issue #9 closed automatically via the PR closing reference.

### T3 LangGraph Workflow Foundation

Summary:

- Added `@langchain/langgraph` as the timeline orchestration dependency.
- Added the transient `src/features/agent-timeline/` feature boundary with exported node ids, statuses, result/error types, dependency DAG helpers, readiness checks, manual edit stale propagation, regeneration eligibility, and generation gate blocking.
- Implemented a LangGraph-backed execution runner with injectable node adapters and branch-safe state merging for the canvas/resource recommendation split.
- Added a graph-friendly LiteLLM adapter wrapper around existing LLM interfaces with mocked-response tests and normalized LLM error categories.
- Kept ComfyUI execution and result display as reserved, non-executable downstream nodes for this issue.

Files changed:

- `package.json`
- `package-lock.json`
- `src/features/agent-timeline/`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline` passed: 2 files, 13 tests.
- `npm test` passed: 70 files, 472 tests.
- `npm run typecheck` initially failed because stale generated `.next/types` referenced removed `src/app/agent/*` routes; after `npm run build` refreshed generated metadata, `npm run typecheck` passed.
- `npm run lint` passed with 22 pre-existing `<img>` warnings in editor UI components.
- `npm run build` passed. Turbopack reported an existing NFT trace warning involving `next.config.ts`, `src/features/comfyui/sequence-reference-storage.ts`, and the ComfyUI sequence references route.

### Timeline MVP Requirements Reset

Summary:

- Product direction was reset from standalone Agent draft to a LangGraph-driven, single-image vertical timeline MVP.
- Closed PR #5 and Issue #4 as superseded by the new timeline requirements.
- Deleted the `issue-4-agent-draft-workflow` local and remote branch.
- Replanned unfinished work into T3-T8: LangGraph orchestration, timeline UI shell, scene/person/action inference with 3D binding, settings page, resource/parameter recommendation, and confirmed ComfyUI execution.
- Updated product, technical, planning, README, and agent guidance so future work uses LangGraph and existing LLM interfaces instead of a bespoke draft-only flow.

Files changed:

- `AGENTS.md`
- `README.md`
- `docs/product-vision.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`

Validation:

- Documentation-only reset; application tests were not required.
- PR #5 is closed.
- Issue #4 is closed as not planned.
- Local and remote `issue-4-agent-draft-workflow` branch references were removed.

## 2026-05-28

### T1 Agent Backend Contract Audit

Summary:

- Audited existing LiteLLM, ComfyUI text-to-image, ComfyUI history/events, and generated image storage backend contracts for GitHub Issue #1.
- Documented the standalone Agent single-image draft contract, explicit confirmation gate, default ComfyUI workflow reuse, seed behavior, image storage behavior, and error taxonomy in `docs/tech-spec.md`.
- Concluded that no production code is required for T1: T2 should add Agent-specific draft schema validation around the existing LiteLLM client, and T3 should thin-wrap existing ComfyUI feature modules for confirmed execution.

Files changed:

- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- Automated tests were not run because this pass only updates technical documentation.
- Inspected the scoped documentation diff.
- `git diff --check` passed with line-ending warnings only.

### Documentation and Agent Workflow Bootstrap

Summary:

- Added root `AGENTS.md` as the SceneForge-specific Codex CLI guide.
- Updated `.codex/agents/product-agent.toml`, `dev-agent.toml`, `tester-agent.toml`, and `reviewer-agent.toml` from the old template project to SceneForge-specific instructions.
- Filled the `docs/` Markdown set with current product, technical, planning, logging, and lessons guidance.
- Added documentation indexes for issues, test reports, and review reports.

Files changed:

- `AGENTS.md`
- `.codex/agents/product-agent.toml`
- `.codex/agents/dev-agent.toml`
- `.codex/agents/tester-agent.toml`
- `.codex/agents/reviewer-agent.toml`
- `docs/README.md`
- `docs/product-vision.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`
- `docs/lessons-learned.md`
- `docs/test-reports/README.md`
- `docs/review-reports/README.md`

Follow-up:

- Moved the former root design document into `docs/product-vision.md` and updated agent/documentation references.
- Reviewed the new docs and agent configs for consistency, then aligned agent write permissions, Track-to-Issue rules, and multi-agent handoff gates across `AGENTS.md`, `.codex/agents/`, and `docs/`.
- Updated the closeout workflow so the Orchestrator automatically commits, pushes, and creates a PR after test and review gates pass. PR merge remains manual.
- Added post-merge cleanup rules: after a user-approved PR merge, the Orchestrator closes linked Issues when needed and deletes merged temporary local/remote branches.
- Removed the local issue-draft workflow so GitHub Issues are the only durable issue-detail records.
- Added agent reasoning effort policy so the Orchestrator knows when to use `high` versus `xhigh` for each sub-agent.

Validation:

- TOML parsing passed for all four files under `.codex/agents/`.
- Searched for stale template-project references in the new agent guidance and found none.
- Application tests were not run because the change is documentation and agent configuration only.

Notes:

- `git status` requires the one-shot `safe.directory` override in this sandbox because repository ownership differs from the sandbox user.
- Source files contain some existing mojibake in comments and UI strings. That issue is documented as a separate risk in `docs/plan.md`.
### T41 / Issue #150 Krea 2 staged Run

Summary:

- Replaced newly confirmed Krea direct-final execution with the standard K=1–4 Preview, comparative scoring, exact-K selection, candidate-linked `preview-upscale`, and Final img2img path; Krea previews use 16-pixel exact-aspect alignment and the existing 4/4/6/8 candidate pools.
- Added Composer source img2img with source-denoise precedence, fixed Krea UNET/CLIP/VAE/model-only-LoRA context in both stages, and fail-closed source-node/input, sampler, local-model-file, and exact-dimension validation.
- Bound Krea Final redraw presets to Conservative/Balanced/Strong 0.35/0.45/0.55. Final review, repair, and verification now persist an explicit T42-unavailable result without invoking their providers.
- Preserved completed legacy direct outputs as read-only direct provenance; incomplete direct records become stale and require new confirmation without fabricated Preview linkage.

### T42 / Issue #152 Krea 2 Final Review and bounded Repair

Summary:

- Enabled the shared bounded Preview/Final review, local recommendation, and explicit variant selection for staged Krea 2 Runs.
- Added default-off Krea Repair authorization to the signed confirmation contract while retaining one-shot checkpoints, recovery identity, no duplicate queueing, and explicit-only Repair promotion.
- Added a Krea-only preflight before any new Repair queue. It accepts only the bounded local Lanczos/latent-noise-mask img2img/inpaint path and validates required graph classes, ports, sampler options, 16-aligned dimensions, and exact local UNET/CLIP/VAE/model-only-LoRA files through `object_info`.
- Incompatible Krea installations return a safe `comfyui-unavailable` skipped Repair without diagnosis, uploads, or queueing; Preview and Final variants remain selectable. Historic T41 T42-unavailable node state migrates to an actionable review-only retry without an automatic external call.

Validation:

- `npm run typecheck`
- `npm test -- --run src/features/agent-timeline/style-reference.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/comfyui/workflow.test.ts src/features/comfyui/validation.test.ts src/features/comfyui/object-info.test.ts` (197 passed)
- `npm run lint` (0 errors; existing image-element warnings)
- `git diff --check`
- `npm run lint` (passes with pre-existing warnings)
- `npm run build`

### Issue #175 Civitai incremental import category ordering fix

Summary:

- Fixed deterministic incremental-index conflicts when imported resources have multiple categories by ordering category rows before JSON aggregation.
- Applied the same ordering contract to resource upsert, list, and detail reads so returned category arrays preserve their persisted `sort_order`.
- Canonicalized categories as a deduplicated, sorted set only when building search and embedding text, preserving compatibility with existing indexes independently of API display order.
- Preserved exact search-text consistency checks and atomic rollback behavior; the fix aligns persisted category order with the text embedded before the transaction.

Validation:

- Current configured database passed `readCivitaiIncrementalIndexBaseline` without rebuilding (`incremental`, 302 indexed chunks, 1536 dimensions).
- Live import of Civitai image `136499926` succeeded with HTTP 200, persisted 13 resource usages, kept resource and FTS counts aligned at 128, and incremented the embedding index from 302 to 319 chunks.
- `npm test -- --run src/features/persistence/civitai-embedding-index.test.ts src/features/persistence/sqlite-storage.test.ts` (36 tests passed)
- `npm test` (154 files, 1,941 tests passed)
- `npm run typecheck`
- `npm run lint` (0 errors; 22 pre-existing warnings)
- `npm run build`
- `git diff --check`

### T53 / Issue #178 Run character-reference adapters

Summary:

- Added one separately stored, byte-free Run character reference with normalized strength and shared Simple/Detailed Composer UI.
- Captured ordered style/character identities and effective values in the signed confirmation context so Preview, Final, and Repair persistence cannot drift to later Composer settings.
- Made non-Krea Run character IPAdapter injection strict, and added Krea-only dual-role Krea2OstrisEdit transport (`image1` style-or-character, optional `image2` character), shared strength, and preflight/queue checks.
- Constrained confirmed style-reference context construction to the effective selected resource and resolved workflow profile, keeping crafted or legacy Anima, unsupported, and unknown `ipadapter` snapshots prompt-only.

Validation:

- `npm run typecheck`

### T57 / Issue #187 Run Preview candidate image presentation

Summary:

- Updated successful Preview candidate media to contain, rather than crop, the stored image within the existing responsive square card area.
- Reused the validated Preview width and height as the Next Image intrinsic dimensions, preserving the complete aspect ratio for portrait, landscape, and square candidates without changing URLs or candidate behavior.

Validation:

- Preview and Timeline Shell focused suite (74 passed); Preview workspace component suite (9 passed)
- Full Vitest suite (155 files, 1,979 tests passed)
- `npm run build`
- `npm run typecheck`
- `npm run lint` (0 errors; 22 existing `no-img-element` warnings)
- `git diff --check`
- Browser QA at desktop and 390 x 844 confirmed complete 2:3 portrait containment, letterboxing, candidate selection behavior, regeneration gating, and no horizontal overflow.
- Reviewer Gate: `APPROVE`; no blocking issues.
### T54 / Issue #181 Run reference-picker viewport stability

Summary:

- Anchored the visually hidden Run character-reference file input to its visible Upload/Replace label so browser focus restoration cannot place it below the fixed-height app shell and scroll the top-level document.
- Applied the same positioning boundary to the adjacent style-reference picker, which used the same latent document-relative layout pattern.
- Preserved the native file input, accepted formats, upload/preflight states, focus semantics, and all reference state and generation behavior.

Validation:

- Focused component tests: 11/11 passed.
- Full Vitest suite: 1,980/1,980 passed across 156 files.
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Chrome browser QA: Simple and Detailed desktop plus an 800x700 compact viewport kept document height equal to the viewport and top-level scroll at zero after chooser focus; Character, Style, and source-image controls remained stable.

### T55 / Issue #183 Krea2 ReID graph and staged-generation correction

Summary:

- Corrected the ReID graph to use the rank-32 LoRA, pinned Ostris node topology, dual image/VAE encoders, distinct latent-method nodes, fixed sampler settings, and strict generated-graph auditing while preserving metadata-valid Krea diffusion selections and the configured local CLIP/VAE runtime.
- Added exact-aspect, 16-aligned, at-most-1,048,576-pixel ReID Previews and policy-v5 same-seed formal Final rerenders from noise. Managed Preview upscales remain review/fallback artifacts but are not uploaded as Final sources.
- Kept ReID visibly Experimental and upstream-unverified for FP8, RedCraft, and other metadata-valid Krea diffusion selections. Extra LoRAs and source img2img remain blocked; FaceDetailer pauses without changing saved state, HandDetailer stays compatible, and 12 GB/offload/OOM guidance never silently changes the selected model or resolution.
- Advanced prepared reference and descriptor state to v2, confirmed reference context to v3, and ReID Final policy to v5. Continuable earlier ReID state is invalidated while completed images remain historical/read-only.

Validation:

- Pinned upstream workflow commit `121fb0183944f1befeb712d92e9ca07d0e282088` and Ostris node commit `7756566160c4a1b24bb1bd9f0ff3ced1a83d7547` inspected for exact nodes, ports, values, and conditioning topology.
- Local `/object_info` confirms the required nodes, ports, configured FP8 Qwen3VL encoder and Qwen VAE, and ReID LoRA. Runtime capability is validated structurally without a separate Verified model tier; live four-seed identity QA remains a manual quality gate.

### T59 / Issue #192 Single-image Run planning Responses transport

Summary:

- Generalized the shared LiteLLM Responses request type and mapper so schema-free calls omit `text.format` while strict Run Scene Prompt schema authorization remains unchanged.
- Migrated Run Character Tags, Character Action, conditional Parameter Recommendation Style Advice, and the LLM completion stage of Run Civitai resource recommendation to `/v1/responses` with `store: false`, `stream: false`, no Chat fallback, and the existing JSON/forced-SSE decoder.
- Added dedicated Run-only API boundaries. Text planning requires a closed node/purpose/prompt/payload/temperature/token contract and forbids client model or transport selection; Run Civitai recommendation uses a separate route and server-only Responses executor while the original Civitai Library route remains Chat.
- Preserved prompts, local parsers, model and NSFW routing, token and temperature settings, embeddings/BM25/RRF retrieval, validation, graph retry/re-entry, stale propagation, persistence, and downstream artifacts.
- Tightened canonical Responses normalization to require exactly one non-empty `output_text` content item in the sole completed assistant message. Unknown, malformed, refusal, annotation-like, or additional sibling content parts now fail closed in both final JSON and forced-SSE recovery.
- Applied metadata-only console and local logging to every authorized Responses path, including Issue #190 Scene Prompt. Responses logs omit prompt/completion bodies, model routing, schema bodies, data URLs, credentials, provider payloads, stack traces, and filesystem paths while ordinary Chat logging remains unchanged.
- Closed the Run resource route error contract to stable status/classification fields so recommendation output, checkpoint ids, summarized internal errors, database details, and provider details cannot cross the client or server-log boundary.

Validation:

- `npm run typecheck`
- Final focused LLM, route, TimelineShell, adapter, logging, and Civitai evidence: 237 tests passed; the full suite passed 2,201 tests across 164 files.
- Real adapter contract probe: Character Tags, Character Action, and Style Advice requests all passed the new allowlist.
- Schema-free transport probe confirmed `store: false`, `stream: false`, `max_output_tokens`, omitted `text.format`, and fail-closed refusal/multiple-message/multiple-text handling.
- `npm run lint` (0 errors; 22 existing `no-img-element` warnings)
- `npm run build`
- `git diff --check`
