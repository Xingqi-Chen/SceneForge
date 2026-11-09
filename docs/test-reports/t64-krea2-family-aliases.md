# T64 / Issue #205: Krea 2 compatibility aliases

## Test Result: PASS

Validated on 2026-11-09 on `fix-205-krea2-family-aliases`, stacked on PR #204. Scope source: GitHub Issue #205. The tester changed seven colocated test files and this report only; production and tracker changes belong to the implementation agent and Orchestrator.

## Test Cases Added

Added 60 regression cases across these files:

- `src/features/civitai-lora-library/base-model.test.ts`: cross-matches known standard/Turbo aliases bidirectionally, including case, whitespace, compact, hyphen, and underscore spellings. Rejects unknown suffixes/numbers, missing metadata, and other families. Preserves non-Krea comparison behavior.
- `src/features/persistence/sqlite-krea2-family.test.ts`: filters persisted images and resources by all tested aliases without modifying raw rows, schema, or normalized deduplication keys. Verifies ordering, NSFW, query, resource count, category, resource type, import count, exact non-Krea filters, and separate fallback identities for equal names with the two original labels. Uses temporary SQLite fixtures without an FTS rebuild.
- `src/features/civitai-lora-library/image-resource-selection.test.ts`: keeps the current checkpoint, selects mixed-alias ready LoRAs in usage order, retains duplicate warnings, and excludes unready, missing-base, unknown-variant, and other-family usages.
- `src/features/civitai-lora-library/image-resource-selection.server.test.ts`: recreates the image `147820382`/official checkpoint/Mrpopo scenario in both alias directions, checks local readiness, deduplicates readiness checks, preserves metadata, and rejects stale non-family checkpoint context.
- `src/app/api/civitai-lora-library/imported-images/[id]/resource-selection/route.test.ts`: passes the original checkpoint label to the server and returns ordered alias selections without replacing the checkpoint.
- `src/features/editor/components/StylePaletteCivitaiResourceSelector.test.tsx`: shows alias images, excludes unknown variants and other families, keeps raw displayed labels and checkpoint request context, selects alias LoRAs in both directions, and ignores a stale selection response after switching between different Krea 2 and Turbo checkpoints.
- `src/features/civitai-lora-library/ai-recommendation.test.ts`: accepts both known labels and rejects unknown Krea variants, missing metadata, and other families while retaining recommendation order and raw labels.

Existing empty-stack clearing, identical-selection no-op, reordered selection, duplicate warnings, readiness, non-Krea behavior, and A-to-B-to-A stale-request regressions also passed.

## Commands Run

| Command | Result |
| --- | --- |
| Focused Vitest run across the seven files above | PASS: 7 files, 101 tests |
| `npm test` | PASS: 171 files, 2,427 tests; 38.80 seconds |
| `npm run build` | PASS: compilation, final TypeScript validation, route collection, and static generation |
| `npm run typecheck` | PASS, reported by the implementation agent; final build also checked all subsequent test additions |
| `npm run lint` | PASS, reported by the implementation agent: 0 errors, 22 existing image-element warnings |
| Scoped ESLint across all seven changed test files | PASS |
| `git diff --check` | PASS |

## Evidence

Automated tests use mocked requests or local temporary fixtures. No live provider calls or runtime library writes were performed by the tester.

The Orchestrator completed these read-only checks against the existing local library after refreshing the verified SceneForge production server to the new build:

- Imported-image queries for standard, Turbo, compact, case, whitespace, underscore, and hyphen aliases returned HTTP 200 with 11 images, including image `147820382`, whose raw label remains `Krea 2 Turbo`.
- LoRA queries for both original aliases returned HTTP 200 with 16 LoRAs, including Mrpopo with its Turbo label.
- Image `147820382` resource selection with the official Krea checkpoint returned HTTP 200, retained checkpoint `civitai_res_8de2517d-6b45-44bf-b894-2d1c5efb434e`, and selected three ready LoRAs: Mrpopo, Ektachrome, and Masterpiece. Warnings were empty.
- Read-only SQLite inspection confirmed the image raw Turbo label and `updated_at` value `2026-11-09T06:32:42.683Z` remained unchanged. Mrpopo retained its raw Turbo label and `normalized_base_model='krea 2 turbo'`.
- No generation, download, reimport, index rebuild, or provider request was needed for these checks.

Browser attachment was attempted by the Orchestrator but the connector reported `browser access host unavailable`. No visual browser result is claimed; the focused jsdom selector tests cover image visibility, LoRA toggling, selection, and stale-response behavior.

## Blocking Issues

None.

## Non-blocking Issues

- Native browser verification was unavailable due to the connector host; read-only live API checks and jsdom interaction regressions passed.
- Existing `@next/next/no-img-element` lint warnings and Node SQLite experimental warnings remain.

## Recommended Fixes

None for Issue #205. Proceed to the Review and Closeout gates.
