import path from "node:path";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import type { AfterPackContext } from "electron-builder";

/** macOSアプリのパッケージング後処理を行う。 */
export default function afterPack(
  context: AfterPackContext,
  shouldIncludeVoicevoxEngine: boolean,
): void {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  const contentsPath = path.join(appPath, "Contents");
  const resourcesPath = path.join(contentsPath, "Resources");
  const helperPrefix = `${context.packager.appInfo.sanitizedProductName} Helper`;
  const helperNames = [
    `${helperPrefix} (GPU)`,
    `${helperPrefix} (Plugin)`,
    `${helperPrefix} (Renderer)`,
    helperPrefix,
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

  // NOTE: actions/upload-artifact@v4は空の.lprojディレクトリをアップロードしないため、macOSのローカライズに必要なディレクトリを作成する。
  mkdirSync(path.join(resourcesPath, "ja.lproj"), { recursive: true });
  mkdirSync(path.join(resourcesPath, "en.lproj"), { recursive: true });
}
