import { _electron as electron, expect, test } from "@playwright/test";
import { z } from "zod";
import { assertNonNullable } from "@/type/utility";

const { VOICEVOX_EXECUTABLE_PATH: executablePath } = z
  .object({
    VOICEVOX_EXECUTABLE_PATH: z.string().min(1),
  })
  .parse(process.env);
const timeout = 10 * 60 * 1000;

test("標準版でエンジンをインストールしてエディタを起動できる", async () => {
  const app = await test.step("VOICEVOXを起動する", async () => {
    return await electron.launch({
      executablePath,
      args: ["--no-sandbox"],
      timeout,
    });
  });

  try {
    const welcomePage = await test.step("Welcome画面を開く", async () => {
      const page = await app.firstWindow({ timeout });
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
      await expect(reinstall).toBeVisible();
    });

    const editorPage = await test.step("エディタを起動する", async () => {
      const launchEditor = welcomePage.getByRole("button", {
        name: "エディタを起動",
      });
      const editorPagePromise = app.waitForEvent("window", { timeout });
      await launchEditor.click();
      return await editorPagePromise;
    });

    await test.step("利用規約を表示する", async () => {
      await expect(
        editorPage.getByText("利用規約に関するお知らせ", { exact: true }),
      ).toBeVisible();
    });

    await test.step("エンジンが応答する", async () => {
      const { engineInfos, altPortInfos } = await editorPage.evaluate(
        async () => ({
          engineInfos: await window.backend.engineInfos(),
          altPortInfos: await window.backend.getAltPortInfos(),
        }),
      );
      const defaultEngine = engineInfos.find((engine) => engine.isDefault);
      assertNonNullable(defaultEngine, "デフォルトエンジンが見つかりません。");
      const port =
        altPortInfos[defaultEngine.uuid] ?? defaultEngine.defaultPort;
      const engineVersionUrl = `${defaultEngine.protocol}//${defaultEngine.hostname}:${port}${defaultEngine.pathname}/version`;
      await expect(async () => {
        const response = await fetch(engineVersionUrl);
        expect(response.ok).toBe(true);
        z.string()
          .min(1)
          .parse(await response.json());
      }).toPass({ timeout });
    });
  } finally {
    await app.close();
  }
});
