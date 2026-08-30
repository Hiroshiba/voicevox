import path from "node:path";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import type { AfterPackContext } from "electron-builder";
import { z } from "zod";

const DEFAULT_VOICEVOX_ENGINE_DIR = "../voicevox_engine/dist/run/";
const voicevoxEngineDirSchema = z.union([z.literal(""), z.string().min(1)]);

/** VOICEVOX ENGINEの配置元を解決する。 */
export function resolveVoicevoxEngineDir(value: string | undefined): string {
  return (
    voicevoxEngineDirSchema.optional().parse(value) ??
    DEFAULT_VOICEVOX_ENGINE_DIR
  );
}

/** macOSアプリの署名前処理を行う。 */
export default function afterPack(
  context: AfterPackContext,
  shouldIncludeVoicevoxEngine: boolean,
): void {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(context.appOutDir, "VOICEVOX.app");
  const contentsPath = path.join(appPath, "Contents");
  const resourcesPath = path.join(contentsPath, "Resources");
  const helperNames = [
    "VOICEVOX Helper (GPU)",
    "VOICEVOX Helper (Plugin)",
    "VOICEVOX Helper (Renderer)",
    "VOICEVOX Helper",
  ];

  for (const helperName of helperNames) {
    chmodSync(
      path.join(
        contentsPath,
        "Frameworks",
        `${helperName}.app`,
        "Contents",
        "MacOS",
        helperName,
      ),
      0o755,
    );
  }

  if (shouldIncludeVoicevoxEngine) {
    const engineRunPath = path.join(resourcesPath, "vv-engine", "run");
    if (!existsSync(engineRunPath)) {
      throw new Error(`VOICEVOX ENGINEのrunが見つかりません: ${engineRunPath}`);
    }
    chmodSync(engineRunPath, 0o755);
  }

  mkdirSync(path.join(resourcesPath, "ja.lproj"), { recursive: true });
  mkdirSync(path.join(resourcesPath, "en.lproj"), { recursive: true });
}
