import { handleWorkspaceSettings } from "@/features/settings/settings-command-handler";
export async function GET(request: Request) { return handleWorkspaceSettings(request); }
export async function PUT(request: Request) { return handleWorkspaceSettings(request); }
