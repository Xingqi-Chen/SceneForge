# SceneForge Product Specification

## Product Summary

SceneForge is a visual prompt creation workspace for AI image generation. The near-term MVP is a single-image, top-to-bottom AI-assisted timeline: the user enters one scene request, then SceneForge uses existing LLM and generation modules to infer scene prompt text, character tags, character action, 3D canvas binding, checkpoint/LoRA selection, and generation parameters.

The timeline is not a hidden automation script. Every node exposes its result, lets the user intervene, and can call AI again with the user's correction. The workflow stops at the "start image generation" gate until the user explicitly confirms.

## Target Users

- AI image creators who want a guided path from a natural-language scene idea to a structured generation request.
- Illustrators, concept artists, storyboard artists, and comic creators who need editable visual control before generation.
- Local ComfyUI users who maintain checkpoint, LoRA, prompt, and generation settings.
- Users who prefer visual timeline checkpoints over a single opaque prompt box.

## Core User Value

- Start from one scene request instead of assembling prompt, model, pose, and parameters manually.
- Inspect and edit each intermediate step before image generation.
- Bind AI-inferred character tags and action to the existing 3D canvas so visual edits remain possible.
- Reuse existing local Civitai resources and ComfyUI parameters instead of accepting unavailable model names invented by an LLM.
- Keep local-first workflows private by default, with explicit configuration for external services.

## Current Product Surface

SceneForge currently includes reusable capabilities that the timeline MVP should compose:

- Main editor shell, panels, 2D canvas, 3D viewport, prompt panels, and Zustand editor state.
- 3D stick-figure character controls, pose presets, and prompt export support.
- Prompt library and prompt binding workflows for scene, object, character, and body-part targets.
- Local project save/load through Next.js API routes backed by local disk storage.
- LiteLLM-compatible chat support for AI-assisted prompt and recommendation flows.
- ComfyUI workflow generation, generated image history, inpainting, sequence references, control image helpers, and diagnostic helpers.
- Civitai resource discovery, selected checkpoints/LoRAs, import image parsing, download support, cache repair, and recommendation helpers.
- Artist string library resources and selection.
- Tavily-backed web context for ComfyUI diagnosis when configured.

The old standalone Agent draft PR and Issue were rejected. The new MVP should not add a parallel draft-only surface that bypasses 3D binding, timeline dependencies, or LangGraph orchestration.

## MVP Definition

The MVP is a single-image workflow with these boundaries:

- Initial screen: only a scene request input, a start button, and a settings entry point.
- Workflow display: a vertical timeline of nodes from top to bottom.
- Generation scope: one image request at a time.
- Character scope: one primary character in the 3D canvas. Additional people in the input may be represented as prompt or scene context until a later multi-character track.
- Orchestration: LangGraph owns node execution, dependency edges, parallelism, stale downstream regeneration, and errors.
- LLM access: reuse existing LLM interfaces through graph-friendly adapters; do not add a bespoke LLM path unless an existing interface cannot support the node.
- Generation gate: timeline must stop before ComfyUI execution until the user clicks start image generation.
- Settings: path settings, NSFW, and integration status belong in a settings page, not in the main workflow.

## Timeline User Flow

1. User opens the MVP entry point.
2. User sees a single scene input and settings entry point.
3. User enters a scene description, for example: "rainy cyberpunk street, one girl holding an umbrella and looking back at the camera".
4. SceneForge starts a LangGraph workflow and expands the vertical timeline.
5. The graph generates scene prompt suggestions.
6. The graph infers character tags and binds them to the primary character and body parts.
7. The graph infers the character action and produces a 3D pose suggestion.
8. SceneForge binds scene prompt, character tags, and pose to the 3D canvas.
9. The graph recommends checkpoint and LoRAs from local Civitai candidates.
10. The graph recommends generation parameters.
11. Timeline stops at the start image generation gate.
12. User reviews or edits any node.
13. If the user edits a node, dependent downstream nodes become stale and regenerate; unrelated nodes remain unchanged.
14. User clicks start image generation.
15. SceneForge calls the existing single-image ComfyUI path and advances to execution and result nodes.

## Timeline Nodes

| Node | Inputs | Outputs | Dependencies | User Intervention | AI Re-entry |
| --- | --- | --- | --- | --- | --- |
| Scene input | User scene request | Workflow id, raw intent, settings snapshot | None | Edit input and restart workflow | Optional AI rewrite of input without mutating old downstream results |
| Scene prompt | Raw intent, settings | Positive scene prompt, negative suggestions, style, camera, lighting | Scene input | Edit prompt sections | Re-run scene prompt node with user guidance |
| Character tags | Raw intent, scene prompt | Primary character description, body-part tags, clothing, expression | Scene prompt | Add, remove, or bind tags manually | Re-run character tag node with user guidance |
| Character action | Raw intent, character tags, current pose | Action description and 3D pose targets | Character tags | Edit action text or choose a pose preset | Re-run action/pose node with user guidance |
| 3D canvas binding | Scene prompt, tags, pose | 3D scene entities, primary skeleton, spatial summary | Scene prompt, character tags, character action | Drag character, camera, and simple scene objects | Re-run pose or spatial suggestion using the current canvas |
| Checkpoint and LoRA | Prompt data, tags, action, NSFW setting, local Civitai candidates | Selected checkpoint, LoRAs, reasons, suggested weights | Scene prompt, character tags, character action, settings/resources | Re-select checkpoint or LoRAs from local candidate UI | Re-run recommendation with style/model preference |
| Generation parameters | Prompt draft, selected resources, settings | Width, height, steps, cfg, sampler, scheduler, denoise, seed policy, negative additions | Checkpoint and LoRA, prompt data, canvas summary | Edit parameters with existing controls | Re-run parameter node with quality/speed/aspect guidance |
| Start image generation | Prompt, resources, parameters, canvas summary | Confirmed ComfyUI request preview | Previous nodes done or manual | Click start image generation | AI may explain risk or suggest final adjustment, but must not call ComfyUI |
| ComfyUI execution | Confirmed request | Queue metadata, execution status | Start image generation confirmation | Retry or cancel where supported | Existing diagnosis helpers on failure |
| Result display | ComfyUI output | Single image, metadata, reusable prompt and parameters | ComfyUI execution | Save, copy prompt, or return to upstream nodes | Use result feedback to re-enter upstream nodes |

## Dependency and Regeneration Rules

- Each node has explicit dependencies in LangGraph.
- Nodes with no dependency relation may run in parallel.
- A node can run only after all required dependencies are `done` or `manual`.
- Node statuses should include `blocked`, `ready`, `running`, `done`, `stale`, `error`, and `manual`.
- User edits mark the edited node as `manual`.
- Downstream nodes that depend on the edited node become `stale`.
- Stale dependent nodes regenerate automatically once their dependencies are valid.
- Nodes outside the dependency closure of an edit preserve their current result.
- The UI renders graph state and sends user actions; it must not manually chain LLM calls outside LangGraph.

## Settings Page

The MVP needs a settings page or settings route that keeps the main workflow clean.

Required setting areas:

- NSFW mode.
- Local path settings for generated images, project storage, prompt library, ComfyUI temp directory, and Civitai resource paths where applicable.
- ComfyUI connection status.
- Civitai resource index/status.
- LiteLLM configuration status.

Security expectations:

- API keys and secrets remain server-only in `.env.local` unless a future scoped issue explicitly introduces secure runtime secret editing.
- The settings page may display whether required environment variables are configured, but must not echo secret values.
- Path updates must validate absolute paths, reject traversal, and avoid writing outside configured roots.

## Non-goals for MVP

- Multi-image batch generation.
- Comic sequence generation.
- Inpainting.
- ControlNet.
- Upscaling.
- Full ComfyUI node graph editing.
- Multi-character pose synchronization.
- Cloud identity, billing, collaboration, or remote project sync.
- A hosted model or asset marketplace.

## Acceptance Criteria

- A new user can start the MVP from one scene input.
- The timeline is shown vertically from top to bottom after submission.
- Each timeline node shows status, output, user edit controls, and an AI suggestion/retry affordance.
- Scene prompt text is editable.
- Character tags can be manually bound to the primary character or body parts.
- 3D canvas pose and placement can be manually adjusted.
- Checkpoint and LoRA selection is made from local candidates and can be changed through a visible resource-selection UI.
- Generation parameters use existing ComfyUI-style controls and can be manually edited.
- LangGraph drives node execution, dependencies, stale state, and regeneration.
- Timeline stops before ComfyUI execution until explicit user confirmation.
- Clicking start image generation advances to single-image ComfyUI execution and result display.
- Settings are outside the main workflow and include NSFW plus required path/integration configuration.

## Product Constraints for Agents

- `product-agent` owns product scope, Track definition, issue-ready acceptance criteria, and planning notes.
- The Orchestrator owns GitHub Issue creation, tracker updates, cross-agent handoff, automatic commit/push/PR creation after gates pass, and post-merge Issue/branch cleanup after a user-approved merge.
- `dev-agent` owns implementation and documentation updates for technical or user-visible changes within the assigned Issue or approved local-only Track.
- `tester-agent` owns test coverage and validation reports, not production fixes.
- `reviewer-agent` is read-only by default and must lead with blocking issues.
- Timeline workflow work must preserve the LangGraph boundary. If implementation starts hand-coding node order in a React component or API route, it is out of scope.

## Open Product Questions

- Should MVP strictly limit to one primary character, or allow multiple characters as separate later timeline branches?
- Should settings allow editing LiteLLM and ComfyUI API keys, or only show server-side configuration status?
- Should generated results bind to the current project history in MVP, or remain standalone generated-image records?
- Should the legacy full editor remain the default route while the timeline MVP is built under a new route, or should timeline become the default entry after T4?

## Comic Sequence Prompt Architecture Plan (Issue-Ready, zh-CN)

### 问题陈述

当前 Comic Sequence 创建 shot 时，会把当前 canvas prompt 或 `activePrompt` 基本原样复制到每个 shot 的 Canvas prompt。AI storyboard 只生成 Manual shot prompt。最终 ComfyUI positive prompt 近似为：

`Canvas prompt + reference character prompt + Manual shot prompt`

在 Stable Diffusion / Illustrious 路径下，最终 prompt 还会经过 Illustrious 分段重排。这个行为在单人、少量 shot 的场景中可用，但在连续漫画分镜中会快速暴露问题：

- 每个 shot 都复制完整 canvas prompt，导致 prompt 过重。
- 全局风格、环境、角色外观、动作、镜头语言混在一起，容易互相冲突。
- 角色特征在 Canvas prompt、reference character prompt、Manual shot prompt 中重复出现，降低一致性。
- 多人场景难维护，无法表达 Shot 1 只有角色 A、Shot 2 有角色 A+B。
- 单个 shot 回 canvas 二次编辑时，容易意外覆盖全局风格、角色身份或手写 shot 指令。

### 用户价值

- 用户可以为一组漫画分镜维护统一风格、环境和角色设定，同时让每个 shot 只描述当前镜头差异。
- 多人分镜可以明确声明每个 shot 的出场角色，减少角色串场、漏角色、重复角色特征的问题。
- 用户回到 canvas 调整某个 shot 的构图、局部场景或 ControlNet 设置时，不会破坏角色库和 sequence 级设定。
- AI storyboard 输出更接近可编辑的分镜结构，而不是把所有内容塞进一个 prompt 字符串。
- ComfyUI / Stable Diffusion 最终 prompt 更短、更稳定、更容易审查和调试。

### 目标

- 将 Comic Sequence prompt 拆成职责明确的 prompt 层级：Sequence style prompt、Sequence environment prompt、Character Reference Prompt、Shot Canvas Prompt、Manual Shot Prompt。
- 引入 sequence 级角色库 `characters` 和 shot 级 `castCharacterIds`，只合并当前 shot 出场角色。
- 让 Character Reference Prompt 成为人物外观和身份的唯一权威来源。
- 让 Shot Canvas Prompt 只表达当前 shot 从 canvas 得到的可见元素、局部场景和构图。
- 让 Manual Shot Prompt 专注表达当前 shot 动作、镜头、表情、互动方向和人数/位置标签。
- 明确单个 shot 回 canvas 二次编辑时哪些字段自动更新，哪些字段必须由用户显式同步。
- 新 prompt 架构只面向新建或重新创建的 Comic Sequence；旧 saved comic sequence 的迁移不纳入本计划。

### 非目标

- 不在本计划中重做完整 Comic Sequence UI。
- 不要求一次实现完整多人 3D pose synchronization。
- 不改变单图 MVP 的 LangGraph 产品方向。
- 不引入新的图像模型、远端服务或独立生成后端。
- 不要求 AI storyboard 在 MVP 阶段生成完整 canvas object diff 或复杂 layout graph。
- 不迁移、修复或兼容旧 `savedComicSequence` 数据；旧数据处理由用户重新创建 sequence 或后续单独任务解决。

### 推荐数据模型

Sequence 级数据：

```ts
type ComicSequence = {
  id: string;
  title: string;
  stylePrompt: string;
  environmentPrompt: string;
  characters: ComicCharacter[];
  shots: ComicShot[];
};
```

角色库：

```ts
type ComicCharacter = {
  id: string;
  name: string;
  prompt: string;
  references?: CharacterReference[];
};
```

角色字段规则：

- `prompt` 是 Character Reference Prompt，作为人物外观、身份、服装基线、固定特征的唯一权威来源。
- `references` 保存角色参考图、reference id、权重或其他 reference 元数据。
- Character Reference Prompt 不应包含动作、镜头、临时表情、局部场景、当前 shot 的相对站位。

Shot 级数据：

```ts
type ComicShot = {
  id: string;
  title: string;
  castCharacterIds: string[];
  sceneSnapshot: unknown;
  shotCanvasPrompt: string;
  manualShotPrompt: string;
  controlNet?: ShotControlNetSettings;
  references?: ShotReferenceSettings;
};
```

Shot 字段规则：

- `castCharacterIds` 表示当前 shot 实际出场角色。
- `sceneSnapshot` 保存当前 shot 的 canvas 状态。
- `shotCanvasPrompt` 描述当前 shot 从 canvas 得到的可见元素、局部场景、构图、前后景、道具、空间关系。
- `manualShotPrompt` 描述当前 shot 动作、镜头、表情、互动方向、人数标签和位置标签，例如 `solo`、`2 people`、`A left, B right`。
- shot 级 `references` 只保存当前 shot 特有 reference；角色 reference 仍从 `characters` 按 cast 合并。

### UI / 工作流

Sequence 编辑区应展示以下层级：

- Sequence Style：统一画风、媒介、渲染语言、系列级 aesthetic。
- Sequence Environment：长期稳定的地点、世界观、天气、时代、背景设定。
- Characters：角色库列表，每个角色有名称、Reference Prompt 和 references。
- Shots：每个 shot 显示标题、出场角色、Shot Canvas Prompt、Manual Shot Prompt 和 reference/ControlNet 状态。

推荐交互：

- 创建 sequence 时，用户先确认全局 style/environment 和角色库，再生成或编辑 shots。
- 每个 shot 卡片提供 cast 多选，不出场的角色默认不参与 prompt 合并。
- shot prompt 面板应并排或分区显示 `shotCanvasPrompt` 与 `manualShotPrompt`，避免用户把角色外观写进 shot prompt。
- 当系统检测到 shot prompt 中疑似完整角色外观重复时，可提示用户移动到 Character Reference Prompt，但 MVP 不强制自动改写。
- 单个 shot 打开 canvas 编辑时，UI 标记当前正在编辑的是 shot-level canvas state，而不是 sequence-level role/style state。

### AI Storyboard 变更

当前 storyboard 输入有 `globalPrompt` 作为上下文，但输出只有 `{ title, prompt }`。推荐分阶段演进。

MVP 输出：

```ts
type StoryboardShotDraft = {
  title: string;
  castCharacterIds: string[];
  shotPrompt: string;
};
```

MVP 规则：

- AI 可以读取 globalPrompt、sequence style、environment、characters 作为上下文。
- AI 输出 `castCharacterIds` 和 `shotPrompt`。
- `shotPrompt` 写入 `manualShotPrompt`。
- MVP 不要求 AI 生成 `shotCanvasPrompt`，除非已有 canvas snapshot 可稳定转换。

后续输出：

```ts
type StoryboardShotDraftV2 = {
  title: string;
  castCharacterIds: string[];
  canvasPromptPatch?: string;
  shotPrompt: string;
};
```

后续规则：

- `canvasPromptPatch` 可作为 `shotCanvasPrompt` 的建议或 patch 来源。
- AI 不应在 `shotPrompt` 中重复角色完整外观。
- AI 应根据 cast 输出人数标签和相对站位，例如 `solo`、`2 people`、`A on the left, B on the right`。

### Prompt 合并规则

Stable Diffusion / Illustrious positive prompt 推荐顺序：

1. Quality / aesthetic tags。
2. Sequence style prompt。
3. Checkpoint trigger words。
4. 当前 shot 的 cast character prompts。
5. Character LoRA trigger words。
6. Sequence environment prompt。
7. Shot Canvas Prompt。
8. Manual Shot Prompt。
9. Camera / lighting / detail fragments。

合并约束：

- 只合并当前 shot `castCharacterIds` 对应角色的 Character Reference Prompt 和 references。
- Character Reference Prompt 不应重复进入 Canvas prompt 或 Manual shot prompt。
- `shotCanvasPrompt` 不应包含完整人物身份、固定外观、全局画风。
- `manualShotPrompt` 可以包含临时动作、表情、镜头、互动、人数标签和左右关系。
- LoRA trigger 与 LoRA 配置应通过资源选择和 workflow builder 管理，避免把 `<lora:...>` 语法直接塞进可编辑 prompt 文本。
- Illustrious 分段重排应尊重以上语义层级，而不是把所有片段当作一段未分类 prompt。

### 二次编辑规则

当用户从某个 shot 回到 canvas 二次编辑并保存回 shot：

- 自动更新 `sceneSnapshot`。
- 自动更新 `shotCanvasPrompt`。
- 自动更新当前 shot 的 ControlNet previews/settings。
- 保留 `stylePrompt`。
- 保留 `environmentPrompt`。
- 保留 `characters[].prompt`。
- 保留 `manualShotPrompt`。
- 保留其他 shot 的 scene snapshot、canvas prompt、manual shot prompt 和 cast。

只有当用户明确执行 `Sync character/reference from canvas` 或等价操作时，系统才允许用 canvas 当前状态更新角色库的 Character Reference Prompt 或 references。

如果 canvas 中出现未在 cast 中声明的角色：

- MVP 应提示用户补充 cast，或将该可见人物作为 shot-local extra 描述加入 `shotCanvasPrompt`。
- 不应自动创建长期角色，除非用户明确保存为 sequence character。

### 多人 / Reference 规则

- Sequence 必须维护角色库 `characters`。
- 每个 shot 必须维护 `castCharacterIds`。
- ComfyUI reference 合并只使用当前 shot cast 中角色的 references。
- Shot 1 cast 为 `[A]` 时，只合并 A 的 prompt/reference。
- Shot 2 cast 为 `[A, B]` 时，合并 A+B 的 prompt/reference，并要求 manual prompt 表达人数和站位。
- 若用户删除角色，系统需要提示受影响 shots，并要求重新分配 cast 或移除该角色引用。
- 若多个角色共享相似特征，角色 prompt 应保留可区分身份 token、服装差异或稳定视觉锚点。

### MVP 阶段拆分

Issue 1: 新数据模型

- 用户价值：保存的 comic sequence 可以表达全局 style/environment、角色库、shot cast 和分层 prompt。
- Scope：定义并保存新的 Comic Sequence 分层 prompt 结构；新建 sequence 使用 `stylePrompt`、`environmentPrompt`、`characters`、`castCharacterIds`、`shotCanvasPrompt`、`manualShotPrompt`。
- Non-goals：不改 AI storyboard 输出；不重做 UI。
- Data/model implications：新增 `stylePrompt`、`environmentPrompt`、`characters`、`castCharacterIds`、`shotCanvasPrompt`、`manualShotPrompt`。
- Validation：新建 sequence round-trip 保存加载；缺失新字段时仅对新结构提供默认值；不包含旧数据迁移用例。

Issue 2: Sequence / Character / Shot Prompt UI

- 用户价值：用户能清楚编辑全局风格、环境、角色库和每个 shot 的局部 prompt。
- Scope：在 Comic Sequence UI 中展示和编辑分层字段；shot cast 多选；二次编辑保存规则提示。
- Non-goals：不实现复杂多人 3D pose 同步。
- Data/model implications：UI 写入 Issue 1 的字段；不改变 ComfyUI 执行路径。
- Validation：手动编辑 style/environment/character/shot 字段后保存加载一致；不同 shot cast 不互相污染。

Issue 3: Prompt 合并与 ComfyUI 集成

- 用户价值：最终 positive prompt 更短、更稳定，并且只包含当前 shot 出场角色。
- Scope：按推荐顺序合并 prompt；reference.characterPrompt 使用角色库；当前 shot 只合并 cast references；Illustrious 分段重排遵守语义层级。
- Non-goals：不改变 checkpoint/LoRA 资源选择 UI。
- Data/model implications：ComfyUI request builder 读取 sequence/character/shot 分层字段。
- Validation：单人 shot、双人 shot、无角色环境 shot 的最终 prompt 和 references 符合预期。

Issue 4: AI Storyboard Cast-aware MVP

- 用户价值：AI storyboard 生成分镜时能选择出场角色，不再把全局 prompt 复制到每个 shot。
- Scope：storyboard 输出 `{ title, castCharacterIds, shotPrompt }`；写入 `manualShotPrompt`；使用角色库作为上下文。
- Non-goals：不生成复杂 canvas prompt patch。
- Data/model implications：LLM response schema 需要校验 cast id 是否存在。
- Validation：AI 输出不存在的角色 id 时有降级或错误提示；生成 shot 不重复完整角色外观。

Issue 5: Shot-to-canvas 二次编辑保护

- 用户价值：用户调整单个 shot 构图或 ControlNet 时，不会意外改坏全局角色和手写动作。
- Scope：保存回 shot 时只更新 `sceneSnapshot`、`shotCanvasPrompt`、ControlNet previews/settings；显式 sync 才更新 character/reference。
- Non-goals：不实现角色库自动抽取。
- Data/model implications：需要区分 shot-local save 与 character sync 操作。
- Validation：回 canvas 编辑 shot 后，style/environment/character/manual prompt 保持不变；显式 sync 后才改变角色字段。

### 旧数据策略

- 本计划不迁移旧 `savedComicSequence` 数据。
- 新 Comic Sequence prompt 架构只保证新建 sequence 的保存、加载和生成行为。
- 如果旧 sequence 缺少新字段，MVP 可以阻止进入新架构编辑流程，并提示用户重新创建 sequence。
- 旧数据继续按现有路径处理或由后续独立任务决定；本计划不要求兼容旧数据生成结果。

### 验收标准

- 新建 comic sequence 时，可以分别维护 sequence style、sequence environment、characters 和 shots。
- Character Reference Prompt 是角色外观/身份的唯一权威来源；默认 shot prompt 不重复完整角色外观。
- 每个 shot 可以选择不同 cast，最终 prompt/reference 只包含当前 shot 出场角色。
- Shot Canvas Prompt 只表达当前 shot canvas 的可见元素、局部场景和构图。
- Manual Shot Prompt 表达当前 shot 动作、镜头、表情、互动、人数和相对站位。
- AI storyboard MVP 至少能输出 shot title、castCharacterIds 和 manual shot prompt。
- 单个 shot 回 canvas 编辑并保存后，只更新 shot-local canvas/snapshot/ControlNet 字段。
- 显式 sync character/reference from canvas 才会更新角色库 prompt/reference。
- 新建 saved comic sequence 可以保存、加载并生成；旧 saved comic sequence 迁移不作为验收要求。
- Stable Diffusion / Illustrious positive prompt 按语义层级合并，且不把 `<lora:...>` 语法写入普通 prompt 文本。

### 风险

- 从当前 canvas prompt 初始化新 sequence 时，prompt 中可能混有风格、环境、角色、动作和镜头，自动拆分无法完全可靠。
- 用户可能继续把角色外观写进 Manual Shot Prompt，需要 UI 提示和文案引导。
- 多人角色 reference 合并可能增加 ComfyUI workflow 复杂度，尤其是 ControlNet、IPAdapter 或区域 conditioning 组合。
- Illustrious 分段重排若仍按纯文本处理，可能破坏新分层顺序。
- AI storyboard cast id 输出需要严格校验，否则会产生不存在角色或漏角色。
- 二次编辑 save/sync 入口如果不清晰，用户可能误以为 canvas 编辑会自动更新角色库。

### 验证建议

- 单元测试：新 Comic Sequence prompt schema 的默认值、round-trip 保存加载；不覆盖旧数据迁移。
- 单元测试：prompt 合并顺序、cast 过滤、空 cast、多 cast、角色删除后的降级行为。
- 单元测试：AI storyboard response schema 校验，尤其是无效 `castCharacterIds`。
- 集成测试：ComfyUI request builder 对单人 shot、双人 shot、环境 shot 的 positive prompt 和 references 输出。
- 回归测试：shot 回 canvas 二次编辑只更新 shot-local 字段，不改 sequence 和 character 字段。
- 手动 QA：创建 A 单人 shot、A+B 双人 shot、只环境 shot，检查 UI、保存加载、最终 prompt 和 reference 合并结果。
