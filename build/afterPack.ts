import path from "node:path";
import { chmodSync, cpSync, mkdirSync, renameSync } from "node:fs";
import type { AfterPackContext } from "electron-builder";
import type { VoicevoxEngineSource } from "./types";

/** macOSアプリのContentsとResourcesのパスを解決する。 */
function resolveMacosAppPaths(
  appOutDir: string,
  productFilename: string,
): { contentsPath: string; resourcesPath: string } {
  const appPath = path.join(appOutDir, `${productFilename}.app`);
  const contentsPath = path.join(appPath, "Contents");
  const resourcesPath = path.join(contentsPath, "Resources");
  return { contentsPath, resourcesPath };
}

/** macOSアプリのElectronヘルパーに実行権限を付与する。 */
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

/** Electronアプリの出力先へVOICEVOX ENGINEを配置する。 */
function transferVoicevoxEngine(
  context: AfterPackContext,
  voicevoxEngineSource: VoicevoxEngineSource,
): void {
  if (voicevoxEngineSource.kind === "exclude") {
    return;
  }

  const destinationRoot =
    context.electronPlatformName === "darwin"
      ? resolveMacosAppPaths(
          context.appOutDir,
          context.packager.appInfo.productFilename,
        ).resourcesPath
      : context.appOutDir;
  const destination = path.join(destinationRoot, "vv-engine");
  const source = path.resolve(
    context.packager.projectDir,
    voicevoxEngineSource.directory,
  );
  if (voicevoxEngineSource.transferMode === "move") {
    renameSync(source, destination);
  } else {
    cpSync(source, destination, {
      recursive: true,
      verbatimSymlinks: true,
    });
  }

  if (context.electronPlatformName !== "win32") {
    const executablePath = path.join(destination, "run");
    chmodSync(executablePath, 0o755);
  }
}

/** macOSアプリのローカライズ用ディレクトリを作成する。 */
function createMacosLocalizationDirectories(resourcesPath: string): void {
  // NOTE: actions/upload-artifact@v4は空の.lprojディレクトリをアップロードしないため、macOSのローカライズに必要なディレクトリを作成する。
  mkdirSync(path.join(resourcesPath, "ja.lproj"), { recursive: true });
  mkdirSync(path.join(resourcesPath, "en.lproj"), { recursive: true });
}

/** macOS固有のパッケージング後処理を行う。 */
function afterPackMacos(context: AfterPackContext): void {
  const { contentsPath, resourcesPath } = resolveMacosAppPaths(
    context.appOutDir,
    context.packager.appInfo.productFilename,
  );
  setMacosHelperExecutablePermissions(
    contentsPath,
    context.packager.appInfo.sanitizedProductName,
  );
  createMacosLocalizationDirectories(resourcesPath);
}

/** Electronアプリのパッケージング後処理を行う。 */
export default function afterPack(
  context: AfterPackContext,
  voicevoxEngineSource: VoicevoxEngineSource,
): void {
  // NOTE: Windowsで署名済みVOICEVOX ENGINEが再署名されるのを避けるため、extraFilesではなくafterPackで配置する。
  transferVoicevoxEngine(context, voicevoxEngineSource);

  if (context.electronPlatformName === "darwin") {
    afterPackMacos(context);
  }
}
