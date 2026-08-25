import {
  createPayrollPreviewHandler,
  defaultPayrollPreviewDependencies,
} from "./handler";

export const dynamic = "force-dynamic";
export const POST = createPayrollPreviewHandler(defaultPayrollPreviewDependencies);
