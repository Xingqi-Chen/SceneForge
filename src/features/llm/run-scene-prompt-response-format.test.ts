import { describe, expect, it } from "vitest";

import {
  getRunScenePromptResponseFormat,
  isAuthorizedRunScenePromptResponseFormat,
  summarizeLlmResponseFormatForLog,
  type RunScenePromptResponseProfile,
} from "./run-scene-prompt-response-format";

const profiles = ["illustrious", "anima", "krea2"] as const;
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
];
const sectionNames = {
  illustrious: "illustriousSections",
  anima: "animaSections",
  krea2: "krea2Sections",
} as const;
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
];
const animaSectionKeys = [
  "qualityMetaSafety",
  "subjectCount",
  "character",
  "source",
  "artist",
  "visualStyleAndMedium",
  "general",
];
const krea2SectionKeys = [
  "subjectMood",
  "subjectAttributesAndActions",
  "environmentAndBackground",
  "visualStyleAndMedium",
  "lightingColorAndTexture",
  "spatialCompositionAndFraming",
];

function schemaFor(profile: RunScenePromptResponseProfile) {
  return getRunScenePromptResponseFormat(profile).json_schema.schema as Record<string, unknown>;
}

function objectValue(value: unknown) {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

describe("Run scene-prompt response formats", () => {
  it.each(profiles)("uses a stable strict schema name for %s", (profile) => {
    const responseFormat = getRunScenePromptResponseFormat(profile);

    expect(responseFormat.type).toBe("json_schema");
    expect(responseFormat.json_schema).toMatchObject({
      name: `sceneforge_run_scene_prompt_${profile}_v1`,
      strict: true,
    });
  });

  it.each(profiles)("closes the %s root and shared nested object contracts", (profile) => {
    const schema = schemaFor(profile);
    const properties = objectValue(schema.properties);
    const sectionName = sectionNames[profile];

    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(schema.required).toEqual([...commonRequired, sectionName]);
    expect(Object.keys(properties)).toEqual([...commonRequired, sectionName]);
    expect(properties.promptProfile).toEqual({ type: "string", enum: [profile] });

    const primaryCharacter = objectValue(properties.primaryCharacter);
    expect(primaryCharacter).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["name", "identity", "publicFacts"],
    });
    expect(Object.keys(objectValue(primaryCharacter.properties))).toEqual([
      "name",
      "identity",
      "publicFacts",
    ]);

    for (const field of ["style", "camera", "lighting"] as const) {
      const fragmentArray = objectValue(properties[field]);
      const item = objectValue(fragmentArray.items);
      expect(fragmentArray.type).toBe("array");
      expect(item).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["label", "prompt"],
      });
      expect(item.properties).toEqual({
        label: { type: "string" },
        prompt: { type: "string" },
      });
    }

    expect(properties.negativeSuggestions).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it.each([
    ["illustrious", "illustriousSections", illustriousSectionKeys],
    ["anima", "animaSections", animaSectionKeys],
  ] as const)("requires the complete %s string-array section contract", (profile, sectionName, keys) => {
    const section = objectValue(objectValue(schemaFor(profile).properties)[sectionName]);
    const properties = objectValue(section.properties);

    expect(section).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: keys,
    });
    expect(Object.keys(properties)).toEqual(keys);
    for (const key of keys) {
      expect(properties[key]).toEqual({
        type: "array",
        items: { type: "string" },
      });
    }
  });

  it("requires exactly Krea's six prose strings and excludes local LoRA trigger words", () => {
    const responseFormat = getRunScenePromptResponseFormat("krea2");
    const section = objectValue(objectValue(schemaFor("krea2").properties).krea2Sections);
    const properties = objectValue(section.properties);

    expect(section).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: krea2SectionKeys,
    });
    expect(Object.keys(properties)).toEqual(krea2SectionKeys);
    for (const key of krea2SectionKeys) {
      expect(properties[key]).toEqual({ type: "string" });
    }
    expect(JSON.stringify(responseFormat)).not.toContain("selectedLoraTriggerWords");
  });

  it("authorizes only the three exact server-authored contracts", () => {
    for (const profile of profiles) {
      const exactClone = JSON.parse(JSON.stringify(getRunScenePromptResponseFormat(profile)));
      expect(isAuthorizedRunScenePromptResponseFormat(exactClone)).toBe(true);
    }

    const changedName = JSON.parse(JSON.stringify(getRunScenePromptResponseFormat("illustrious")));
    changedName.json_schema.name = "arbitrary_schema";
    expect(isAuthorizedRunScenePromptResponseFormat(changedName)).toBe(false);

    const loosenedRoot = JSON.parse(JSON.stringify(getRunScenePromptResponseFormat("anima")));
    loosenedRoot.json_schema.schema.additionalProperties = true;
    expect(isAuthorizedRunScenePromptResponseFormat(loosenedRoot)).toBe(false);

    const extraProperty = JSON.parse(JSON.stringify(getRunScenePromptResponseFormat("krea2")));
    extraProperty.json_schema.schema.properties.unexpected = { type: "string" };
    expect(isAuthorizedRunScenePromptResponseFormat(extraProperty)).toBe(false);

    expect(isAuthorizedRunScenePromptResponseFormat({ type: "json_object" })).toBe(false);
    expect(isAuthorizedRunScenePromptResponseFormat(null)).toBe(false);
  });

  it("summarizes only type, stable name, and strictness for logs", () => {
    const responseFormat = getRunScenePromptResponseFormat("anima");

    expect(summarizeLlmResponseFormatForLog(responseFormat)).toEqual({
      type: "json_schema",
      schemaName: "sceneforge_run_scene_prompt_anima_v1",
      strict: true,
    });
    expect(JSON.stringify(summarizeLlmResponseFormatForLog(responseFormat))).not.toContain("properties");
    expect(summarizeLlmResponseFormatForLog(undefined)).toBeUndefined();
  });
});
