import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { runtimeTargetSchema } from "@/domain/defaultEngine/latestDefaultEngine";
import { isLinux, isMac, isWindows } from "@/helpers/platform";
import { engineIdSchema } from "@/type/preload";

const absolutePathSchema = z
  .string()
  .refine((value) => path.isAbsolute(value), {
    message: "絶対パスを指定してください。",
  });

const voicevoxDeploymentReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  appPath: absolutePathSchema,
  scope: z.enum(["user", "machine"]),
  state: z.enum(["preparing", "ready"]),
  engine: z.object({
    path: absolutePathSchema,
    uuid: engineIdSchema,
    version: z.string(),
    target: runtimeTargetSchema,
  }),
});

export type VoicevoxDeploymentReceipt = z.infer<
  typeof voicevoxDeploymentReceiptSchema
>;

function normalizeApplicationPath(appPath: string): string {
  return path.normalize(path.resolve(appPath));
}

function comparableApplicationPath(appPath: string): string {
  const normalizedAppPath = normalizeApplicationPath(appPath);
  return isWindows ? normalizedAppPath.toLowerCase() : normalizedAppPath;
}

function isInsideApplication(appPath: string, enginePath: string): boolean {
  const relativeEnginePath = path.relative(appPath, enginePath);
  return (
    relativeEnginePath === "" ||
    (relativeEnginePath !== ".." &&
      !relativeEnginePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeEnginePath))
  );
}

function validateRuntimeTarget(target: string): void {
  if (isLinux) {
    throw new Error("Linuxでは管理配置されたエンジンを利用できません。");
  }

  const [targetOs, targetArch] = target.split("-");
  let currentOs: "windows" | "macos";
  if (isWindows) {
    currentOs = "windows";
  } else if (isMac) {
    currentOs = "macos";
  } else {
    throw new Error("現在の環境に対応しないOSです。");
  }

  let currentArch: "x64" | "arm64";
  switch (process.arch) {
    case "x64":
      currentArch = "x64";
      break;
    case "arm64":
      currentArch = "arm64";
      break;
    default:
      throw new Error("現在の環境に対応しないCPUアーキテクチャです。");
  }
  if (targetOs !== currentOs || targetArch !== currentArch) {
    throw new Error(`現在の環境に対応しないRuntime Targetです: ${target}`);
  }
}

/** VOICEVOXの配置情報を隣接するreceiptから読み込む。 */
export function readVoicevoxDeploymentReceipt(
  appPath: string,
): VoicevoxDeploymentReceipt | undefined {
  if (!path.isAbsolute(appPath)) {
    throw new Error("アプリケーションのパスは絶対パスである必要があります。");
  }

  const normalizedAppPath = normalizeApplicationPath(appPath);
  const receiptPath = `${normalizedAppPath}.voicevox-deployment.json`;
  if (!fs.existsSync(receiptPath)) {
    return undefined;
  }

  const receipt = voicevoxDeploymentReceiptSchema.parse(
    JSON.parse(fs.readFileSync(receiptPath, "utf8")),
  );

  if (
    comparableApplicationPath(receipt.appPath) !==
    comparableApplicationPath(appPath)
  ) {
    throw new Error(
      `配置情報のアプリケーションパスが一致しません: ${receiptPath}`,
    );
  }
  if (receipt.state !== "ready") {
    throw new Error(`配置情報が準備中です: ${receiptPath}`);
  }
  validateRuntimeTarget(receipt.engine.target);
  if (isInsideApplication(normalizedAppPath, receipt.engine.path)) {
    throw new Error(
      `管理配置されたエンジンはアプリケーションの外に配置してください: ${receipt.engine.path}`,
    );
  }
  if (
    !fs.existsSync(receipt.engine.path) ||
    !fs.statSync(receipt.engine.path).isDirectory()
  ) {
    throw new Error(
      `配置されたエンジンが見つかりません: ${receipt.engine.path}`,
    );
  }

  return receipt;
}
