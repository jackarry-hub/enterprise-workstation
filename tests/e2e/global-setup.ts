import { loadEnvConfig } from "@next/env";

import { prepareAuthStates } from "./auth-state";

export default async function globalSetup() {
  loadEnvConfig(process.cwd());
  await prepareAuthStates();
}
