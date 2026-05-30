export type ComicSequenceSubmitMode = "sequence" | "shot";

export type ComicSequenceGenerationPlan<Shot, Result> = {
  selectedShotIndex: number;
  shotsToGenerate: Shot[];
  retainedResults: Result[];
};

export function planComicSequenceGeneration<Shot extends { id: string }, Result extends { shotId?: string }>({
  mode,
  results,
  selectedShotId,
  shots,
}: {
  mode: ComicSequenceSubmitMode;
  results: Result[];
  selectedShotId?: string;
  shots: Shot[];
}): ComicSequenceGenerationPlan<Shot, Result> {
  const selectedShotIndex = selectedShotId ? shots.findIndex((shot) => shot.id === selectedShotId) : 0;
  const startIndex = selectedShotIndex >= 0 ? selectedShotIndex : 0;
  const shotIndexById = new Map(shots.map((shot, index) => [shot.id, index]));
  const selectedShot = shots[startIndex];
  const shotsToGenerate = mode === "shot"
    ? selectedShot ? [selectedShot] : []
    : shots.slice(startIndex);
  const generatedShotIds = new Set(shotsToGenerate.map((shot) => shot.id));
  const retainedResults = results.filter((result) => {
    const shotId = result.shotId;
    if (!shotId) {
      return false;
    }

    const shotIndex = shotIndexById.get(shotId);
    if (shotIndex === undefined) {
      return false;
    }

    return mode === "shot" ? !generatedShotIds.has(shotId) : shotIndex < startIndex;
  });

  return {
    retainedResults,
    selectedShotIndex: startIndex,
    shotsToGenerate,
  };
}
