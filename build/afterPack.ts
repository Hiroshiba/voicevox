import path from "node:path";
import { chmodSync, cpSync, renameSync } from "node:fs";
import type { AfterPackContext } from "electron-builder";
import { z } from "zod";

export const voicevoxEngineSourceSchema = z
  .union([
    z.object({
      mode: z.enum(["copy", "move"]).default("copy"),
      directory: z.string().min(1),
    }),
    z.object({
      mode: z.literal("none").default("none"),
      directory: z.literal("").optional(),
    }),
  ])
  .transform((value) => (value.mode === "none" ? { mode: value.mode } : value));
type VoicevoxEngineSource = z.infer<typeof voicevoxEngineSourceSchema>;

/** Electronアプリのパッケージング後処理を行う。 */
export default function afterPack(
  context: AfterPackContext,
  voicevoxEngineSource: VoicevoxEngineSource,
) {
  // NOTE: エンジンをここで配置する理由は、Windowsの再署名を避けつつ、macOSのapp署名前に組み込むため
  transferVoicevoxEngine(context, voicevoxEngineSource);
}

/** Electronアプリの出力先へVOICEVOX ENGINEを配置する。 */
function transferVoicevoxEngine(
  context: AfterPackContext,
  voicevoxEngineSource: VoicevoxEngineSource,
) {
  if (voicevoxEngineSource.mode === "none") {
    return;
  }

  const destinationRoot =
    context.electronPlatformName === "darwin"
      ? resolveMacosResourcesPath(context)
      : context.appOutDir;
  const destination = path.join(destinationRoot, "vv-engine");
  const source = voicevoxEngineSource.directory;
  if (voicevoxEngineSource.mode === "move") {
    renameSync(source, destination);
  } else {
    cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
  }

  if (context.electronPlatformName !== "win32") {
    const executablePath = path.join(destination, "run");
    chmodSync(executablePath, 0o755);
  }
}

/** macOSアプリのResourcesのパスを解決する。 */
function resolveMacosResourcesPath(context: AfterPackContext): string {
  return path.join(resolveMacosContentsPath(context), "Resources");
}

/** macOSアプリのContentsのパスを解決する。 */
function resolveMacosContentsPath(context: AfterPackContext): string {
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  return path.join(appPath, "Contents");
}
