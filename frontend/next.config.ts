import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Export estático (SPA): `next build` genera ./out, que Tauri empaqueta como
  // frontend. La app es 100 % cliente: los datos van por `lib/api.ts`.
  output: "export",
  // No se usa next/image; con el export estático hay que desactivar la
  // optimización por servidor.
  images: { unoptimized: true },
};

export default nextConfig;
