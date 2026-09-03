export type DataImportProject = {
  id: string;
  code: string;
  name: string;
};

export type DataImportCapabilities = {
  directorySync: boolean;
  customerImport: boolean;
  customerExport: boolean;
  customerExportPii: boolean;
  projectFileUpload: boolean;
  knowledgeManage: boolean;
};

export type DataImportBootstrap = {
  source: "supabase";
  organizationName: string;
  capabilities: DataImportCapabilities;
  projects: DataImportProject[];
  projectDataStatus: "ready" | "unavailable";
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDataImportBootstrap(value: unknown): DataImportBootstrap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const capabilities = source.capabilities;
  if (source.source !== "supabase"
      || typeof source.organizationName !== "string"
      || !capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)
      || !Array.isArray(source.projects)
      || !["ready", "unavailable"].includes(String(source.projectDataStatus))) return null;
  const capabilityRecord = capabilities as Record<string, unknown>;
  const capabilityKeys = [
    "directorySync",
    "customerImport",
    "customerExport",
    "customerExportPii",
    "projectFileUpload",
    "knowledgeManage",
  ] as const;
  if (capabilityKeys.some((key) => typeof capabilityRecord[key] !== "boolean")) return null;
  const projects: DataImportProject[] = [];
  for (const entry of source.projects) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const project = entry as Record<string, unknown>;
    if (typeof project.id !== "string" || !UUID_PATTERN.test(project.id)
        || typeof project.code !== "string" || !project.code.trim() || project.code.length > 80
        || typeof project.name !== "string" || !project.name.trim() || project.name.length > 200) return null;
    projects.push({ id: project.id.toLowerCase(), code: project.code, name: project.name });
  }
  return {
    source: "supabase",
    organizationName: source.organizationName,
    capabilities: Object.fromEntries(
      capabilityKeys.map((key) => [key, capabilityRecord[key]]),
    ) as DataImportCapabilities,
    projects,
    projectDataStatus: source.projectDataStatus as DataImportBootstrap["projectDataStatus"],
  };
}
