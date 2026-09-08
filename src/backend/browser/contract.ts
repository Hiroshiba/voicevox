import { loadEnvEngineInfos } from "@/domain/defaultEngine/envEngineInfo";
import type { EngineInfo } from "@/type/preload";
import { assertNonNullable } from "@/type/utility";

const baseEngineInfo = loadEnvEngineInfos().at(0);
assertNonNullable(
  baseEngineInfo,
  "ブラウザ版のデフォルトエンジンがありません。",
);
assertNonNullable(
  baseEngineInfo.executionFilePath,
  "ブラウザ版のデフォルトエンジンに実行ファイルが指定されていません。",
);

export const defaultEngine: EngineInfo = (() => {
  const { protocol, hostname, port, pathname } = new URL(baseEngineInfo.host);
  return {
    ...baseEngineInfo,
    executionFilePath: baseEngineInfo.executionFilePath,
    protocol,
    hostname,
    defaultPort: port,
    pathname: pathname === "/" ? "" : pathname,
    type: "path", // FIXME: ダミーで"path"にしているので、エンジンAPIのURLを設定できるようにし、type: "URL"にする
    version: "999.999.999", // FIXME: ダミー値。type: "URL"にし、APIから取得する。
    isDefault: true,
  };
})();
export const directoryHandleStoreKey = "directoryHandle";
