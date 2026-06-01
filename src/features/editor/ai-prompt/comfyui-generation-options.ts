export const COMFYUI_SAMPLER_OPTIONS = [
  { value: "euler", label: "Euler" },
  { value: "euler_cfg_pp", label: "Euler CFG++" },
  { value: "euler_ancestral", label: "Euler ancestral" },
  { value: "euler_ancestral_cfg_pp", label: "Euler ancestral CFG++" },
  { value: "heun", label: "Heun" },
  { value: "heunpp2", label: "Heun++ 2" },
  { value: "exp_heun_2_x0", label: "Exp Heun 2 x0" },
  { value: "exp_heun_2_x0_sde", label: "Exp Heun 2 x0 SDE" },
  { value: "dpm_2", label: "DPM 2" },
  { value: "dpm_2_ancestral", label: "DPM 2 ancestral" },
  { value: "lms", label: "LMS" },
  { value: "dpm_fast", label: "DPM fast" },
  { value: "dpm_adaptive", label: "DPM adaptive" },
  { value: "dpmpp_2s_ancestral", label: "DPM++ 2S ancestral" },
  { value: "dpmpp_2s_ancestral_cfg_pp", label: "DPM++ 2S ancestral CFG++" },
  { value: "dpmpp_sde", label: "DPM++ SDE" },
  { value: "dpmpp_sde_gpu", label: "DPM++ SDE GPU" },
  { value: "dpmpp_2m", label: "DPM++ 2M" },
  { value: "dpmpp_2m_cfg_pp", label: "DPM++ 2M CFG++" },
  { value: "dpmpp_2m_sde", label: "DPM++ 2M SDE" },
  { value: "dpmpp_2m_sde_gpu", label: "DPM++ 2M SDE GPU" },
  { value: "dpmpp_2m_sde_heun", label: "DPM++ 2M SDE Heun" },
  { value: "dpmpp_2m_sde_heun_gpu", label: "DPM++ 2M SDE Heun GPU" },
  { value: "dpmpp_3m_sde", label: "DPM++ 3M SDE" },
  { value: "dpmpp_3m_sde_gpu", label: "DPM++ 3M SDE GPU" },
  { value: "ddpm", label: "DDPM" },
  { value: "lcm", label: "LCM" },
  { value: "ipndm", label: "IPNDM" },
  { value: "ipndm_v", label: "IPNDM V" },
  { value: "deis", label: "DEIS" },
  { value: "res_multistep", label: "RES multistep" },
  { value: "res_multistep_cfg_pp", label: "RES multistep CFG++" },
  { value: "res_multistep_ancestral", label: "RES multistep ancestral" },
  { value: "res_multistep_ancestral_cfg_pp", label: "RES multistep ancestral CFG++" },
  { value: "gradient_estimation", label: "Gradient estimation" },
  { value: "gradient_estimation_cfg_pp", label: "Gradient estimation CFG++" },
  { value: "er_sde", label: "ER SDE" },
  { value: "seeds_2", label: "SEEDS 2" },
  { value: "seeds_3", label: "SEEDS 3" },
  { value: "sa_solver", label: "SA Solver" },
  { value: "sa_solver_pece", label: "SA Solver PECE" },
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
  { value: "linear_quadratic", label: "Linear quadratic" },
  { value: "kl_optimal", label: "KL optimal" },
] as const;

type ComfyUiOption = {
  label: string;
  value: string;
};

const SAMPLER_ALIASES: Record<string, string> = {
  dpm2m: "dpmpp_2m",
  dpm2mcfgpp: "dpmpp_2m_cfg_pp",
  dpm2msde: "dpmpp_2m_sde",
  dpm2msdegpu: "dpmpp_2m_sde_gpu",
  dpm2msdeheun: "dpmpp_2m_sde_heun",
  dpm2msdeheungpu: "dpmpp_2m_sde_heun_gpu",
  dpm3msde: "dpmpp_3m_sde",
  dpm3msdegpu: "dpmpp_3m_sde_gpu",
  dpmpp2m: "dpmpp_2m",
  dpmpp2mcfgpp: "dpmpp_2m_cfg_pp",
  dpmpp2msde: "dpmpp_2m_sde",
  dpmpp2msdegpu: "dpmpp_2m_sde_gpu",
  dpmpp2msdeheun: "dpmpp_2m_sde_heun",
  dpmpp2msdeheungpu: "dpmpp_2m_sde_heun_gpu",
  dpmpp2sancestralcfgpp: "dpmpp_2s_ancestral_cfg_pp",
  dpmpp3msde: "dpmpp_3m_sde",
  dpmpp3msdegpu: "dpmpp_3m_sde_gpu",
  dpmppsde: "dpmpp_sde",
  dpmppsdegpu: "dpmpp_sde_gpu",
  dpmsde: "dpmpp_sde",
  dpmsdegpu: "dpmpp_sde_gpu",
  eulera: "euler_ancestral",
  euleracfgpp: "euler_ancestral_cfg_pp",
  eulerancestral: "euler_ancestral",
  eulerancestralcfgpp: "euler_ancestral_cfg_pp",
  eulercfgpp: "euler_cfg_pp",
  resmultistep: "res_multistep",
  resmultistepancestral: "res_multistep_ancestral",
  resmultistepancestralcfgpp: "res_multistep_ancestral_cfg_pp",
  resmultistepcfgpp: "res_multistep_cfg_pp",
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

function labelComfyUiOptionValue(value: string) {
  const words = value
    .replace(/dpmpp/g, "dpm++")
    .replace(/cfg_pp/g, "cfg++")
    .split("_")
    .filter(Boolean);

  return words.map((word) => {
    const upper = word.toUpperCase();
    if (["CFG++", "DPM++", "GPU", "SDE", "DDPM", "LCM", "IPNDM", "DEIS", "RES", "ER", "SEEDS", "SA"].includes(upper)) {
      return upper;
    }

    if (/^\d+[a-z]?$/i.test(word)) {
      return word.toUpperCase();
    }

    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

export function buildComfyUiOptionsFromValues(
  values: readonly string[],
  fallbackOptions: readonly ComfyUiOption[],
) {
  const fallbackByValue = new Map(fallbackOptions.map((option) => [option.value, option]));
  const options: ComfyUiOption[] = [];
  const seenValues = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seenValues.has(trimmed)) {
      continue;
    }

    seenValues.add(trimmed);
    const fallback = fallbackByValue.get(trimmed);
    options.push(fallback ?? {
      label: labelComfyUiOptionValue(trimmed),
      value: trimmed,
    });
  }

  return options.length > 0 ? options : [...fallbackOptions];
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
