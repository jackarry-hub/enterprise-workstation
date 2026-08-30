import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QuantXY 企业工作站",
    short_name: "QuantXY",
    description: "企业项目、审批、知识、AI 与 Agent 工作站",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7faff",
    theme_color: "#2f7df6",
    orientation: "any",
    lang: "zh-CN",
    categories: ["business", "productivity"],
    icons: [
      { src: "/brand/quantxy-app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/brand/quantxy-app-icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
