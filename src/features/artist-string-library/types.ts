export type ArtistStringPromptFormat = "novelai";

export type ArtistStringPlatformId = "nai_bot_artists_gallery";

export type ArtistStringParseStatus = "parsed" | "partial" | "failed";

export type NovelAiArtistStringNode =
  | {
      type: "tag";
      text: string;
      artistPrefix: boolean;
      artistSyntax?: "artist-prefix" | "by-prefix";
      weight?: number;
      raw: string;
    }
  | {
      type: "group";
      emphasis: "increase" | "decrease";
      closed: boolean;
      nodes: NovelAiArtistStringNode[];
    }
  | {
      type: "raw";
      text: string;
    };

export type NovelAiArtistStringAst = {
  type: "novelai";
  raw: string;
  nodes: NovelAiArtistStringNode[];
  warnings: string[];
};

export type StructuredArtistString = NovelAiArtistStringAst;

export type ArtistStringPlatformDefinition = {
  id: ArtistStringPlatformId;
  name: string;
  sourceUrl: string;
  promptFormat: ArtistStringPromptFormat;
};

export type ArtistStringCategory = {
  key: string;
  name: string;
  description: string;
  startSequence: number;
  endSequence: number | null;
};

export type ArtistStringReferenceImageInput = {
  role: string;
  sourceUrl: string;
  alt: string | null;
  sortOrder: number;
};

export type ArtistStringAdapterItem = {
  platformId: ArtistStringPlatformId;
  sourceSequence: number;
  categoryKey: string;
  categoryName: string;
  rawArtistString: string;
  structuredArtistString: StructuredArtistString;
  promptFormat: ArtistStringPromptFormat;
  parseStatus: ArtistStringParseStatus;
  parseError: string | null;
  formattedPrompt: string;
  sourceUrl: string;
  referenceImages: ArtistStringReferenceImageInput[];
};

export type ArtistStringReferenceImageRecord = ArtistStringReferenceImageInput & {
  id: string;
  itemId: string;
  localUrl: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
};

export type ArtistStringItemRecord = Omit<ArtistStringAdapterItem, "referenceImages"> & {
  id: string;
  normalizedArtistString: string;
  referenceImages: ArtistStringReferenceImageRecord[];
  createdAt: string;
  updatedAt: string;
};

export type ArtistStringPlatformRecord = ArtistStringPlatformDefinition & {
  sourceUpdatedAtText: string | null;
  syncedAt: string;
  rawMetaJson: unknown;
};

export type ArtistStringCategoryCount = ArtistStringCategory & {
  count: number;
};

export type ArtistStringListFilters = {
  platformId?: ArtistStringPlatformId;
  category?: string;
  query?: string;
};

export type ArtistStringSyncResult = {
  platform: ArtistStringPlatformRecord;
  itemCount: number;
  imageCount: number;
  cachedImageCount: number;
  failedImageCount: number;
  parsedCount: number;
  partialCount: number;
  failedParseCount: number;
};
