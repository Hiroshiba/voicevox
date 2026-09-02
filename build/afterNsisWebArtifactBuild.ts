import type { Target } from "electron-builder";
import splitNsisArchive from "./splitNsisArchive";
import { parseInstallerMode } from "./installerMode";

/** NSIS Web 成果物をエンジンモードに応じて処理する。 */
export async function afterNsisWebArtifactBuild(target: Target): Promise<void> {
  if (parseInstallerMode(process.env.VOICEVOX_ENGINE_MODE) === "embed-engine") {
    await splitNsisArchive(target);
  }
}
