import type { SavedComicSequence, SavedComicSequenceShot, SavedComfyUiGenerationParams } from "@/shared/types";

export type ComicSequenceShotSettingsPatch = Partial<
  Omit<SavedComicSequenceShot, "createdAt" | "id" | "shotPrompt" | "title" | "updatedAt">
>;

type ApplyComicSequenceShotSettingsOptions = {
  defaults?: SavedComfyUiGenerationParams;
  selectedShotId: string;
  syncDown: boolean;
  updatedAt?: string;
};

function cloneSerializable<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneShotSettingsPatch(patch: ComicSequenceShotSettingsPatch): ComicSequenceShotSettingsPatch {
  const next: ComicSequenceShotSettingsPatch = {
    ...patch,
  };

  if (patch.scene) {
    next.scene = cloneSerializable(patch.scene);
  }
  if (patch.parameters) {
    next.parameters = cloneSerializable(patch.parameters);
  }
  if (patch.controlNets) {
    next.controlNets = cloneSerializable(patch.controlNets);
  }
  if (patch.reference) {
    next.reference = cloneSerializable(patch.reference);
  }
  if (patch.boundImageIds) {
    next.boundImageIds = [...patch.boundImageIds];
  }
  if ("previousShotReference" in patch) {
    next.previousShotReference = patch.previousShotReference
      ? cloneSerializable(patch.previousShotReference)
      : undefined;
  }

  return next;
}

export function applyComicSequenceShotSettingsPatch(
  shot: SavedComicSequenceShot,
  patch: ComicSequenceShotSettingsPatch,
  updatedAt: string,
): SavedComicSequenceShot {
  return {
    ...shot,
    ...cloneShotSettingsPatch(patch),
    title: shot.title,
    shotPrompt: shot.shotPrompt,
    updatedAt,
  };
}

export function applyComicSequenceShotSettingsPatchToSequence(
  sequence: SavedComicSequence,
  patch: ComicSequenceShotSettingsPatch,
  options: ApplyComicSequenceShotSettingsOptions,
): SavedComicSequence {
  const selectedIndex = sequence.shots.findIndex((shot) => shot.id === options.selectedShotId);
  if (selectedIndex < 0) {
    return sequence;
  }

  const updatedAt = options.updatedAt ?? new Date().toISOString();

  return {
    ...sequence,
    ...(options.defaults ? { defaults: options.defaults } : {}),
    shots: sequence.shots.map((shot, index) => {
      const shouldPatch = options.syncDown ? index >= selectedIndex : shot.id === options.selectedShotId;
      return shouldPatch ? applyComicSequenceShotSettingsPatch(shot, patch, updatedAt) : shot;
    }),
  };
}

export function bindComicSequenceShotImageIds(
  sequence: SavedComicSequence,
  shotId: string,
  imageIds: string[],
  options: { limit?: number; updatedAt?: string } = {},
): SavedComicSequence {
  const cleanImageIds = imageIds
    .map((imageId) => imageId.trim())
    .filter((imageId, index, ids) => imageId.length > 0 && ids.indexOf(imageId) === index);
  if (cleanImageIds.length === 0) {
    return sequence;
  }

  const updatedAt = options.updatedAt ?? new Date().toISOString();
  const limit = Math.max(1, Math.floor(options.limit ?? 12));
  let changed = false;

  const shots = sequence.shots.map((shot) => {
    if (shot.id !== shotId) {
      return shot;
    }

    const currentIds = shot.boundImageIds ?? [];
    const nextIds = [
      ...cleanImageIds,
      ...currentIds.filter((imageId) => !cleanImageIds.includes(imageId)),
    ].slice(0, limit);
    if (
      currentIds.length === nextIds.length &&
      currentIds.every((imageId, index) => imageId === nextIds[index])
    ) {
      return shot;
    }

    changed = true;
    return {
      ...shot,
      boundImageIds: nextIds,
      updatedAt,
    };
  });

  return changed ? { ...sequence, shots } : sequence;
}
