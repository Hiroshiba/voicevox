import path from "node:path";
import { chmodSync, cpSync, mkdirSync, renameSync } from "node:fs";
import type { AfterPackContext } from "electron-builder";

type VoicevoxEngineSource =
  | {
      kind: "include";
      directory: string;
      transferMode: "copy" | "move";
    }
  | { kind: "exclude" };

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
  const executableName =
    context.electronPlatformName === "win32" ? "run.exe" : "run";

  if (voicevoxEngineSource.transferMode === "move") {
    renameSync(source, destination);
  } else {
    cpSync(source, destination, {
      recursive: true,
      verbatimSymlinks: true,
    });
  }

  const executablePath = path.join(destination, executableName);
  if (context.electronPlatformName !== "win32") {
    chmodSync(executablePath, 0o755);
  }
}

function createMacosLocalizationDirectories(resourcesPath: string): void {
  // NOTE: actions/upload-artifact@v4は空の.lprojディレクトリをアップロードしないため、macOSのローカライズに必要なディレクトリを作成する。
  mkdirSync(path.join(resourcesPath, "ja.lproj"), { recursive: true });
  mkdirSync(path.join(resourcesPath, "en.lproj"), { recursive: true });
}

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
  transferVoicevoxEngine(context, voicevoxEngineSource);

  if (context.electronPlatformName === "darwin") {
    afterPackMacos(context);
  }
}
