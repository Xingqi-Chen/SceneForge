import { describe, expect, it } from "vitest";

import { createDefaultStickFigurePoseV1 } from "@/features/editor/store/defaults";

import {
  buildStickFigurePoseGenerationMessages,
  buildStickFigurePoseImageGenerationMessages,
  parseStickFigurePoseGenerationResponse,
} from "./llm-pose-generation";

describe("llm pose generation", () => {
  it("builds image pose inference messages with the same stick-pose response contract", () => {
    const messages = buildStickFigurePoseImageGenerationMessages(
      "data:image/jpeg;base64,abc",
      createDefaultStickFigurePoseV1(),
      "young hero",
      "left arm is important",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("Required JSON shape");
    expect(messages[1].content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("left arm is important"),
      }),
      {
        type: "image_url",
        image_url: {
          url: "data:image/jpeg;base64,abc",
          detail: "low",
        },
      },
    ]);
  });

  it("includes all four pole controls in text pose generation context", () => {
    const messages = buildStickFigurePoseGenerationMessages("raise the left knee", createDefaultStickFigurePoseV1());
    const content = String(messages[1].content);

    expect(messages[0].content).toContain("four visible direction balls");
    expect(content).toContain("leftElbowPole");
    expect(content).toContain("rightElbowPole");
    expect(content).toContain("leftKneePole");
    expect(content).toContain("rightKneePole");
  });

  it("parses generated pole controls and uses them to steer the solved knee", () => {
    const currentPose = createDefaultStickFigurePoseV1();
    const response = JSON.stringify({
      characterDescription: "character lifting the left knee forward",
      targets: {
        pelvis: { x: 0, y: 1.05, z: 0 },
        chest: { x: 0, y: 1.45, z: 0 },
        head: { x: 0, y: 1.7, z: 0 },
        leftHand: { x: -0.45, y: 1.2, z: 0.1 },
        rightHand: { x: 0.45, y: 1.2, z: 0.1 },
        leftFoot: { x: -0.12, y: 0.45, z: 0 },
        rightFoot: { x: 0.12, y: 0.04, z: 0 },
      },
      poles: {
        leftElbowPole: { x: -0.6, y: 1.2, z: 0.2 },
        rightElbowPole: { x: 0.6, y: 1.2, z: 0.2 },
        leftKneePole: { x: -0.12, y: 0.65, z: 1 },
        rightKneePole: { x: 0.2, y: 0.55, z: 0.3 },
      },
    });

    const result = parseStickFigurePoseGenerationResponse(response, currentPose);

    expect(result?.characterDescription).toBe("character lifting the left knee forward");
    expect(result?.pose.poles?.leftKneePole).toEqual({ x: -0.12, y: 0.65, z: 1 });
    expect(result?.pose.joints.leftKnee.z).toBeGreaterThan(0.1);
  });
});
