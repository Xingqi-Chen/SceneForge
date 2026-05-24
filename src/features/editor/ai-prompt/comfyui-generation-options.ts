export const COMFYUI_SAMPLER_OPTIONS = [
  { value: "euler", label: "Euler" },
  { value: "euler_ancestral", label: "Euler ancestral" },
  { value: "heun", label: "Heun" },
  { value: "dpm_2", label: "DPM 2" },
  { value: "dpm_2_ancestral", label: "DPM 2 ancestral" },
  { value: "lms", label: "LMS" },
  { value: "dpm_fast", label: "DPM fast" },
  { value: "dpm_adaptive", label: "DPM adaptive" },
  { value: "dpmpp_2s_ancestral", label: "DPM++ 2S ancestral" },
  { value: "dpmpp_sde", label: "DPM++ SDE" },
  { value: "dpmpp_sde_gpu", label: "DPM++ SDE GPU" },
  { value: "dpmpp_2m", label: "DPM++ 2M" },
  { value: "dpmpp_2m_sde", label: "DPM++ 2M SDE" },
  { value: "dpmpp_2m_sde_gpu", label: "DPM++ 2M SDE GPU" },
  { value: "dpmpp_3m_sde", label: "DPM++ 3M SDE" },
  { value: "dpmpp_3m_sde_gpu", label: "DPM++ 3M SDE GPU" },
  { value: "ddpm", label: "DDPM" },
  { value: "lcm", label: "LCM" },
  { value: "ddim", label: "DDIM" },
  { value: "uni_pc", label: "UniPC" },
  { value: "uni_pc_bh2", label: "UniPC BH2" },
] as const;

export const COMFYUI_SCHEDULER_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "karras", label: "Karras" },
  { value: "exponential", label: "Exponential" },
  { value: "sgm_uniform", label: "SGM uniform" },
  { value: "simple", label: "Simple" },
  { value: "ddim_uniform", label: "DDIM uniform" },
  { value: "beta", label: "Beta" },
] as const;

type ComfyUiOption = {
  label: string;
  value: string;
};

const SAMPLER_ALIASES: Record<string, string> = {
  dpm2m: "dpmpp_2m",
  dpm2msde: "dpmpp_2m_sde",
  dpm2msdegpu: "dpmpp_2m_sde_gpu",
  dpm3msde: "dpmpp_3m_sde",
  dpm3msdegpu: "dpmpp_3m_sde_gpu",
  dpmpp2m: "dpmpp_2m",
  dpmpp2msde: "dpmpp_2m_sde",
  dpmpp2msdegpu: "dpmpp_2m_sde_gpu",
  dpmpp3msde: "dpmpp_3m_sde",
  dpmpp3msdegpu: "dpmpp_3m_sde_gpu",
  dpmppsde: "dpmpp_sde",
  dpmppsdegpu: "dpmpp_sde_gpu",
  dpmsde: "dpmpp_sde",
  dpmsdegpu: "dpmpp_sde_gpu",
  eulera: "euler_ancestral",
  eulerancestral: "euler_ancestral",
};

function normalizeOptionName(value: string) {
  return value.toLowerCase().replace(/\+\+/g, "pp").replace(/[^a-z0-9]+/g, "");
}

function findOptionValue(value: string | undefined, options: readonly ComfyUiOption[]) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const exact = options.find((option) => option.value === trimmed || option.label === trimmed);
  if (exact) {
    return exact.value;
  }

  const normalized = normalizeOptionName(trimmed);
  return options.find((option) => normalizeOptionName(option.value) === normalized || normalizeOptionName(option.label) === normalized)
    ?.value;
}

function findSamplerValue(value: string | undefined) {
  const optionValue = findOptionValue(value, COMFYUI_SAMPLER_OPTIONS);
  if (optionValue) {
    return optionValue;
  }

  const alias = value ? SAMPLER_ALIASES[normalizeOptionName(value)] : undefined;
  return alias && COMFYUI_SAMPLER_OPTIONS.some((option) => option.value === alias) ? alias : undefined;
}

export function normalizeComfyUiSchedulerName(value: string | undefined) {
  return findOptionValue(value, COMFYUI_SCHEDULER_OPTIONS);
}

export function normalizeComfyUiSamplerName(value: string | undefined) {
  return findSamplerValue(value);
}

export function normalizeComfyUiSamplerSettings(input: {
  samplerName?: string;
  scheduler?: string;
}) {
  const directSampler = normalizeComfyUiSamplerName(input.samplerName);
  const directScheduler = normalizeComfyUiSchedulerName(input.scheduler);
  if (directSampler) {
    return {
      samplerName: directSampler,
      scheduler: directScheduler,
    };
  }

  const rawSampler = input.samplerName?.trim();
  if (!rawSampler) {
    return {
      samplerName: undefined,
      scheduler: directScheduler,
    };
  }

  const normalizedSampler = normalizeOptionName(rawSampler);
  const schedulerOptions = [...COMFYUI_SCHEDULER_OPTIONS].sort(
    (left, right) => normalizeOptionName(right.value).length - normalizeOptionName(left.value).length,
  );

  for (const scheduler of schedulerOptions) {
    const normalizedScheduler = normalizeOptionName(scheduler.value);
    if (!normalizedSampler.endsWith(normalizedScheduler) || normalizedSampler.length <= normalizedScheduler.length) {
      continue;
    }

    const samplerName = normalizeComfyUiSamplerName(rawSampler.slice(0, -scheduler.label.length))
      ?? normalizeComfyUiSamplerName(normalizedSampler.slice(0, -normalizedScheduler.length));
    if (samplerName) {
      return {
        samplerName,
        scheduler: scheduler.value,
      };
    }
  }

  return {
    samplerName: undefined,
    scheduler: directScheduler,
  };
}

export function formatComfyUiOptionValuesForPrompt(options: readonly ComfyUiOption[]) {
  return options.map((option) => option.value).join(", ");
}
