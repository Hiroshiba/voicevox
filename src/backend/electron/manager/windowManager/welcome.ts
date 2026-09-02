import path from "node:path";
import {
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type MessageBoxSyncOptions,
  type OpenDialogOptions,
  type OpenDialogSyncOptions,
  type SaveDialogOptions,
} from "electron";
import { getConfigManager } from "../../electronConfig";
import { getAppStateController } from "../../appStateController";
import { createIpcSendProxy, type IpcSendProxy } from "../../ipc";
import { getWelcomeIpcMainHandleManager } from "../welcomeIpcMainHandleManager";
import { themes } from "@/domain/theme";
import type { WelcomeIpcSOData } from "@/welcome/backend/ipcType";
import type { WelcomeWindowLaunchContext } from "@/domain/welcome";
import type { EngineId } from "@/type/preload";
import { createLogger } from "@/helpers/log";

const log = createLogger("WelcomeWindowManager");

type WindowManagerOption = {
  staticDir: string;
  isDevelopment: boolean;
  isTest: boolean;
};

type EngineInstallationState =
  | { type: "idle" }
  | { type: "installing"; engineIds: Set<EngineId> };

type LaunchContextState =
  | { type: "uninitialized" }
  | { type: "initialized"; context: WelcomeWindowLaunchContext };

class WelcomeWindowManager {
  private _win: BrowserWindow | undefined;
  private _ipc: IpcSendProxy<WelcomeIpcSOData> | undefined;
  private staticDir: string;
  private isDevelopment: boolean;
  private isTest: boolean;
  private launchContextState: LaunchContextState = { type: "uninitialized" };
  private engineInstallationState: EngineInstallationState = { type: "idle" };

  constructor(payload: WindowManagerOption) {
    this.staticDir = payload.staticDir;
    this.isDevelopment = payload.isDevelopment;
    this.isTest = payload.isTest;
  }

  /**
   * BrowserWindowを取得する
   */
  public get win() {
    return this._win;
  }

  public isInitialized() {
    return this._win != undefined;
  }

  /**
   * BrowserWindowを取得するが存在しない場合は例外を投げる
   */
  public getWindow() {
    if (this._win == undefined) {
      throw new Error("_win == undefined");
    }
    return this._win;
  }

  /**
   * BrowserWindowのIPC送信用プロキシを取得する
   */
  public get ipc() {
    if (this._ipc == undefined) {
      throw new Error("_ipc == undefined");
    }
    return this._ipc;
  }

  /** Welcomeウィンドウを指定コンテキストで作成する。 */
  public async createWindow(
    context: WelcomeWindowLaunchContext,
  ): Promise<void> {
    if (this.win != undefined) {
      throw new Error("Window has already been created");
    }
    const configManager = getConfigManager();
    const currentTheme = configManager.get("currentTheme");
    const backgroundColor = themes.find((value) => value.name == currentTheme)
      ?.colors.background;

    const win = new BrowserWindow({
      minWidth: 320,
      backgroundColor,
      webPreferences: {
        preload: path.join(import.meta.dirname, "welcomePreload.cjs"),
      },
      icon: path.join(this.staticDir, "icon.png"),
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 6, y: 4 },
      frame: false,
    });
    const ipc = createIpcSendProxy<WelcomeIpcSOData>(win);
    this._ipc = ipc;
    const welcomeIpcMainHandleManager = getWelcomeIpcMainHandleManager();
    welcomeIpcMainHandleManager.attachTo(win);

    win.on("maximize", () => {
      ipc.DETECT_MAXIMIZED();
    });
    win.on("unmaximize", () => {
      ipc.DETECT_UNMAXIMIZED();
    });
    win.on("enter-full-screen", () => {
      ipc.DETECT_ENTER_FULLSCREEN();
    });
    win.on("leave-full-screen", () => {
      ipc.DETECT_LEAVE_FULLSCREEN();
    });
    win.on("close", (event) => {
      if (this.isEngineInstallationInProgress()) {
        event.preventDefault();
        return;
      }
      const appStateController = getAppStateController();
      void appStateController.onQuitRequest({
        preventQuit: () => event.preventDefault(),
      });
    });
    win.on("closed", () => {
      this._win = undefined;
      this._ipc = undefined;
      this.launchContextState = { type: "uninitialized" };
    });
    this._win = win;
    this.launchContextState = { type: "initialized", context };

    await this.load();

    if (this.isDevelopment && !this.isTest) win.webContents.openDevTools();
  }

  public async load() {
    const win = this.getWindow();
    let firstUrl: URL;
    if (import.meta.env.VITE_DEV_SERVER_URL != undefined) {
      firstUrl = new URL(import.meta.env.VITE_DEV_SERVER_URL);
      firstUrl.pathname = "/welcome/index.html";
    } else {
      firstUrl = new URL(`app://./welcome/index.html`);
    }
    await win.loadURL(firstUrl.toString());
  }

  public async reload() {
    const win = this.getWindow();
    win.hide(); // FIXME: ダミーページ表示のほうが良い

    // 一旦適当なURLに飛ばしてページをアンロードする
    await win.loadURL("about:blank");

    await this.load();
    win.show();
  }

  public togglePinWindow() {
    const win = this.getWindow();
    if (win.isAlwaysOnTop()) {
      win.setAlwaysOnTop(false);
    } else {
      win.setAlwaysOnTop(true);
    }
  }

  public toggleMaximizeWindow() {
    const win = this.getWindow();
    // 全画面表示中は、全画面表示解除のみを行い、最大化解除処理は実施しない
    if (win.isFullScreen()) {
      win.setFullScreen(false);
    } else if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }

  public toggleFullScreen() {
    const win = this.getWindow();
    if (win.isFullScreen()) {
      win.setFullScreen(false);
    } else {
      win.setFullScreen(true);
    }
  }

  public restoreAndFocus() {
    const win = this.getWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  }

  public zoomIn() {
    const win = this.getWindow();
    win.webContents.setZoomFactor(
      Math.min(Math.max(win.webContents.getZoomFactor() + 0.1, 0.5), 3),
    );
  }

  public zoomOut() {
    const win = this.getWindow();
    win.webContents.setZoomFactor(
      Math.min(Math.max(win.webContents.getZoomFactor() - 0.1, 0.5), 3),
    );
  }

  public zoomReset() {
    const win = this.getWindow();
    win.webContents.setZoomFactor(1);
  }

  public destroyWindow(): void {
    if (this.isEngineInstallationInProgress()) {
      throw new Error(
        "エンジンのインストール中はWelcomeウィンドウを閉じられません。",
      );
    }
    this.getWindow().destroy();
  }

  /** エンジンのインストールを開始状態にする。 */
  public beginEngineInstallation(engineId: EngineId): void {
    const state = this.engineInstallationState;
    if (state.type === "idle") {
      this.engineInstallationState = {
        type: "installing",
        engineIds: new Set([engineId]),
      };
      return;
    }
    if (state.engineIds.has(engineId)) {
      throw new Error(
        `エンジンのインストールがすでに実行中です。エンジンID: ${engineId}`,
      );
    }
    const engineIds = new Set(state.engineIds);
    engineIds.add(engineId);
    this.engineInstallationState = { type: "installing", engineIds };
  }

  /** エンジンのインストールを完了状態にする。 */
  public endEngineInstallation(engineId: EngineId): void {
    const state = this.engineInstallationState;
    if (state.type === "idle" || !state.engineIds.has(engineId)) {
      throw new Error(
        `エンジンのインストール状態が不正です。エンジンID: ${engineId}`,
      );
    }
    const engineIds = new Set(state.engineIds);
    engineIds.delete(engineId);
    this.engineInstallationState =
      engineIds.size === 0
        ? { type: "idle" }
        : { type: "installing", engineIds };
  }

  /** エンジンのインストール中かどうかを取得する。 */
  public isEngineInstallationInProgress(): boolean {
    return this.engineInstallationState.type === "installing";
  }

  /** エンジンの進捗をWelcomeウィンドウへ送信する。 */
  public sendEngineDownloadProgress(
    obj: WelcomeIpcSOData["UPDATE_ENGINE_DOWNLOAD_PROGRESS"]["args"][0],
  ): void {
    const win = this._win;
    if (
      win == undefined ||
      win.isDestroyed() ||
      win.webContents.isDestroyed()
    ) {
      log.warn(
        "破棄済みのWelcomeウィンドウにはエンジンのダウンロード進捗を送信できません。",
      );
      return;
    }
    this.ipc.UPDATE_ENGINE_DOWNLOAD_PROGRESS(obj);
  }

  public show() {
    this.getWindow().show();
  }

  public minimize() {
    this.getWindow().minimize();
  }

  public isMaximized() {
    return this.getWindow().isMaximized();
  }

  /** Welcomeウィンドウの起動コンテキストを取得する。 */
  public getLaunchContext(): WelcomeWindowLaunchContext {
    if (this.launchContextState.type === "uninitialized") {
      throw new Error(
        "Welcomeウィンドウの起動コンテキストが初期化されていません。",
      );
    }
    return this.launchContextState.context;
  }

  public showOpenDialogSync(options: OpenDialogSyncOptions) {
    return this._win == undefined
      ? dialog.showOpenDialogSync(options)
      : dialog.showOpenDialogSync(this.getWindow(), options);
  }

  public showOpenDialog(options: OpenDialogOptions) {
    return this._win == undefined
      ? dialog.showOpenDialog(options)
      : dialog.showOpenDialog(this.getWindow(), options);
  }

  public showSaveDialog(options: SaveDialogOptions) {
    return this._win == undefined
      ? dialog.showSaveDialog(options)
      : dialog.showSaveDialog(this.getWindow(), options);
  }

  public showMessageBoxSync(options: MessageBoxSyncOptions) {
    return this._win == undefined
      ? dialog.showMessageBoxSync(options)
      : dialog.showMessageBoxSync(this.getWindow(), options);
  }

  public showMessageBox(options: MessageBoxOptions) {
    return this._win == undefined
      ? dialog.showMessageBox(options)
      : dialog.showMessageBox(this.getWindow(), options);
  }
}

let windowManager: WelcomeWindowManager | undefined;

export function initializeWelcomeWindowManager(payload: WindowManagerOption) {
  windowManager = new WelcomeWindowManager(payload);
}

export function getWelcomeWindowManager() {
  if (windowManager == undefined) {
    throw new Error("WindowManager is not initialized");
  }
  return windowManager;
}
