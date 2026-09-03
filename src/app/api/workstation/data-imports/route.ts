import {
  createDataImportBootstrapHandler,
  defaultDataImportBootstrapDependencies,
} from "@/app/api/workstation/data-imports/handler";

export const dynamic = "force-dynamic";
export const GET = createDataImportBootstrapHandler(defaultDataImportBootstrapDependencies);
