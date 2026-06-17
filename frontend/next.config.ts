import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Export estático (SPA) para Cloudflare Pages: `next build` genera ./out con
  // HTML/CSS/JS servibles desde el CDN. La app es 100% cliente y habla con el
  // backend .NET vía NEXT_PUBLIC_API_URL.
  output: "export",
  // No se usa next/image; con el export estático hay que desactivar la
  // optimización por servidor.
  images: { unoptimized: true },
};

export default nextConfig;
