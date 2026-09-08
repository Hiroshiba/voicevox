import { vi, expect, test } from "vitest";
import latestDefaultEngineInfos from "./latestDefaultEngineInfos.json";
import {
  fetchLatestDefaultEngineInfo,
  getDefaultRuntimeTarget,
} from "@/domain/defaultEngine/latestDefaultEngine";
import type { EnginePackageLatestInfo } from "@/domain/enginePackage";
import { EngineId } from "@/type/preload";

test("fetchLatestDefaultEngineInfo", async () => {
  // テスト用のjsonファイルでfetchをモックする
  // 元ファイルは https://raw.githubusercontent.com/VOICEVOX/voicevox_blog/master/src/generateLatestDefaultEngineInfos.ts
  const spy = vi
    .spyOn(global, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(latestDefaultEngineInfos)));

  // 読み込めることを確認
  const infos = await fetchLatestDefaultEngineInfo("https://example.com/");
  expect(infos.formatVersion).toBe(1);

  spy.mockRestore();
});

function createLatestInfo(
  defaults: boolean[],
  files: EnginePackageLatestInfo["availableRuntimeTargets"][number]["packageInfo"]["files"],
): EnginePackageLatestInfo {
  return {
    availableRuntimeTargets: defaults.map((isDefault, index) => ({
      target: `linux-x64-cpu${index}`,
      packageInfo: {
        version: "0.0.0",
        displayInfo: {
          label: "テスト",
          hint: "テスト",
          order: index,
          default: isDefault,
        },
        files,
      },
    })),
  };
}

const testFile = {
  url: "https://example.com/engine.vvpp",
  name: "engine.vvpp",
  size: 1,
};

test("推奨ランタイムターゲットを取得できる", () => {
  const latestInfo = createLatestInfo([true], [testFile]);

  expect(getDefaultRuntimeTarget(EngineId("test-engine"), latestInfo)).toBe(
    "linux-x64-cpu0",
  );
});

test("推奨ランタイムターゲットがない場合は例外を投げる", () => {
  const latestInfo = createLatestInfo([false], [testFile]);

  expect(() =>
    getDefaultRuntimeTarget(EngineId("test-engine"), latestInfo),
  ).toThrow("推奨ランタイムターゲットがありません");
});

test("推奨ランタイムターゲットが複数ある場合は例外を投げる", () => {
  const latestInfo = createLatestInfo([true, true], [testFile]);

  expect(() =>
    getDefaultRuntimeTarget(EngineId("test-engine"), latestInfo),
  ).toThrow("推奨ランタイムターゲットが複数あります");
});

test("推奨パッケージにファイルがない場合は例外を投げる", () => {
  const latestInfo = createLatestInfo([true], []);

  expect(() =>
    getDefaultRuntimeTarget(EngineId("test-engine"), latestInfo),
  ).toThrow("推奨ランタイムターゲットのパッケージにファイルがありません");
});
