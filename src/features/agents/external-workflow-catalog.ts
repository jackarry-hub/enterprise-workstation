export type ExternalWorkflowProvider = "image-studio" | "content-workbench";

export type ExternalWorkflowField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "files";
  required: boolean;
  options?: { label: string; value: string }[];
  accept?: string;
  multiple?: boolean;
};

export type ExternalWorkflowDefinition = {
  code: string;
  name: string;
  description: string;
  category: string;
  provider: ExternalWorkflowProvider;
  launchUrl: string;
  fields: ExternalWorkflowField[];
};

const CONTENT_BASE_URL = "https://content.quantumgalaxy.top";

export const EXTERNAL_WORKFLOW_CATALOG: readonly ExternalWorkflowDefinition[] = [
  {
    code: "family-portrait",
    name: "全家福影像制作",
    description: "上传家庭照片，按指定比例生成全家福影像任务。",
    category: "影像生产",
    provider: "image-studio",
    launchUrl: "https://studio.quantumgalaxy.top/workflows/image-studio",
    fields: [
      { key: "images", label: "参考照片", type: "files", required: true, accept: "image/jpeg,image/png,image/webp", multiple: true },
      { key: "promptOverride", label: "制作要求", type: "textarea", required: false },
      { key: "size", label: "画面比例", type: "select", required: true, options: [
        { label: "横版 3:2", value: "1536x1024" },
        { label: "竖版 2:3", value: "1024x1536" },
        { label: "方形 1:1", value: "1024x1024" },
      ] },
    ],
  },
  {
    code: "ai-automatic-video-editing",
    name: "AI 自动剪辑",
    description: "创建视频剪辑工程并进入自动分析、编排和渲染流程。",
    category: "内容生产",
    provider: "content-workbench",
    launchUrl: `${CONTENT_BASE_URL}/workflows/ai-video-editing`,
    fields: [{ key: "input", label: "任务目标", type: "textarea", required: true }],
  },
  {
    code: "tarot-lead-video",
    name: "塔罗引流视频",
    description: "从选题、文案、素材、配音到成片生成塔罗内容任务。",
    category: "内容生产",
    provider: "content-workbench",
    launchUrl: `${CONTENT_BASE_URL}/tasks/new?workflow=tarot-lead-video`,
    fields: [{ key: "input", label: "选题或制作要求", type: "textarea", required: true }],
  },
  {
    code: "daoist-interpretation-video",
    name: "道家解读视频",
    description: "按选题与参考资料生成原创道家解读视频任务。",
    category: "内容生产",
    provider: "content-workbench",
    launchUrl: `${CONTENT_BASE_URL}/tasks/new?workflow=daoist-interpretation-video`,
    fields: [{ key: "input", label: "选题或制作要求", type: "textarea", required: true }],
  },
  {
    code: "digital-human-talking-video",
    name: "数字人口播视频",
    description: "从选题、文案、配音、数字人到智能剪辑的一体化任务。",
    category: "内容生产",
    provider: "content-workbench",
    launchUrl: `${CONTENT_BASE_URL}/tasks/new?workflow=digital-human-talking-video`,
    fields: [{ key: "input", label: "口播主题与制作要求", type: "textarea", required: true }],
  },
  {
    code: "palmistry-reading-video",
    name: "看手相视频",
    description: "根据选题或手相资料生成原创口播、画面、配音和成片任务。",
    category: "内容生产",
    provider: "content-workbench",
    launchUrl: `${CONTENT_BASE_URL}/tasks/new?workflow=palmistry-reading-video`,
    fields: [{ key: "input", label: "选题或制作要求", type: "textarea", required: true }],
  },
] as const;

export function findExternalWorkflow(code: string) {
  return EXTERNAL_WORKFLOW_CATALOG.find((workflow) => workflow.code === code) ?? null;
}

export function providerCredentialName(provider: ExternalWorkflowProvider) {
  return provider === "image-studio"
    ? "QUANTXY_IMAGE_STUDIO_SERVICE_TOKEN"
    : "QUANTXY_CONTENT_WORKFLOW_SERVICE_TOKEN";
}

export function providerLabel(provider: ExternalWorkflowProvider) {
  return provider === "image-studio" ? "AI 影像制作中心" : "前端内容工作台";
}
