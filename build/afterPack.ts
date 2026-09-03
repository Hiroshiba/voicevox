import path from "node:path";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import type { AfterPackContext } from "electron-builder";

type VoicevoxEngineSourceKind = "include" | "exclude";

function resolveMacosAppPaths(
  appOutDir: string,
  productFilename: string,
): { contentsPath: string; resourcesPath: string } {
  const appPath = path.join(appOutDir, `${productFilename}.app`);
  const contentsPath = path.join(appPath, "Contents");
  const resourcesPath = path.join(contentsPath, "Resources");
  return { contentsPath, resourcesPath };
}

function setMacosHelperExecutablePermissions(
  contentsPath: string,
  sanitizedProductName: string,
): void {
  const helperPrefix = `${sanitizedProductName} Helper`;
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
}

function setVoicevoxEngineRunPermissions(
  resourcesPath: string,
  voicevoxEngineSourceKind: VoicevoxEngineSourceKind,
): void {
  if (voicevoxEngineSourceKind === "include") {
    const engineRunPath = path.join(resourcesPath, "vv-engine", "run");
    if (!existsSync(engineRunPath)) {
      throw new Error(`VOICEVOX ENGINEのrunが見つかりません: ${engineRunPath}`);
    }
    chmodSync(engineRunPath, 0o755);
  }
}

function createMacosLocalizationDirectories(resourcesPath: string): void {
  // NOTE: actions/upload-artifact@v4は空の.lprojディレクトリをアップロードしないため、macOSのローカライズに必要なディレクトリを作成する。
  mkdirSync(path.join(resourcesPath, "ja.lproj"), { recursive: true });
  mkdirSync(path.join(resourcesPath, "en.lproj"), { recursive: true });
}

/** Electronアプリのパッケージング後処理を行う。 */
export default function afterPack(
  context: AfterPackContext,
  voicevoxEngineSourceKind: VoicevoxEngineSourceKind,
): void {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const { contentsPath, resourcesPath } = resolveMacosAppPaths(
    context.appOutDir,
    context.packager.appInfo.productFilename,
  );
  setMacosHelperExecutablePermissions(
    contentsPath,
    context.packager.appInfo.sanitizedProductName,
  );
  setVoicevoxEngineRunPermissions(resourcesPath, voicevoxEngineSourceKind);
  createMacosLocalizationDirectories(resourcesPath);
}
