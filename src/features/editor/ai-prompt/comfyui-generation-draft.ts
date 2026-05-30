export type PromptRefreshDraft = {
  negativePrompt: string;
  positivePrompt: string;
};

export function mergeDraftWithPromptRefresh<TDraft extends PromptRefreshDraft>({
  currentDraft,
  nextDraft,
  nextPromptRefreshKey,
  previousPromptRefreshKey,
}: {
  currentDraft: TDraft | null;
  nextDraft: TDraft;
  nextPromptRefreshKey: string;
  previousPromptRefreshKey: string | null;
}): TDraft {
  if (!currentDraft || previousPromptRefreshKey === null || previousPromptRefreshKey !== nextPromptRefreshKey) {
    return nextDraft;
  }

  return {
    ...nextDraft,
    negativePrompt: currentDraft.negativePrompt,
    positivePrompt: currentDraft.positivePrompt,
  };
}
