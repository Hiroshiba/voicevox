/**
 * デフォルトエンジンの最新情報関連のモジュール
 */

import { z } from "zod";

import type { EnginePackageLatestInfo } from "@/domain/enginePackage";
import type { EngineId } from "@/type/preload";
import { assertNonNullable } from "@/type/utility";

/** Runtime Target */
export const runtimeTargetSchema = z.string().regex(/^[^-]+-[^-]+-[^-]+$/);
export type RuntimeTarget = z.infer<typeof runtimeTargetSchema>;

/** パッケージ情報のスキーマ */
const packageInfoSchema = z.object({
  version: z.string(),
  displayInfo: z.object({
    label: z.string(),
    hint: z.string(),
    order: z.number(),
    default: z.boolean().optional(),
  }),
  files: z
    .object({
      url: z.string(),
      name: z.string(),
      size: z.number(),
      hash: z.string().optional(),
    })
    .array(),
});
export type PackageInfo = z.infer<typeof packageInfoSchema>;

/** デフォルトエンジンの最新情報のスキーマ */
const latestDefaultEngineInfoSchema = z.object({
  formatVersion: z.number(),
  packages: z.record(runtimeTargetSchema, packageInfoSchema),
});

/** デフォルトエンジンの最新情報を取得する */
export const fetchLatestDefaultEngineInfo = async (url: string) => {
  const response = await fetch(url);
  return latestDefaultEngineInfoSchema.parse(await response.json());
};

/** 指定ターゲットのパッケージを取得する */
export const getPackageInfoByTarget = (
  updateInfo: z.infer<typeof latestDefaultEngineInfoSchema>,
  target: RuntimeTarget,
): PackageInfo => {
  return updateInfo.packages[target];
};

/** 推奨ランタイムターゲットを取得する。 */
export const getDefaultRuntimeTarget = (
  engineId: EngineId,
  latestInfo: EnginePackageLatestInfo,
): RuntimeTarget => {
  const defaultRuntimeTargetInfos = latestInfo.availableRuntimeTargets.filter(
    (targetInfo) => targetInfo.packageInfo.displayInfo.default === true,
  );
  if (defaultRuntimeTargetInfos.length === 0) {
    throw new Error(
      `推奨ランタイムターゲットがありません。エンジンID: ${engineId}`,
    );
  }
  if (defaultRuntimeTargetInfos.length > 1) {
    throw new Error(
      `推奨ランタイムターゲットが複数あります。エンジンID: ${engineId}`,
    );
  }

  const [defaultRuntimeTargetInfo] = defaultRuntimeTargetInfos;
  assertNonNullable(
    defaultRuntimeTargetInfo,
    `推奨ランタイムターゲットがありません。エンジンID: ${engineId}`,
  );
  if (defaultRuntimeTargetInfo.packageInfo.files.length === 0) {
    throw new Error(
      `推奨ランタイムターゲットのパッケージにファイルがありません。エンジンID: ${engineId}、ターゲット: ${defaultRuntimeTargetInfo.target}`,
    );
  }

  return defaultRuntimeTargetInfo.target;
};
