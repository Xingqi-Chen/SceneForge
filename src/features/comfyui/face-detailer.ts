export const DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL = "bbox/face_yolov8m.pt";

export const COMFYUI_FACE_DETAILER_DETECTOR_MODEL_PREFERENCES = [
  DEFAULT_COMFYUI_FACE_DETAILER_DETECTOR_MODEL,
  "bbox/face_yolov8s.pt",
  "bbox/face_yolov8n.pt",
  "face_yolov8m.pt",
  "face_yolov8s.pt",
  "face_yolov8n.pt",
] as const;

export const COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS = [
  { label: "center-1", value: "center-1" },
  { label: "horizontal-2", value: "horizontal-2" },
  { label: "vertical-2", value: "vertical-2" },
  { label: "rect-4", value: "rect-4" },
  { label: "diamond-4", value: "diamond-4" },
  { label: "mask-area", value: "mask-area" },
  { label: "mask-points", value: "mask-points" },
  { label: "mask-point-bbox", value: "mask-point-bbox" },
  { label: "none", value: "none" },
] as const;

export const COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS = [
  { label: "False", value: "False" },
  { label: "Small", value: "Small" },
  { label: "Outter", value: "Outter" },
] as const;

export type ComfyUiFaceDetailerSamDetectionHint =
  (typeof COMFYUI_FACE_DETAILER_SAM_DETECTION_HINT_OPTIONS)[number]["value"];

export type ComfyUiFaceDetailerSamMaskHintUseNegative =
  (typeof COMFYUI_FACE_DETAILER_SAM_MASK_HINT_USE_NEGATIVE_OPTIONS)[number]["value"];

export const COMFYUI_FACE_DETAILER_DEFAULTS = {
  bboxCropFactor: 3,
  bboxDilation: 10,
  bboxThreshold: 0.5,
  cycle: 1,
  denoise: 0.5,
  dropSize: 10,
  feather: 5,
  forceInpaint: true,
  guideSize: 512,
  guideSizeFor: true,
  maxSize: 1024,
  noiseMask: true,
  samBBoxExpansion: 0,
  samDetectionHint: "center-1",
  samDilation: 0,
  samMaskHintThreshold: 0.7,
  samMaskHintUseNegative: "False",
  samThreshold: 0.93,
  wildcard: "",
} as const;
