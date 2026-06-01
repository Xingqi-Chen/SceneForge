import { describe, expect, it } from "vitest";

import {
  buildComfyUiOptionsFromValues,
  COMFYUI_SAMPLER_OPTIONS,
  COMFYUI_SCHEDULER_OPTIONS,
  normalizeComfyUiSamplerSettings,
} from "./comfyui-generation-options";

const CURRENT_COMFYUI_KSAMPLER_NAMES = [
  "euler",
  "euler_cfg_pp",
  "euler_ancestral",
  "euler_ancestral_cfg_pp",
  "heun",
  "heunpp2",
  "exp_heun_2_x0",
  "exp_heun_2_x0_sde",
  "dpm_2",
  "dpm_2_ancestral",
  "lms",
  "dpm_fast",
  "dpm_adaptive",
  "dpmpp_2s_ancestral",
  "dpmpp_2s_ancestral_cfg_pp",
  "dpmpp_sde",
  "dpmpp_sde_gpu",
  "dpmpp_2m",
  "dpmpp_2m_cfg_pp",
  "dpmpp_2m_sde",
  "dpmpp_2m_sde_gpu",
  "dpmpp_2m_sde_heun",
  "dpmpp_2m_sde_heun_gpu",
  "dpmpp_3m_sde",
  "dpmpp_3m_sde_gpu",
  "ddpm",
  "lcm",
  "ipndm",
  "ipndm_v",
  "deis",
  "res_multistep",
  "res_multistep_cfg_pp",
  "res_multistep_ancestral",
  "res_multistep_ancestral_cfg_pp",
  "gradient_estimation",
  "gradient_estimation_cfg_pp",
  "er_sde",
  "seeds_2",
  "seeds_3",
  "sa_solver",
  "sa_solver_pece",
  "ddim",
  "uni_pc",
  "uni_pc_bh2",
];

describe("ComfyUI generation options", () => {
  it("covers current ComfyUI KSampler sampler_name values", () => {
    expect(COMFYUI_SAMPLER_OPTIONS.map((option) => option.value)).toEqual(CURRENT_COMFYUI_KSAMPLER_NAMES);
  });

  it("covers current ComfyUI KSampler scheduler values", () => {
    expect(COMFYUI_SCHEDULER_OPTIONS.map((option) => option.value)).toEqual([
      "normal",
      "karras",
      "exponential",
      "sgm_uniform",
      "simple",
      "ddim_uniform",
      "beta",
      "linear_quadratic",
      "kl_optimal",
    ]);
  });

  it("normalizes current sampler and scheduler suggestions", () => {
    expect(normalizeComfyUiSamplerSettings({ samplerName: "DPM++ 2M SDE Heun GPU KL optimal" })).toEqual({
      samplerName: "dpmpp_2m_sde_heun_gpu",
      scheduler: "kl_optimal",
    });
    expect(normalizeComfyUiSamplerSettings({ samplerName: "res_multistep_cfg_pp" })).toEqual({
      samplerName: "res_multistep_cfg_pp",
      scheduler: undefined,
    });
    expect(normalizeComfyUiSamplerSettings({ samplerName: "Euler CFG++" })).toEqual({
      samplerName: "euler_cfg_pp",
      scheduler: undefined,
    });
  });

  it("builds dropdown options from runtime ComfyUI values with static labels when possible", () => {
    expect(buildComfyUiOptionsFromValues(["dpmpp_2m_sde_heun_gpu", "custom_sampler"], COMFYUI_SAMPLER_OPTIONS)).toEqual([
      { value: "dpmpp_2m_sde_heun_gpu", label: "DPM++ 2M SDE Heun GPU" },
      { value: "custom_sampler", label: "Custom Sampler" },
    ]);
  });
});
