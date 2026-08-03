import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.*"],
  serverExternalPackages: ["onnxruntime-node"],
  outputFileTracingIncludes: {
    "/api/agent-timeline/krea2-reid-reference": [
      "./src/features/agent-timeline/assets/face_detection_yunet_2023mar_int8.onnx",
    ],
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/civitai-lora-library/images/:filename",
          destination: "/api/civitai-lora-library/images?filename=:filename",
        },
      ],
    };
  },
};

export default nextConfig;
