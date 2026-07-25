# T38C One-shot Local Repair Test Report

## Test Result: PASS

- Scope source: Track `T38C`, GitHub Issue `#142`, branch `issue-142-one-shot-local-repair`.
- Test date: 2026-07-25.
- The resumed checkpoint-v3/semantic-identity/manual-recovery Test Gate passed the focused, full-suite, type, lint, build, diff, ignore, and responsive browser gates.
- Sixteen acceptance gaps found across the Test and Review loops were fixed and verified: upstream retry semantics, same-verification Final score comparison, path-unsafe restore reconciliation, Detailed verification findings, Detailed retry-stage display, Repair-owned output prefixes, queue/checkpoint crash safety, exact rank/seed binding, monotonic attempt reconciliation, closed queue-outcome recovery guidance, repair-checkpoint runtime-data exclusion, deterministic attempt identity recomputation, closed filesystem/storage error redaction, runtime-only guarded Repair promotion, full semantic request-digest binding, and canonical top-level Repair source provenance.
- The resumed independent Test Gate revalidated canonical disk/workflow attempts and closed persisted errors, including reordered full v3 checkpoints, legacy/incomplete v2 fail-closed behavior, unknown-field rejection at every checkpoint layer, output/source-node and top-level/attempt source mismatches, process-loss diagnosis and SAM2 call bounds, mask reuse, privacy, Preview/Final preservation, sanitize-plus-serialize error redaction, and closed manual recovery actions.

## Acceptance Criteria Coverage

1. Signed authorization: server confirmation records explicit true/false repair authorization, defaults off, rejects tampering, and disabled repair performs no diagnosis/image work.
2. Definition-driven v4 DAG: tests assert `final-review -> final-repair -> repair-verification -> result-display`, including stage execution boundaries.
3. Safe reachability: disabled, unsupported, and failed review paths produce closed skip/verification results and still reach result display.
4. Local eligibility: tests admit only Final-introduced major/blocking `contact` and `object-count` findings and exclude unsupported scope/operation/severity cases.
5. One-shot behavior: combined local targets share one repair pair; an existing successful Repair is reused only when its exact candidate/rank/seed/Final/review/target identity and canonical base semantic request digest still match. The deterministic SHA-256 attempt identity is recomputed from that binding before diagnosis, managed-image, checkpoint, or ComfyUI work. A different valid-looking 64-hex digest is rejected with zero queue calls even when the expected checkpoint is absent or the configured checkpoint directory has changed and been cleaned. A durable `queue-started` checkpoint is created before ComfyUI is called, so an unknown queue outcome fails closed instead of creating a second candidate.
6. Mask validation: tests cover structured masks, empty masks, wrong dimensions, oversized masks, post-growth oversize, actual before/after raster coverage, and `growMaskBy` clamping to 64.
7. SAM2 boundaries: tests cover one clear rectangle/ellipse point/box target, rotated/polygon rejection, invalid dimensions, and broad-output rejection. Generic ComfyUI object-info validation remains covered by the full suite; live optional-node compatibility is environment-dependent.
8. Request-local policy: persisted repair policy records independent Face/Hand Detailer overrides while the Composer settings snapshot remains byte-for-byte unchanged; Preview/Final execution state remains unchanged after promotion.
9. Managed storage/path safety: serialization excludes data URLs, absolute Windows/POSIX paths, raw responses, prompts, image fragments, API-key/secret-like text, and unsafe fields. Managed-image reads, checkpoint reads/writes/renames, mask/Repair storage, ComfyUI history, and output fetch failures return fixed stage-specific codes/messages with bounded metadata; persistence re-sanitizes crafted pair errors through the same closed allowlist. Path-unsafe mask metadata fails closed while independently valid Preview/Final state remains intact. Repair Inpaint replaces inherited output prefixes with a bounded hashed Repair-owned prefix.
10. Retry/one-shot state: tests cover durable per-pair queue/output/storage checkpoints, storage recovery without a second queue, multi-pair interruption, successful Repair reuse, failed-stage persistence, retry-stage display, downstream retry closures, and preservation of completed upstream nodes. Exact-attempt reconciliation is monotonic across `queue-started < queued < output-ready < stored`: a matching newer workflow attempt outranks an older disk checkpoint, while changed output-node, prompt, base semantic request, or final inpaint request identity fails closed or falls back to the trusted disk state and never queues a second Repair.
11. Bounded verification: all Preview/Final/Repair images use one high-detail request; only malformed schema authorizes one safe schema-repair call; upstream retry reuses the original request; provider calls are capped at two and transient payloads are not persisted.
12. Local recommendation: model-authored recommendation fields are ignored. Tests require all targets resolved, no new major/blocking defect, and Repair score at least the parent Final score from the same verification response.
13. Simple/Detailed UI: Simple exposes verified Repair and explicit selection without detailed metadata. Detailed exposes normalized targets, skip/failure and retry reasons, mask provenance/coverage, verification summary, and verification findings.
14. Explicit promotion: Repair is unavailable for selection until verified; explicit selection alone updates the official variant. The generic Final-review selector rejects `repair` at runtime as well as in its TypeScript contract, so only the parent-, verification-, and canonical source-provenance-guarded Repair selector can promote it. Selection does not stale or mutate repair, verification, Final execution, Preview, or Composer state, and it round-trips through persistence.
15. Migration/tamper: legacy workflows restore with repair disabled and no automatic repair call. Authorization, exact parent Final/review timestamp/findings/targets/rank/seed, attempt prompt, mask/path, exact verification Repair parent/image, and promotion inconsistencies fail closed while preserving independently valid Preview/Final results. Failed verification reconciles any stale Repair selection back to the safe local default. The Detailed restore fixture now uses an exact managed filename/URL pair instead of a binding-invalid Final reference.
16. Manual recovery UX: `queue-outcome-unknown` is visibly closed in Simple and Detailed modes, says not to retry, keeps Preview/Final guidance actionable, exposes no Simple Retry repair, and disables Detailed `Run node` and `Regenerate`. The notice remains visible when `result-display` has not completed yet.
17. Runtime-data hygiene: `.gitignore` excludes `/data/agent-timeline-repair-attempts/`, and `git check-ignore data/agent-timeline-repair-attempts/example.json` resolves to that rule.
18. Canonical checkpoint boundary: an exact clean v3 queued checkpoint resumes through history and storage without a second queue; legacy or incomplete v2 checkpoints fail closed before diagnosis, history, storage, or queue calls. Plausible envelopes are rejected before history/storage/client propagation when unknown unsafe fields appear on the envelope, parent, parent managed image, reviewed finding/target, attempt, source image, or stored image. `queue-started`, `queued`, `output-ready`, and `stored` state requirements plus prompt/output/source/stored reference canonicality fail closed.
19. Shared persisted-attempt boundary: workflow restore uses the same pure canonical attempt sanitizer, is insensitive to object key order, strips unknown attempt/image fields, and preserves valid Preview/Final state when an attempt is malformed.
20. Closed persisted errors: node-level Final-repair and Repair-verification errors and failed verification-result errors discard arbitrary raw codes, names, messages, paths, data URLs, prompt fragments, tokens, and custom metadata. Sanitized and serialized forms contain only fixed stage-safe codes/messages and bounded `recoverable`/`stage` metadata. Verification configuration copy names Preview and Final as the selectable variants.
21. Full semantic request identity: the v3 base digest covers validated prompts, checkpoint/profile/model context, formal dimensions/seed, steps/CFG/sampler/scheduler/denoise, ordered LoRAs and weights, prompt wrappers, detailers, ControlNets, character/style references, and other supported material fields. Object-key order canonicalizes, while LoRA, ControlNet, character-reference, nested reference-image, checkpoint-alias, and final-inpaint LoRA arrays remain order-sensitive. Only documented transport fields such as generated/upload names, client/prompt IDs, output prefixes, masks, source references, and data-URL payloads are projected out.
22. Canonical Repair source provenance: every repaired pair requires its top-level `sourceImage` to canonical-equal `attempt.sourceImage`, and both must bind `nodeId` to `outputNodeId`. Sanitization, reconciliation, verification, UI exposure, and promotion all reject a safe-looking wrong filename or node while preserving Preview and Final.

## Test Files Added or Updated

- `src/features/agent-timeline/t38c-final-repair.test.ts`
- `src/features/agent-timeline/final-repair-execution.test.ts`
- `src/features/llm/repair-diagnosis-privacy.test.ts`
- `src/app/api/agent-timeline/confirm-generation/route.test.ts`
- `src/features/agent-timeline/generation-confirmation.server.test.ts`
- `src/features/agent-timeline/run-input-settings.test.ts`
- `src/features/agent-timeline/workflow-definition.test.ts`
- `src/features/agent-timeline/workflow.test.ts`
- `src/features/agent-timeline/timeline-workflow-persistence.test.ts`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/components/TimelineResultDisplayWorkspace.test.tsx`

## Commands and Evidence

### Focused tests

```text
npx vitest run <12 T38 route, workflow, persistence, privacy, UI, and adjacent T38B files>
Test Files  12 passed (12)
Tests       426 passed (426)
```

### Full suite

```text
npm test
Test Files  137 passed (137)
Tests       1541 passed (1541)
```

### Static and build gates

```text
npm run typecheck
PASS

npm run lint
PASS with 0 errors and 23 existing warnings

npm run build
PASS - Next.js production build compiled, typechecked, and generated 46 pages

git diff --check
PASS - no whitespace errors; PowerShell reported only LF-to-CRLF working-copy notices

git check-ignore -v data/agent-timeline-repair-attempts/example.json
PASS - matched .gitignore line 53: /data/agent-timeline-repair-attempts/
```

## Browser QA

Local Chrome QA used a temporary SceneForge development server at `http://localhost:3000/` without changing the restored workflow data. The temporary mobile viewport override and original `Scene input` selection were restored after testing, the agent-created tab was closed, and the temporary server was stopped.

- Current desktop `1707x898`: PASS. The restored v4 Run shows all 15 workflow steps including `Local repair` and `Repair verification`; the current workflow safely shows those steps blocked behind a not-yet-completed Final review while its existing Artifact result remains reachable. Document, body, and client widths equal 1707px with no horizontal overflow.
- Narrow viewport `390x844`: PASS. All 15 steps remain reachable from the first Scene input through the last Artifact result, both repair-stage labels remain present, and document, body, and client widths equal 390px with no horizontal overflow.
- The current restored workflow did not contain a closed uncertain-queue fixture. That state was validated through the passing component, shell, runtime, and persistence regressions rather than mutating the user's workflow.
- Browser console contained no SceneForge application runtime error. It reported one existing Next Image LCP advisory for the restored generated image and three Chrome extension message-channel closure diagnostics during responsive viewport control; neither affected the page or assertions.
- The temporary mobile viewport override was reset to `1707x898`, the agent-created tab was closed, and the temporary development server was stopped.

## Crash-window Assessment

- Before the final fix, ComfyUI could accept a Repair queue before the first durable prompt checkpoint was written. A process loss in that interval allowed a fresh invocation to queue a second Repair and violated Issue #142 acceptance criteria 5 and 10.
- The final implementation creates an exclusive `queue-started` checkpoint before calling ComfyUI. If the process then loses the returned prompt identity, restore treats the queue outcome as unknown and refuses to queue again. This closes the second-successful-Repair window; the ambiguous attempt requires explicit manual recovery rather than risking duplication.

## Blocking Issues

None.

## Non-blocking Issues and Environment-dependent Validation

- Lint retains 23 pre-existing warnings outside T38C: one unused test parameter and existing `<img>` optimization warnings.
- Vitest emits existing React `act(...)` environment notices and mocked relative autosave URL diagnostics during UI suites; all affected assertions pass.
- Browser QA retains the non-blocking existing generated-image LCP advisory and Chrome extension message-channel diagnostics described above.
- Live LiteLLM Vision/default/NSFW routing, actual ComfyUI repair rendering, SAM2 optional-node compatibility, and subjective visual quality were not exercised because they require configured external/local model services and an eligible generated Final.
- A full live recommended/not-recommended Repair promotion walkthrough should be repeated when those services and a deterministic eligible fixture are available.
- A `queue-started` outcome without a known prompt ID intentionally cannot be automatically retried. This is a fail-closed one-shot safety tradeoff; the UI now explains manual recovery and keeps automatic retry controls unavailable.

## Recommended Next Action

Proceed to the reviewer-agent gate. Keep live ComfyUI, SAM2, ordinary Vision, and NSFW multimodal quality checks as explicit environment-dependent follow-up evidence rather than blocking this deterministic Test Gate.
