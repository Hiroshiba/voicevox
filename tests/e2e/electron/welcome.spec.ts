import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dotenv from "dotenv";
import { expect, test } from "./fixtures";
import { getUserTestDir } from "./helper";
import { minimumEngineManifestSchema } from "@/type/preload";

const defaultEngineId = "208cf94d-43d2-4cf5-abc0-9783cac36d29";
const oldEngineDirName = `VOICEVOX_Nemo_Engine+${defaultEngineId}`;
const oldEngineSourceDir = "./tests/e2e/electron/oldEngine";

let fixtureServer: http.Server | undefined;
let fixtureServerUrl: string | undefined;
let fixtureDir: string | undefined;
let vvppDownloadRequestCount = 0;
let failNextVvppDownload = false;
let holdVvppDownload = false;
let releaseVvppDownload: (() => void) | undefined;

type TestOsName = "windows" | "macos" | "linux";
type TestArch = "x64" | "arm64" | "x86";

const getTestOsName = (): TestOsName => {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      throw new Error(
        `対応していないプラットフォームです。${process.platform}`,
      );
  }
};

const getTestArch = (): TestArch => {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    case "ia32":
      return "x86";
    default:
      throw new Error(`対応していないアーキテクチャです。${process.arch}`);
  }
};

const releaseHeldVvppDownload = (): void => {
  holdVvppDownload = false;
  const release = releaseVvppDownload;
  releaseVvppDownload = undefined;
  release?.();
};

test.beforeAll(async () => {
  const sevenZipBinNames: Partial<Record<NodeJS.Platform, string>> = {
    win32: "7za.exe",
    darwin: "7zz",
    linux: "7zzs",
  };
  const sevenZipBinName = sevenZipBinNames[process.platform];
  if (sevenZipBinName == undefined) {
    throw new Error(`対応していないプラットフォームです。${process.platform}`);
  }
  const sevenZipBin =
    process.env.VITE_7Z_BIN_NAME ??
    path.resolve("vendored", "7z", sevenZipBinName);

  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "voicevox-e2e-"));
  const fixtureSourceDir = path.join(fixtureDir, "engine");
  await fs.cp(oldEngineSourceDir, fixtureSourceDir, { recursive: true });
  const manifestPath = path.join(fixtureSourceDir, "engine_manifest.json");
  const manifest = minimumEngineManifestSchema.parse(
    JSON.parse(await fs.readFile(manifestPath, "utf8")),
  );
  manifest.version = "0.0.2";
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const vvppPath = path.join(fixtureDir, "engine.vvpp");
  await promisify(execFile)(sevenZipBin, ["a", "-tzip", vvppPath, "*"], {
    cwd: fixtureSourceDir,
  });
  const vvpp = await fs.readFile(vvppPath);

  const target = `${getTestOsName()}-${getTestArch()}-cpu`;

  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/latest.json") {
      const latestInfo = {
        formatVersion: 1,
        packages: {
          [target]: {
            version: "0.0.2",
            displayInfo: {
              label: "テスト",
              hint: "テスト用エンジン",
              order: 0,
              default: true,
            },
            files: [
              {
                url: `${fixtureServerUrl}/engine.vvpp`,
                name: "engine.vvpp",
                size: vvpp.byteLength,
              },
            ],
          },
        },
      };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(latestInfo));
      return;
    }
    if (pathname === "/engine.vvpp") {
      vvppDownloadRequestCount += 1;
      if (holdVvppDownload) {
        await new Promise<void>((resolve) => {
          releaseVvppDownload = resolve;
        });
        holdVvppDownload = false;
        releaseVvppDownload = undefined;
      }
      if (failNextVvppDownload) {
        failNextVvppDownload = false;
        response.statusCode = 500;
        response.end();
        return;
      }
      response.setHeader("content-type", "application/octet-stream");
      response.end(vvpp);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  fixtureServer = server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address == undefined || typeof address === "string") {
    throw new Error("テスト用サーバーのアドレスを取得できません。");
  }
  fixtureServerUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  releaseHeldVvppDownload();
  const server = fixtureServer;
  if (server != undefined) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error != undefined) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
  const directory = fixtureDir;
  if (directory != undefined) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const installOldEngine = async (): Promise<void> => {
  const vvppEngineDir = path.join(getUserTestDir(), "vvpp-engines");
  await fs.mkdir(vvppEngineDir, { recursive: true });
  await fs.cp(oldEngineSourceDir, path.join(vvppEngineDir, oldEngineDirName), {
    recursive: true,
  });
};

test.beforeEach(async () => {
  // キャッシュなどでテスト結果が変化しないように、appDataをテスト起動時に毎回消去する。
  // cf: https://www.electronjs.org/ja/docs/latest/api/app#appgetpathname
  const userDir = getUserTestDir();
  await fs.rm(userDir, {
    recursive: true,
    force: true,
  });
});

test.beforeEach(async () => {
  vvppDownloadRequestCount = 0;
  failNextVvppDownload = false;
  releaseHeldVvppDownload();
  dotenv.config({
    path: "./tests/env/.env.test-electron-default-vvpp",
    override: true,
    quiet: true,
  });
  if (fixtureServerUrl == undefined) {
    throw new Error("テスト用サーバーのURLを取得できません。");
  }
  process.env.VITE_DEFAULT_ENGINE_INFOS = JSON.stringify([
    {
      type: "downloadVvpp",
      name: "VOICEVOX Nemo Engine",
      uuid: defaultEngineId,
      host: "http://127.0.0.1:50121",
      executionEnabled: true,
      executionArgs: [],
      latestUrl: `${fixtureServerUrl}/latest.json`,
    },
  ]);
});

test("エディタウィンドウを起動できる", async ({ launchElectronApp }) => {
  holdVvppDownload = true;
  const app = await launchElectronApp();

  await app.evaluate((electron) => {
    electron.dialog.showErrorBox = (title: string, content: string) => {
      if (title === "音声合成エンジンエラー") {
        return;
      }
      throw new Error(
        `想定外のダイアログです。タイトル: ${title}、内容: ${content}`,
      );
    };
  });

  let welcomePageUrl: string;
  await test.step("Welcomeを表示する", async () => {
    const welcomePage = await app.firstWindow({
      timeout: process.env.CI ? 90000 : 60000,
    });
    welcomePageUrl = welcomePage.url();
    try {
      await expect(welcomePage.getByText("エンジンのセットアップ")).toBeVisible(
        { timeout: 60000 },
      );
      await expect.poll(() => vvppDownloadRequestCount).toBe(1);
      await expect(welcomePage.getByText("ダウンロード")).toBeVisible();
    } finally {
      releaseHeldVvppDownload();
    }
  });

  await test.step("自動導入後にエディタを表示する", async () => {
    await expect
      .poll(() => app.windows().some((page) => page.url() !== welcomePageUrl), {
        timeout: process.env.CI ? 90000 : 60000,
      })
      .toBe(true);
    const editorPage = app
      .windows()
      .find((page) => page.url() !== welcomePageUrl);
    if (editorPage == undefined) {
      throw new Error("エディタウィンドウを取得できません。");
    }
    await expect(
      editorPage.getByRole("button", { name: "エンジン" }),
    ).toBeVisible({
      timeout: 60000,
    });
  });

  await test.step("VVPPを一度だけ取得する", async () => {
    await expect.poll(() => vvppDownloadRequestCount).toBe(1);
  });

  await test.step("VVPPを配置する", async () => {
    const manifestPath = path.join(
      getUserTestDir(),
      "vvpp-engines",
      oldEngineDirName,
      "engine_manifest.json",
    );
    const manifest = minimumEngineManifestSchema.parse(
      JSON.parse(await fs.readFile(manifestPath, "utf8")),
    );
    expect(manifest).toEqual(
      expect.objectContaining({
        uuid: defaultEngineId,
        version: "0.0.2",
      }),
    );
  });
});

test("自動導入失敗後に手動で再試行できる", async ({ launchElectronApp }) => {
  failNextVvppDownload = true;
  holdVvppDownload = true;
  const downloadUrl = fixtureServerUrl;
  if (downloadUrl == undefined) {
    throw new Error("テスト用サーバーのURLを取得できません。");
  }
  const app = await launchElectronApp();

  await app.evaluate((electron) => {
    electron.dialog.showErrorBox = (title: string, content: string) => {
      if (title === "音声合成エンジンエラー") {
        return;
      }
      throw new Error(
        `想定外のダイアログです。タイトル: ${title}、内容: ${content}`,
      );
    };
  });

  const welcomePage = await test.step("Welcomeを表示する", async () => {
    const welcomePage = await app.firstWindow({
      timeout: process.env.CI ? 90000 : 60000,
    });
    await expect(welcomePage.getByText("エンジンのセットアップ")).toBeVisible({
      timeout: 60000,
    });
    return welcomePage;
  });

  await test.step("導入中の終了を抑止する", async () => {
    await expect.poll(() => vvppDownloadRequestCount).toBe(1);
    try {
      if (process.platform === "darwin") {
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getFocusedWindow();
          if (window == undefined) {
            throw new Error("Welcomeウィンドウを取得できません。");
          }
          window.close();
        });
      } else {
        await welcomePage
          .getByRole("button", { name: "閉じる" })
          .first()
          .click();
      }
      await expect(
        welcomePage.getByText("エンジンのセットアップ"),
      ).toBeVisible();
    } finally {
      releaseHeldVvppDownload();
    }
  });

  await test.step("自動導入を失敗させる", async () => {
    const errorDialog = welcomePage.getByRole("dialog", {
      name: "エンジンのインストールに失敗しました",
    });
    await expect(errorDialog).toBeVisible({ timeout: 60000 });
    await expect.poll(() => vvppDownloadRequestCount).toBe(1);
    await expect(errorDialog).toContainText(`${downloadUrl}/engine.vvpp`);
    await errorDialog.getByRole("button", { name: "閉じる" }).click();
    await expect(errorDialog).toBeHidden();
    await expect.poll(() => vvppDownloadRequestCount).toBe(1);
    await expect(
      welcomePage.getByRole("button", { name: /^インストール（.+?）$/ }),
    ).toBeEnabled();
  });

  await test.step("手動導入を再試行する", async () => {
    await welcomePage
      .getByRole("button", { name: /^インストール（.+?）$/ })
      .click();
    await expect.poll(() => vvppDownloadRequestCount).toBe(2);
    await expect(
      welcomePage.getByRole("button", { name: /^再インストール（.+?）$/ }),
    ).toBeVisible({ timeout: 60000 });
  });

  await test.step("エディタを起動する", async () => {
    const launchEditor = welcomePage.getByRole("button", {
      name: "エディタを起動",
    });
    await expect(launchEditor).toBeEnabled({ timeout: 60000 });
    await launchEditor.click();

    const editorPage = await app.waitForEvent("window", {
      timeout: process.env.CI ? 90000 : 60000,
    });
    await expect(
      editorPage.getByRole("button", { name: "エンジン" }),
    ).toBeVisible({ timeout: 60000 });
  });
});

test("Welcome画面でエンジンをアップデートできる", async ({
  launchElectronApp,
}) => {
  await test.step("古いエンジンを配置する", async () => {
    await installOldEngine();
  });

  const app = await launchElectronApp();

  // ダミーエンジンは起動できずに異常終了するため、エラーダイアログが表示される。
  // これをモックしてテストが失敗しないようにする。
  //
  // NOTE: このモックが差し込まれる前にエンジンが起動して異常終了する可能性がある
  // TODO: ほかの方法でエラーダイアログを抑制できないか検討する
  await app.evaluate((electron) => {
    electron.dialog.showErrorBox = (title: string, content: string) => {
      if (title === "音声合成エンジンエラー") {
        return;
      }

      throw new Error(`Unexpected dialog: title=${title}, content=${content}`);
    };
  });

  const welcomePage = await test.step("Welcome画面に移動する", async () => {
    const mainPage = await app.firstWindow({
      timeout: process.env.CI ? 90000 : 60000,
    });

    const engineMenu = mainPage.getByText("エンジン", { exact: true });
    await engineMenu.waitFor({
      timeout: 60000,
    });
    await engineMenu.click();

    const moveToWelcomePage = mainPage.getByText(/エンジンのセットアップ/);
    await moveToWelcomePage.waitFor({
      timeout: 60000,
    });
    await moveToWelcomePage.click();

    const welcomePage = await app.waitForEvent("window", {
      timeout: process.env.CI ? 90000 : 60000,
    });
    await welcomePage.waitForSelector("text=エンジンのセットアップ", {
      timeout: 60000,
    });
    return welcomePage;
  });

  await test.step("アップデートを実行する", async () => {
    const updateButton = welcomePage.getByText(/アップデート（.+?）/);
    await updateButton.waitFor({
      timeout: 60000,
    });
    await updateButton.click();
  });

  await test.step("アップデート後の状態に切り替わる", async () => {
    const reinstallButton = welcomePage.getByText(/再インストール（.+?）/);
    await reinstallButton.waitFor({
      timeout: 60000,
    });
  });

  await test.step("エディタを起動する", async () => {
    const launchEditor = welcomePage.getByText(/エディタを起動/);
    await expect(launchEditor).toBeEnabled({
      timeout: 60000,
    });
    await launchEditor.click();

    const editorPage = await app.waitForEvent("window", {
      timeout: process.env.CI ? 90000 : 60000,
    });
    await expect(
      editorPage.getByRole("button", { name: "エンジン" }),
    ).toBeVisible({
      timeout: 60000,
    });
  });
});
