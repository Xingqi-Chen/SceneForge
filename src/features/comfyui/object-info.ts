import type { ComfyUiTextToImageRequest } from "./types";

type ComfyUiObjectInfoNode = {
  input?: {
    required?: Record<string, unknown>;
  };
};

export type ComfyUiObjectInfo = Record<string, ComfyUiObjectInfoNode>;

export type ComfyUiRequestObjectInfoValidation = {
  errors: string[];
  request: ComfyUiTextToImageRequest;
  warnings: string[];
};

const SAMPLER_ALIASES: Record<string, string> = {
  dpmpp2m: "dpmpp_2m",
  dpm2m: "dpmpp_2m",
  dpm2msde: "dpmpp_2m_sde",
  dpm2msdegpu: "dpmpp_2m_sde_gpu",
  dpmpp2msde: "dpmpp_2m_sde",
  dpmpp2msdegpu: "dpmpp_2m_sde_gpu",
  dpm3msde: "dpmpp_3m_sde",
  dpm3msdegpu: "dpmpp_3m_sde_gpu",
  dpmpp3msde: "dpmpp_3m_sde",
  dpmpp3msdegpu: "dpmpp_3m_sde_gpu",
  dpmsde: "dpmpp_sde",
  dpmsdegpu: "dpmpp_sde_gpu",
  dpmppsde: "dpmpp_sde",
  dpmppsdegpu: "dpmpp_sde_gpu",
  eulera: "euler_ancestral",
  eulerancestral: "euler_ancestral",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionName(value: string) {
  return value.toLowerCase().replace(/\+\+/g, "pp").replace(/[^a-z0-9]+/g, "");
}

function readInputOptions(objectInfo: unknown, classType: string, inputName: string): string[] {
  if (!isRecord(objectInfo)) {
    return [];
  }

  const nodeInfo = objectInfo[classType];
  if (!isRecord(nodeInfo) || !isRecord(nodeInfo.input) || !isRecord(nodeInfo.input.required)) {
    return [];
  }

  const inputInfo = nodeInfo.input.required[inputName];
  if (!Array.isArray(inputInfo) || !Array.isArray(inputInfo[0])) {
    return [];
  }

  return inputInfo[0].filter((value): value is string => typeof value === "string");
}

function findOption(value: string, options: string[]) {
  const trimmed = value.trim();
  const exact = options.find((option) => option === trimmed);
  if (exact) {
    return exact;
  }

  const normalized = normalizeOptionName(trimmed);
  return options.find((option) => normalizeOptionName(option) === normalized) ?? null;
}

function findSampler(value: string | undefined, options: string[]) {
  if (!value) {
    return null;
  }

  const direct = findOption(value, options);
  if (direct) {
    return direct;
  }

  const alias = SAMPLER_ALIASES[normalizeOptionName(value)];
  if (!alias) {
    return null;
  }

  const fallbackAlias = alias.endsWith("_gpu") ? alias.replace(/_gpu$/, "") : `${alias}_gpu`;
  return [alias, fallbackAlias].find((option) => options.includes(option)) ?? null;
}

function validateDimension(value: number | undefined, label: string, errors: string[]) {
  if (value === undefined) {
    return;
  }

  if (value < 16 || value > 16384 || value % 8 !== 0) {
    errors.push(`${label} must be between 16 and 16384 and divisible by 8 for ComfyUI EmptyLatentImage.`);
  }
}

export function validateComfyUiRequestAgainstObjectInfo(
  request: ComfyUiTextToImageRequest,
  objectInfo: unknown,
): ComfyUiRequestObjectInfoValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checkpointOptions = readInputOptions(objectInfo, "CheckpointLoaderSimple", "ckpt_name");
  const loraOptions = readInputOptions(objectInfo, "LoraLoader", "lora_name");
  const samplerOptions = readInputOptions(objectInfo, "KSampler", "sampler_name");
  const schedulerOptions = readInputOptions(objectInfo, "KSampler", "scheduler");
  const checkpointName = findOption(request.checkpointName, checkpointOptions);
  const samplerName = findSampler(request.samplerName, samplerOptions);
  const scheduler = request.scheduler ? findOption(request.scheduler, schedulerOptions) : null;
  const loras = (request.loras ?? []).map((lora, index) => {
    const loraName = findOption(lora.loraName, loraOptions);
    if (!loraName) {
      errors.push(`LoRA ${index + 1} is not available in ComfyUI: ${lora.loraName}`);
    }

    return {
      ...lora,
      loraName: loraName ?? lora.loraName,
    };
  });

  if (!checkpointName) {
    errors.push(`Checkpoint is not available in ComfyUI: ${request.checkpointName}`);
  }

  if (request.samplerName && !samplerName) {
    errors.push(`Sampler is not available in ComfyUI: ${request.samplerName}`);
  }

  if (request.scheduler && !scheduler) {
    errors.push(`Scheduler is not available in ComfyUI: ${request.scheduler}`);
  }

  validateDimension(request.width, "width", errors);
  validateDimension(request.height, "height", errors);

  if (request.samplerName && samplerName && samplerName !== request.samplerName) {
    warnings.push(`Normalized sampler ${request.samplerName} to ${samplerName}.`);
  }

  if (request.scheduler && scheduler && scheduler !== request.scheduler) {
    warnings.push(`Normalized scheduler ${request.scheduler} to ${scheduler}.`);
  }

  return {
    errors,
    warnings,
    request: {
      ...request,
      checkpointName: checkpointName ?? request.checkpointName,
      samplerName: samplerName ?? request.samplerName,
      scheduler: scheduler ?? request.scheduler,
      loras,
    },
  };
}

export function summarizeComfyUiErrorDetails(details: unknown) {
  if (!isRecord(details)) {
    return [];
  }

  const nodeErrors = isRecord(details.node_errors) ? details.node_errors : {};

  return Object.entries(nodeErrors).flatMap(([nodeId, nodeError]) => {
    if (!isRecord(nodeError)) {
      return [`Node ${nodeId}: ${String(nodeError)}`];
    }

    const classType = typeof nodeError.class_type === "string" ? nodeError.class_type : "unknown";
    const errors = Array.isArray(nodeError.errors) ? nodeError.errors : [];
    if (errors.length === 0) {
      return [`Node ${nodeId} (${classType}) failed validation.`];
    }

    return errors.map((error) => {
      if (!isRecord(error)) {
        return `Node ${nodeId} (${classType}): ${String(error)}`;
      }

      const message = typeof error.message === "string" ? error.message : "validation error";
      const detail = typeof error.details === "string" && error.details ? ` ${error.details}` : "";
      const inputName = isRecord(error.extra_info) && typeof error.extra_info.input_name === "string"
        ? ` ${error.extra_info.input_name}:`
        : "";

      return `Node ${nodeId} (${classType}):${inputName} ${message}${detail}`;
    });
  });
}
