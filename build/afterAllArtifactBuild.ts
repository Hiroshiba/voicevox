import type { BuildResult, Target } from "electron-builder";
import splitNsisArchive from "./splitNsisArchive";
import { parseInstallerMode } from "./installerMode";

/** NSIS Web 成果物をエンジンモードに応じて処理する。 */
async function afterNsisWebArtifactBuild(target: Target): Promise<void> {
  if (parseInstallerMode(process.env.VOICEVOX_ENGINE_MODE) === "embed-engine") {
    await splitNsisArchive(target);
  }
}

export default async function afterAllArtifactBuild(buildResult: BuildResult) {
  for (const [platform, targets] of buildResult.platformToTargets.entries()) {
    const platformName = platform.name;

    if (platformName === "windows") {
      for (const [targetKey, target] of targets.entries()) {
        if (targetKey === "nsis-web") {
          await afterNsisWebArtifactBuild(target);
        }
        // else: nop
      }
    }
    // else: nop
  }
  return [];
}
