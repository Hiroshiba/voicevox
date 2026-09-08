import { spawn, type ChildProcessByStdio } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import treeKill from "tree-kill";
import { chromium, expect, test } from "@playwright/test";
import { z } from "zod";
import { assertNonNullable } from "@/type/utility";
import { navigateToMain } from "../navigators";

const { VOICEVOX_EXECUTABLE_PATH: executablePath } = z
  .object({
    VOICEVOX_EXECUTABLE_PATH: z.string().min(1),
  })
  .parse(process.env);
const timeout = 60 * 1000;
const engineInstallTimeout = 8 * 60 * 1000;
type AppProcess = ChildProcessByStdio<null, null, Readable>;
const killProcessTree = promisify(
  (pid: number, callback: (error?: Error) => void): void => {
    treeKill(pid, "SIGKILL", callback);
  },
);

const waitForDevToolsEndpoint = (appProcess: AppProcess): Promise<string> => {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeoutId = setTimeout(() => {
      reject(new Error("DevToolsの接続先取得がタイムアウトしました。"));
    }, timeout);
    const onData = (data: Buffer) => {
      stderr += data.toString();
      const endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(stderr)?.[1];
      if (endpoint == undefined) return;
      clearTimeout(timeoutId);
      appProcess.stderr.removeListener("data", onData);
      resolve(endpoint);
    };
    appProcess.stderr.on("data", onData);
    appProcess.once("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    appProcess.once("exit", () => {
      clearTimeout(timeoutId);
      reject(
        new Error("DevToolsの接続先を取得する前にVOICEVOXが終了しました。"),
      );
    });
  });
};

const terminateProcess = async (appProcess: AppProcess): Promise<void> => {
  const pid = appProcess.pid;
  if (
    pid == undefined ||
    appProcess.exitCode != null ||
    appProcess.signalCode != null
  ) {
    return;
  }

  const closed = once(appProcess, "close");
  await killProcessTree(pid);
  await closed;
};

test("標準版でエンジンをインストールして音声合成と再生ができる", async () => {
  const appProcess = spawn(
    path.normalize(executablePath),
    ["--no-sandbox", "--remote-debugging-port=0"],
    { shell: false, stdio: ["ignore", "ignore", "pipe"] },
  );

  try {
    const browser = await test.step("VOICEVOXを起動する", async () => {
      const endpoint = await waitForDevToolsEndpoint(appProcess);
      return await chromium.connectOverCDP(endpoint, { timeout });
    });

    try {
      const context = browser.contexts().at(0);
      assertNonNullable(context, "ブラウザコンテキストが見つかりません。");

      const welcomePage = await test.step("Welcome画面を開く", async () => {
        const page =
          context.pages()[0] ??
          (await context.waitForEvent("page", { timeout }));
        await expect(
          page.getByText("エンジンのセットアップ", { exact: true }),
        ).toBeVisible();
        return page;
      });

      await test.step("CPU版エンジンを選択する", async () => {
        const runtimeTargetSelect = welcomePage.getByRole("combobox");
        await runtimeTargetSelect.click();
        await welcomePage
          .getByRole("option", { name: "CPU", exact: true })
          .click();
      });

      await test.step("エンジンをインストールする", async () => {
        const install = welcomePage.getByRole("button", {
          name: /インストール（.+?）/,
        });
        await install.click();

        const reinstall = welcomePage.getByRole("button", {
          name: /再インストール（.+?）/,
        });
        await expect(reinstall).toBeVisible({ timeout: engineInstallTimeout });
      });

      const editorPage = await test.step("エディタを起動する", async () => {
        const launchEditor = welcomePage.getByRole("button", {
          name: "エディタを起動",
        });
        const editorPagePromise = context.waitForEvent("page", { timeout });
        await launchEditor.click();
        return await editorPagePromise;
      });

      await navigateToMain(editorPage);

      const audioDetail = editorPage.getByTestId("audio-detail");
      await test.step("テキストを入力する", async () => {
        const input = editorPage.getByRole("textbox", { name: "1行目" });
        await input.fill("インストーラー版の音声合成を確認します。");
        await input.press("Enter");
        await expect(editorPage.locator(".accent-phrase")).not.toHaveCount(0);
      });

      const synthesisResponse =
        await test.step("音声合成して再生する", async () => {
          const responsePromise = editorPage.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname.endsWith("/synthesis"),
            { timeout },
          );
          await audioDetail
            .getByRole("button")
            .filter({ hasText: "play_arrow" })
            .click();
          const response = await responsePromise;
          expect(response.ok()).toBe(true);
          await expect(
            audioDetail.getByRole("button").filter({ hasText: "stop" }),
          ).toBeEnabled();
          return response;
        });

      await test.step("音声データをデコードして長さを確認する", async () => {
        const bytes = [...(await synthesisResponse.body())];
        const duration = await editorPage.evaluate((audioBytes) => {
          const arrayBuffer = Uint8Array.from(audioBytes).buffer;
          const audioContext = new OfflineAudioContext(1, 1, 44100);
          return audioContext
            .decodeAudioData(arrayBuffer)
            .then((audioBuffer) => audioBuffer.duration);
        }, bytes);
        expect(duration).toBeGreaterThan(1);
      });
    } finally {
      await browser.close();
    }
  } finally {
    await terminateProcess(appProcess);
  }
});
