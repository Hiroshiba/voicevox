import path from "node:path";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import type { AfterPackContext } from "electron-builder";
import { z } from "zod";

const afterPackEnvironmentSchema = z.object({
  VOICEVOX_ENGINE_DIR: z.union([z.literal(""), z.string().min(1)]).optional(),
});

/** macOSアプリの署名前に必要なファイルを整える。 */
export default function afterPack(context: AfterPackContext): void {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const environment = afterPackEnvironmentSchema.parse({
    VOICEVOX_ENGINE_DIR: process.env.VOICEVOX_ENGINE_DIR,
  });
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

  const engineDir = environment.VOICEVOX_ENGINE_DIR;
  if (engineDir != undefined && engineDir !== "") {
    const engineRunPath = path.join(resourcesPath, "vv-engine", "run");
    if (!existsSync(engineRunPath)) {
      throw new Error(`VOICEVOX ENGINEのrunが見つかりません: ${engineRunPath}`);
    }
    chmodSync(engineRunPath, 0o755);
  }

  mkdirSync(path.join(resourcesPath, "ja.lproj"), { recursive: true });
  mkdirSync(path.join(resourcesPath, "en.lproj"), { recursive: true });
}
