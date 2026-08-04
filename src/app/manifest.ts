import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lucky",
    short_name: "Lucky",
    description: "최근 로또 흐름을 AI로 분석하는 Lucky",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f4ed",
    theme_color: "#0d4d35",
    lang: "ko",
    icons: [
      {
        src: "/icons/lucky-icon.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/lucky-icon.png",
        sizes: "1254x1254",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
