import path from "node:path";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import type { AfterPackContext } from "electron-builder";

function resolveMacOSAppPaths(
  appOutDir: string,
  productFilename: string,
): { contentsPath: string; resourcesPath: string } {
  const appPath = path.join(appOutDir, `${productFilename}.app`);
  const contentsPath = path.join(appPath, "Contents");
  const resourcesPath = path.join(contentsPath, "Resources");
  return { contentsPath, resourcesPath };
}

function setElectronHelperPermissions(
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

function setVoicevoxEngineRunPermission(
  resourcesPath: string,
  voicevoxEngineSourceKind: "include" | "exclude",
): void {
  if (voicevoxEngineSourceKind === "include") {
    const engineRunPath = path.join(resourcesPath, "vv-engine", "run");
    if (!existsSync(engineRunPath)) {
      throw new Error(`VOICEVOX ENGINEのrunが見つかりません: ${engineRunPath}`);
    }
    chmodSync(engineRunPath, 0o755);
  }
}

function createMacOSLocalizationDirectories(resourcesPath: string): void {
  // NOTE: actions/upload-artifact@v4は空の.lprojディレクトリをアップロードしないため、macOSのローカライズに必要なディレクトリを作成する。
  mkdirSync(path.join(resourcesPath, "ja.lproj"), { recursive: true });
  mkdirSync(path.join(resourcesPath, "en.lproj"), { recursive: true });
}

/** Electronアプリのパッケージング後処理を行う。 */
export default function afterPack(
  context: AfterPackContext,
  voicevoxEngineSourceKind: "include" | "exclude",
): void {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const { contentsPath, resourcesPath } = resolveMacOSAppPaths(
    context.appOutDir,
    context.packager.appInfo.productFilename,
  );
  setElectronHelperPermissions(
    contentsPath,
    context.packager.appInfo.sanitizedProductName,
  );
  setVoicevoxEngineRunPermission(resourcesPath, voicevoxEngineSourceKind);
  createMacOSLocalizationDirectories(resourcesPath);
}
