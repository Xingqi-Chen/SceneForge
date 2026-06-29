import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.*"],
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
