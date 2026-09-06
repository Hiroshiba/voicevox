import path from "node:path";
import { chmodSync, cpSync, mkdirSync, renameSync } from "node:fs";
import type { AfterPackContext } from "electron-builder";
import type { VoicevoxEngineSource } from "./types";

/** macOSアプリのContentsのパスを解決する。 */
function resolveMacosContentsPath(context: AfterPackContext): string {
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  return path.join(appPath, "Contents");
}

/** macOSアプリのResourcesのパスを解決する。 */
function resolveMacosResourcesPath(context: AfterPackContext): string {
  return path.join(resolveMacosContentsPath(context), "Resources");
}

/** macOSアプリのElectronヘルパーに実行権限を付与する。 */
function setMacosHelperExecutablePermissions(context: AfterPackContext): void {
  const contentsPath = resolveMacosContentsPath(context);
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
}

/** macOSアプリのローカライズ用ディレクトリを作成する。 */
function createMacosLocalizationDirectories(context: AfterPackContext): void {
  const resourcesPath = resolveMacosResourcesPath(context);
  // NOTE: actions/upload-artifact@v4は空の.lprojディレクトリをアップロードしないため、macOSのローカライズに必要なディレクトリを作成する。
  mkdirSync(path.join(resourcesPath, "ja.lproj"), { recursive: true });
  mkdirSync(path.join(resourcesPath, "en.lproj"), { recursive: true });
}

/** Linuxアプリ本体に実行権限を付与する。 */
function setLinuxExecutablePermissions(context: AfterPackContext): void {
  chmodSync(
    path.join(context.appOutDir, context.packager.appInfo.productFilename),
    0o755,
  );
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
      ? resolveMacosResourcesPath(context)
      : context.appOutDir;
  const destination = path.join(destinationRoot, "vv-engine");
  const source = path.join(
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

/** Electronアプリのパッケージング後処理を行う。 */
export default function afterPack(
  context: AfterPackContext,
  voicevoxEngineSource: VoicevoxEngineSource,
): void {
  // NOTE: エンジンをここで配置する理由は、Windowsの再署名を避けつつ、macOSのapp署名前に組み込むため
  transferVoicevoxEngine(context, voicevoxEngineSource);

  switch (context.electronPlatformName) {
    case "linux":
      setLinuxExecutablePermissions(context);
      break;
    case "darwin":
      setMacosHelperExecutablePermissions(context);
      createMacosLocalizationDirectories(context);
      break;
  }
}
