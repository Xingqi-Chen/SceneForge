# T55 Krea2 ReID Corrective QA Report

## Test Result: PASS

- Scope source: Track `T55`, GitHub Issue `#183`.
- Date: 2026-08-02.
- Result: automated validation and the required four-seed live ComfyUI gate passed on the existing FP8 runtime.
- Qualification: this is an Experimental, upstream-unverified runtime observation. It does not establish a Verified setup tier or certify this checkpoint/encoder combination.

## Runtime and Resources

- ComfyUI: `0.28.3`, started with its default configuration and no explicit offload flag.
- GPU: RTX 4080 Laptop GPU, 12,282 MiB.
- SceneForge: local API on `localhost`.
- Checkpoint: `Krea 2 Turbo Official Comfy-Org Checkpoints (Krea2)__krea2_turbo_fp8__mv3064297__eb4dd8c612.safetensors`.
- CLIP: `qwen3vl_4b_fp8_scaled.safetensors`.
- VAE: `qwen_image_vae.safetensors`.
- ReID LoRA: `krea2_reid_rank32.safetensors` at strength `1.0`.
- Prepared reference: 384x384; SHA-256 `0366c0af23f18fe3d34fda4facdf540aa421ce47ca182eeb6403b82311c3013b`.
- Reference and generated image files remained only in local/external runtime storage and were not committed.

## Live Test Cases

### Four-seed Preview run

All four Preview requests completed successfully at 832x1248 with 8 steps, CFG 1, Euler, Simple scheduling, and denoise 1.

| Candidate | Seed | ComfyUI prompt ID |
| --- | ---: | --- |
| Preview 1 | `7473999670336930` | `52398faf-6cff-47bf-bb25-8f318f72423d` |
| Preview 2 | `7473999670336931` | `f93f2412-15ac-4633-a804-0ad4a6053ba2` |
| Preview 3 | `7473999670336932` | `483041be-908e-426b-b161-fad0695ec2d1` |
| Preview 4 | `7473999670336933` | `d4b0ec7d-5e19-4f23-968f-147ba728ce14` |

Sanitized pinned upstream/community graph inspection confirmed:

- Two `TextEncodeKrea2OstrisEdit` nodes sharing the prepared image and VAE.
- Two distinct `FluxKontextMultiReferenceLatentMethod` nodes using `index_timestep_zero`.
- ReID LoRA strength 1 and `Krea2OstrisEditModelPatch(kv_cache=true)`.
- `EmptyLatentImage` generation with no source `VAEEncode` path.

Qualitative identity observation: all four candidates retained the reference's black long hair, eyebrow/eye proportions, nose/lip contour, and overall face shape while outfit, chair, and pose varied. Identity was visibly improved over the earlier prompt-only-like outputs, although some seed-to-seed variance remained. Preview 1 was selected for the formal rerender.

### Formal Final run

- Result: success.
- Dimensions: 1024x1536.
- Seed: `7473999670336930`, matching selected Preview 1.
- Sampling: 8 steps, CFG 1, Euler, Simple scheduling, denoise 1.
- ComfyUI prompt ID: `40000c53-9a4f-41bf-b258-cd1de86513db`.
- Graph evidence: `EmptyLatentImage`, zero `VAEEncode` nodes, two ReID encoders, and two Flux latent-method nodes.

The Final preserved and modestly improved recognizable identity relative to Preview 1 while changing outfit and composition as expected from a formal txt2img rerender.

## Automated Evidence

- Focused regression matrix: 17 files, 651/651 tests passed.
- Full Vitest suite: 161 files, 2,042/2,042 tests passed.
- TypeScript typecheck: passed.
- Next.js production build: passed.
- Diff hygiene: `git diff --check` passed.
- ESLint: passed with 0 errors and 22 existing `no-img-element` warnings.

Automated coverage includes pinned upstream/community graph topology, graph tamper rejection, metadata-valid FP8/RedCraft Experimental handling, exact-aspect one-megapixel Preview sizing, same-seed formal txt2img Final execution, ReID version invalidation, Composer source blocking, FaceDetailer pause/restore, HandDetailer compatibility, persistence, UI, and non-ReID regressions.

## Manual UI Evidence

- The local SceneForge page loaded and the Krea profile was selectable.
- Chrome upload verification was blocked by the extension's file-URL permission. Upload, preparation, consent, source blocking, and ReID UI state remain covered by the passing automated component and route tests.

## Blocking Issues

- None.

## Non-blocking Issues

- The live result is observational and does not certify identity quality across other prompts, references, seeds, checkpoints, encoders, or ComfyUI configurations.
- Some identity variance remained across the four seeds.
- Direct Chrome file-upload QA was unavailable because of extension file-URL permissions.
- ESLint retains 22 existing `no-img-element` warnings outside this corrective scope.

## Recommended Fixes

- No corrective production fix is required by this test evidence.
- Continue labeling Krea2 ReID Experimental and upstream-unverified for metadata-valid runtimes, including this FP8 setup.
