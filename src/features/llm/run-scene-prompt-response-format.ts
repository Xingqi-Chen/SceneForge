import type { LlmJsonSchemaResponseFormat, LlmJsonSchemaValue } from "./types";

export type RunScenePromptResponseProfile = "illustrious" | "anima" | "krea2";

const stringSchema = { type: "string" } as const;
const stringArraySchema = {
  type: "array",
  items: stringSchema,
} as const;
const promptFragmentArraySchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      label: stringSchema,
      prompt: stringSchema,
    },
    required: ["label", "prompt"],
  },
} as const;

const commonProperties = {
  primaryCharacter: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: stringSchema,
      identity: stringSchema,
      publicFacts: stringArraySchema,
    },
    required: ["name", "identity", "publicFacts"],
  },
  sceneIntent: stringSchema,
  styleTone: stringSchema,
  setting: stringSchema,
  sharedFacts: stringArraySchema,
  positivePrompt: stringSchema,
  negativeSuggestions: stringArraySchema,
  style: promptFragmentArraySchema,
  camera: promptFragmentArraySchema,
  lighting: promptFragmentArraySchema,
} as const;

const commonRequired = [
  "promptProfile",
  "primaryCharacter",
  "sceneIntent",
  "styleTone",
  "setting",
  "sharedFacts",
  "positivePrompt",
  "negativeSuggestions",
  "style",
  "camera",
  "lighting",
] as const;

const illustriousSectionKeys = [
  "quality",
  "aestheticVersion",
  "rating",
  "artistStyle",
  "visualStyleAndMedium",
  "styleLoraTriggers",
  "checkpointTriggerWords",
  "subjectIdentity",
  "characterLoraTriggers",
  "unknownLoraTriggers",
  "appearancePhysicalTraits",
  "clothingAccessories",
  "poseActionExpression",
  "backgroundEnvironmentObjects",
  "spatialComposition",
  "cameraFraming",
  "lightingFocus",
  "detailResolution",
] as const;

const animaSectionKeys = [
  "qualityMetaSafety",
  "subjectCount",
  "character",
  "source",
  "artist",
  "visualStyleAndMedium",
  "general",
] as const;

const krea2SectionKeys = [
  "subjectMood",
  "subjectAttributesAndActions",
  "environmentAndBackground",
  "visualStyleAndMedium",
  "lightingColorAndTexture",
  "spatialCompositionAndFraming",
] as const;

function propertiesForKeys(
  keys: readonly string[],
  propertySchema: { readonly type: "string" } | typeof stringArraySchema,
) {
  return Object.fromEntries(keys.map((key) => [key, propertySchema]));
}

function createResponseFormat({
  profile,
  sectionName,
  sectionKeys,
  sectionPropertySchema,
}: {
  profile: RunScenePromptResponseProfile;
  sectionName: "illustriousSections" | "animaSections" | "krea2Sections";
  sectionKeys: readonly string[];
  sectionPropertySchema: { readonly type: "string" } | typeof stringArraySchema;
}): LlmJsonSchemaResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: `sceneforge_run_scene_prompt_${profile}_v1`,
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          promptProfile: { type: "string", enum: [profile] },
          ...commonProperties,
          [sectionName]: {
            type: "object",
            additionalProperties: false,
            properties: propertiesForKeys(sectionKeys, sectionPropertySchema),
            required: [...sectionKeys],
          },
        },
        required: [...commonRequired, sectionName],
      },
    },
  };
}

const runScenePromptResponseFormats = {
  illustrious: createResponseFormat({
    profile: "illustrious",
    sectionName: "illustriousSections",
    sectionKeys: illustriousSectionKeys,
    sectionPropertySchema: stringArraySchema,
  }),
  anima: createResponseFormat({
    profile: "anima",
    sectionName: "animaSections",
    sectionKeys: animaSectionKeys,
    sectionPropertySchema: stringArraySchema,
  }),
  krea2: createResponseFormat({
    profile: "krea2",
    sectionName: "krea2Sections",
    sectionKeys: krea2SectionKeys,
    sectionPropertySchema: stringSchema,
  }),
} satisfies Record<RunScenePromptResponseProfile, LlmJsonSchemaResponseFormat>;

function canonicalizeJson(value: unknown): string | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(canonicalizeJson);
    return items.some((item) => item === undefined) ? undefined : `[${items.join(",")}]`;
  }

  if (typeof value !== "object" || value === null) return undefined;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  const properties = entries.map(([key, item]) => {
    const normalized = canonicalizeJson(item);
    return normalized === undefined ? undefined : `${JSON.stringify(key)}:${normalized}`;
  });
  return properties.some((property) => property === undefined) ? undefined : `{${properties.join(",")}}`;
}

const authorizedCanonicalFormats = new Set(
  Object.values(runScenePromptResponseFormats).map(canonicalizeJson).filter((value): value is string => Boolean(value)),
);

export function getRunScenePromptResponseFormat(
  profile: RunScenePromptResponseProfile,
): LlmJsonSchemaResponseFormat {
  return runScenePromptResponseFormats[profile];
}

export function isAuthorizedRunScenePromptResponseFormat(
  value: unknown,
): value is LlmJsonSchemaResponseFormat {
  const canonical = canonicalizeJson(value);
  return canonical !== undefined && authorizedCanonicalFormats.has(canonical);
}

export function summarizeLlmResponseFormatForLog(
  value: LlmJsonSchemaResponseFormat | undefined,
): Record<string, LlmJsonSchemaValue> | undefined {
  if (!value) return undefined;
  return {
    type: value.type,
    schemaName: value.json_schema.name,
    strict: value.json_schema.strict,
  };
}

export function createStructuredOutputErrorDetails(
  value: LlmJsonSchemaResponseFormat,
  upstreamStatus: number | undefined,
): Record<string, LlmJsonSchemaValue> {
  return {
    code: "structured_output_rejected",
    upstreamStatus: upstreamStatus ?? 500,
    responseFormat: summarizeLlmResponseFormatForLog(value) ?? null,
  };
}
