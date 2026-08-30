import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { verifyExternalReleaseManifest } from "./verify-commercial-evidence.mjs";

export async function verifyCommercialStaging({
  manifestPath = process.env.QUANTXY_RELEASE_EVIDENCE_MANIFEST,
  artifactRoot = process.env.QUANTXY_RELEASE_EVIDENCE_ROOT,
  publicKeyPath = process.env.QUANTXY_RELEASE_EVIDENCE_PUBLIC_KEY_FILE,
  expectedCommit = process.env.QUANTXY_RELEASE_CANDIDATE_COMMIT,
} = {}) {
  if (!manifestPath || !artifactRoot || !publicKeyPath || !/^[0-9a-f]{40}$/.test(expectedCommit ?? "")) {
    return { status: "BLOCKED", issues: ["authorized_staging_inputs_missing"] };
  }
  const [manifestSource, publicKeyPem] = await Promise.all([readFile(manifestPath, "utf8"), readFile(publicKeyPath, "utf8")]);
  return verifyExternalReleaseManifest({ manifest: JSON.parse(manifestSource), expectedCommit, artifactRoot, publicKeyPem });
}

async function runCli() {
  try {
    const report = await verifyCommercialStaging();
    if (report.status !== "PASSED") {
      console.error(`BLOCKED commercial_staging reason=${report.issues.join(";")}`);
      process.exitCode = 1;
      return;
    }
    console.log("PASSED commercial_staging evidence=hash_bound_signed");
  } catch {
    console.error("BLOCKED commercial_staging reason=staging_evidence_invalid");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli();

