export type TimelineSamplerOptions = {
  samplers: string[];
  schedulers: string[];
};

export const defaultTimelineSamplerOptions: TimelineSamplerOptions = {
  samplers: ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde"],
  schedulers: ["normal", "karras"],
};

export function normalizeTimelineSamplerOptions(
  options: TimelineSamplerOptions | undefined,
): TimelineSamplerOptions {
  const samplers = options?.samplers.filter(Boolean) ?? [];
  const schedulers = options?.schedulers.filter(Boolean) ?? [];

  return {
    samplers: samplers.length > 0 ? samplers : defaultTimelineSamplerOptions.samplers,
    schedulers: schedulers.length > 0 ? schedulers : defaultTimelineSamplerOptions.schedulers,
  };
}

export function pickSupportedValue(value: string | undefined, options: string[], fallback: string) {
  if (!value) {
    return options.includes(fallback) ? fallback : options[0] ?? fallback;
  }

  if (options.includes(value)) {
    return value;
  }

  return options.includes(fallback) ? fallback : options[0] ?? fallback;
}
