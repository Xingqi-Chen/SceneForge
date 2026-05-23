import type {
  ArtistStringCategory,
  ArtistStringPlatformDefinition,
  ArtistStringPlatformId,
} from "./types";

export const NAI_BOT_ARTISTS_GALLERY_PLATFORM = {
  id: "nai_bot_artists_gallery",
  name: "nai-bot 300 artists gallery",
  sourceUrl: "https://nai-bot.pages.dev/%E6%B3%95%E5%85%B8/artists-gallery/",
  promptFormat: "novelai",
} satisfies ArtistStringPlatformDefinition;

export const ARTIST_STRING_PLATFORMS = [
  NAI_BOT_ARTISTS_GALLERY_PLATFORM,
] satisfies ArtistStringPlatformDefinition[];

export const NAI_BOT_ARTISTS_GALLERY_CATEGORIES = [
  {
    key: "independent",
    name: "独立风格",
    description: "不以 wlop、老五样为主的创新画风组合。",
    startSequence: 0,
    endSequence: 267,
  },
  {
    key: "wlop",
    name: "wlop系",
    description: "厚涂、写实、背景丰富。",
    startSequence: 268,
    endSequence: 282,
  },
  {
    key: "weak-wlop",
    name: "弱wlop系",
    description: "以 wlop 为底，融合其他画师特点。",
    startSequence: 283,
    endSequence: 311,
  },
  {
    key: "classic-five",
    name: "老五样系",
    description: "二次元风格，人体较好，色彩鲜艳。",
    startSequence: 312,
    endSequence: 320,
  },
  {
    key: "weak-classic",
    name: "弱老五样系",
    description: "以老五样为底，融合其他画师特点。",
    startSequence: 321,
    endSequence: 353,
  },
  {
    key: "fusion",
    name: "wlop和老五样的融合",
    description: "wlop 与老五样融合的组合。",
    startSequence: 354,
    endSequence: 363,
  },
  {
    key: "custom",
    name: "法典编撰者的融合和微调",
    description: "编撰者精心调试的独特组合。",
    startSequence: 364,
    endSequence: 418,
  },
  {
    key: "special",
    name: "其他",
    description: "像素、黑白肖像、手办等特殊艺术风格。",
    startSequence: 419,
    endSequence: null,
  },
] satisfies ArtistStringCategory[];

export function getArtistStringPlatformDefinition(
  platformId: string | null | undefined,
): ArtistStringPlatformDefinition | null {
  return ARTIST_STRING_PLATFORMS.find((platform) => platform.id === platformId) ?? null;
}

export function isArtistStringPlatformId(value: unknown): value is ArtistStringPlatformId {
  return typeof value === "string" && getArtistStringPlatformDefinition(value) !== null;
}

export function getNaiBotArtistsGalleryCategory(sequence: number): ArtistStringCategory {
  return (
    NAI_BOT_ARTISTS_GALLERY_CATEGORIES.find(
      (category) =>
        sequence >= category.startSequence &&
        (category.endSequence === null || sequence <= category.endSequence),
    ) ?? NAI_BOT_ARTISTS_GALLERY_CATEGORIES[NAI_BOT_ARTISTS_GALLERY_CATEGORIES.length - 1]!
  );
}
