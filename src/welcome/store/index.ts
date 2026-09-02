import { computed, inject, provide, ref } from "vue";
import type { InjectionKey } from "vue";
import type {
  EnginePackageEmbeddedInfo,
  EnginePackageCurrentInfo,
  EnginePackageLatestInfo,
} from "@/domain/enginePackage";
import {
  getDefaultRuntimeTarget,
  type RuntimeTarget,
} from "@/domain/defaultEngine/latestDefaultEngine";
import {
  welcomeWindowLaunchContextSchema,
  type WelcomeWindowLaunchContext,
} from "@/domain/welcome";
import { setThemeToCss } from "@/domain/dom";
import { themes } from "@/domain/theme";
import type { EngineId } from "@/type/preload";
import {
  assertNonNullable,
  ExhaustiveError,
  UnreachableError,
} from "@/type/utility";
import { showErrorDialog } from "@/components/Dialog/Dialog";

type LatestInfoState =
  | { type: "loading" }
  | { type: "fetched"; info: EnginePackageLatestInfo }
  | { type: "fetchError"; error: unknown };

type AllEngineState =
  | {
      type: "uninitialized";
    }
  | { type: "loading" }
  | {
      type: "loaded";
      engineIds: EngineId[];
      engineStates: Record<EngineId, EngineState>;
    };

/**
 * TUnionの中のTTargetに当てはまるものにTAddedをマージした型を返す。
 *
 * これを他のファイルで使う場合は、この型を他のユーティリティ系のファイルに移動すること。
 *
 * @example
 * ```ts
 * type Hoge =
 *  | { type: "type1" }
 *  | { type: "type2"; field: string };
 *
 * type Result = MergeToTarget<
 *   Hoge,
 *   { type: "type2" },
 *   { newField: string }
 * >;
 *
 * // Resultは以下の型になる
 * type Result =
 *  | { type: "type1" }
 *  | { type: "type2"; field: string; newField: string }; // TAddedがマージされている
 * ```
 */
type MergeToTarget<TUnion, TTarget, TAdded> = TUnion extends TTarget
  ? TUnion & TAdded
  : TUnion;

export type EngineProgressInfo =
  | {
      type: "idle" | "unavailable";
    }
  | {
      progress: number;
      type: "download" | "install";
    };

type EngineState = {
  embeddedInfo: EnginePackageEmbeddedInfo;
  currentInfo: EnginePackageCurrentInfo;

  latestInfo: MergeToTarget<
    LatestInfoState,
    { type: "fetched" },
    {
      progress: EngineProgressInfo;
      selectedRuntimeTarget: RuntimeTarget;
    }
  >;
};

type AutomaticInstallState =
  | { type: "disabled" }
  | { type: "waiting"; engineId: EngineId }
  | { type: "installing"; engineId: EngineId; target: RuntimeTarget }
  | { type: "succeeded"; engineId: EngineId; target: RuntimeTarget }
  | {
      type: "failed";
      engineId: EngineId;
      target: RuntimeTarget;
      error: unknown;
    };

type InstallResult = { type: "succeeded" } | { type: "failed"; error: unknown };

export type LaunchEditorState =
  | { enabled: true }
  | { enabled: false; reason: string };

function createWelcomeStore() {
  const allEngineState = ref<AllEngineState>({
    type: "uninitialized",
  });
  const automaticInstallState = ref<AutomaticInstallState>({
    type: "disabled",
  });

  const launchEditorState = computed<LaunchEditorState>(() => {
    if (
      allEngineState.value.type === "uninitialized" ||
      allEngineState.value.type === "loading"
    ) {
      return { enabled: false, reason: "エンジンの情報を読み込み中です。" };
    }
    const allEngineStateLoaded = allEngineState.value;
    if (
      allEngineState.value.engineIds.some((engineId) => {
        const latestInfo =
          allEngineStateLoaded.engineStates[engineId].latestInfo;
        return (
          latestInfo.type === "fetched" && latestInfo.progress.type !== "idle"
        );
      })
    ) {
      return { enabled: false, reason: "エンジンをインストール中です。" };
    }
    if (
      allEngineStateLoaded.engineIds.every((engineId) => {
        const currentInfo =
          allEngineStateLoaded.engineStates[engineId].currentInfo;
        return currentInfo.status === "notInstalled";
      })
    ) {
      return {
        enabled: false,
        reason: "エンジンがインストールされていません。",
      };
    }
    return { enabled: true };
  });

  const getSelectedRuntimeTarget = (engineId: EngineId): RuntimeTarget => {
    if (allEngineState.value.type !== "loaded") {
      throw new UnreachableError();
    }
    const engineState = allEngineState.value.engineStates[engineId];
    if (engineState.latestInfo.type !== "fetched") {
      throw new UnreachableError();
    }
    return engineState.latestInfo.selectedRuntimeTarget;
  };

  const setSelectedRuntimeTarget = (
    engineId: EngineId,
    target: RuntimeTarget,
  ) => {
    if (allEngineState.value.type !== "loaded") {
      throw new UnreachableError();
    }
    const engineState = allEngineState.value.engineStates[engineId];
    if (engineState.latestInfo.type !== "fetched") {
      throw new UnreachableError();
    }
    engineState.latestInfo.selectedRuntimeTarget = target;
  };

  const getEngineState = (engineId: EngineId) => {
    if (allEngineState.value.type !== "loaded") {
      throw new UnreachableError();
    }
    return allEngineState.value.engineStates[engineId];
  };

  const getEngineProgress = (engineId: EngineId): EngineProgressInfo => {
    if (allEngineState.value.type !== "loaded") {
      return { type: "unavailable" };
    }
    const engineState = allEngineState.value.engineStates[engineId];
    if (engineState.latestInfo.type !== "fetched") {
      return { type: "unavailable" };
    }
    return engineState.latestInfo.progress;
  };

  const setEngineProgress = (
    engineId: EngineId,
    progressInfo: EngineProgressInfo,
  ) => {
    if (allEngineState.value.type !== "loaded") {
      throw new UnreachableError();
    }
    const engineState = allEngineState.value.engineStates[engineId];
    if (engineState.latestInfo.type !== "fetched") {
      throw new UnreachableError();
    }
    engineState.latestInfo.progress = progressInfo;
  };

  const getInitialRuntimeTarget = (
    engineId: EngineId,
    latestInfo: EnginePackageLatestInfo,
  ): RuntimeTarget => {
    const automaticInstall = automaticInstallState.value;
    if (
      automaticInstall.type === "waiting" &&
      automaticInstall.engineId === engineId
    ) {
      return getDefaultRuntimeTarget(engineId, latestInfo);
    }

    const defaultRuntimeTargetInfo = latestInfo.availableRuntimeTargets.find(
      (targetInfo) => targetInfo.packageInfo.displayInfo.default,
    );
    assertNonNullable(
      defaultRuntimeTargetInfo,
      `推奨ランタイムターゲットがありません。エンジンID: ${engineId}`,
    );
    return defaultRuntimeTargetInfo.target;
  };

  const loadEngineEmbeddedInfos = async (): Promise<void> => {
    allEngineState.value = { type: "loading" };

    const engineIds =
      await window.welcomeBackend.getDownloadableDefaultEnginePackageIds();
    const engineStates: Record<EngineId, EngineState> = {};
    await Promise.all(
      engineIds.map(async (engineId) => {
        const info =
          await window.welcomeBackend.getEnginePackageEmbeddedInfo(engineId);
        engineStates[engineId] = {
          embeddedInfo: info,
          currentInfo: { status: "notInstalled" },
          latestInfo: { type: "loading" },
        };
      }),
    );
    allEngineState.value = {
      type: "loaded",
      engineIds,
      engineStates,
    };

    await Promise.all(
      engineIds.map((engineId) => fetchCurrentEngineInfo(engineId)),
    );

    const automaticInstall = automaticInstallState.value;
    if (automaticInstall.type === "waiting") {
      await maybeStartAutomaticInstall(automaticInstall.engineId);
    }
  };

  const fetchCurrentEngineInfo = async (engineId: EngineId): Promise<void> => {
    if (allEngineState.value.type !== "loaded") {
      throw new UnreachableError();
    }
    const currentInfo =
      await window.welcomeBackend.getEnginePackageCurrentInfo(engineId);
    const engineState = allEngineState.value.engineStates[engineId];
    engineState.currentInfo = currentInfo;
    await fetchEngineLatestInfo(engineId);
  };

  const fetchEngineLatestInfo = async (engineId: EngineId): Promise<void> => {
    if (allEngineState.value.type !== "loaded") {
      throw new UnreachableError();
    }
    const engineState = allEngineState.value.engineStates[engineId];
    engineState.latestInfo = { type: "loading" };
    try {
      const info =
        await window.welcomeBackend.getEnginePackageLatestInfo(engineId);
      engineState.latestInfo = {
        type: "fetched",
        info,
        progress: { type: "idle" },
        selectedRuntimeTarget: getInitialRuntimeTarget(engineId, info),
      };
    } catch (error) {
      window.welcomeBackend.logWarn(
        `Engine package ${engineId} remote info fetch failed`,
        error,
      );
      engineState.latestInfo = {
        type: "fetchError",
        error,
      };
      return;
    }
    await maybeStartAutomaticInstall(engineId);
  };

  const applyThemeFromConfig = async (): Promise<void> => {
    const currentTheme = await window.welcomeBackend.getCurrentTheme();
    const theme = themes.find((value) => value.name === currentTheme);
    assertNonNullable(theme, `Theme not found: ${currentTheme}`);
    setThemeToCss(theme);
  };

  const runInstallEngine = async (
    engineId: EngineId,
    target: RuntimeTarget,
  ): Promise<InstallResult> => {
    let started = false;
    try {
      if (getEngineProgress(engineId).type !== "idle") {
        throw new Error(
          `エンジンパッケージのインストールがすでに実行中です。エンジンID: ${engineId}`,
        );
      }
      setEngineProgress(engineId, { type: "download", progress: 0 });
      started = true;
      window.welcomeBackend.logInfo(
        `Engine package ${engineId} installation started.`,
      );
      await window.welcomeBackend.installEngine({ engineId, target });
      window.welcomeBackend.logInfo(
        `Engine package ${engineId} installation completed.`,
      );
      return { type: "succeeded" };
    } catch (error) {
      window.welcomeBackend.logError(
        `Engine package ${engineId} installation failed`,
        error,
      );
      return { type: "failed", error };
    } finally {
      if (started) {
        setEngineProgress(engineId, { type: "idle" });
      }
    }
  };

  const installEngine = async (engineId: EngineId): Promise<void> => {
    const target = getSelectedRuntimeTarget(engineId);
    const automaticInstall = automaticInstallState.value;
    if (
      automaticInstall.type === "waiting" &&
      automaticInstall.engineId === engineId
    ) {
      automaticInstallState.value = { type: "disabled" };
    }

    const result = await runInstallEngine(engineId, target);
    if (result.type === "failed") {
      await showErrorDialog(
        "エンジンのインストールに失敗しました",
        result.error,
      );
      return;
    }

    try {
      await fetchCurrentEngineInfo(engineId);
    } catch (error) {
      window.welcomeBackend.logError(
        `Engine package ${engineId} current info refresh failed`,
        error,
      );
      await showErrorDialog("エンジン情報の更新に失敗しました", error);
    }
  };

  const maybeStartAutomaticInstall = async (
    engineId: EngineId,
  ): Promise<void> => {
    const automaticInstall = automaticInstallState.value;
    if (
      automaticInstall.type !== "waiting" ||
      automaticInstall.engineId !== engineId
    ) {
      return;
    }
    if (allEngineState.value.type !== "loaded") {
      throw new UnreachableError();
    }

    const engineState = allEngineState.value.engineStates[engineId];
    if (engineState.currentInfo.status === "installed") {
      automaticInstallState.value = { type: "disabled" };
      return;
    }
    if (engineState.latestInfo.type !== "fetched") {
      return;
    }

    const target = engineState.latestInfo.selectedRuntimeTarget;
    automaticInstallState.value = {
      type: "installing",
      engineId,
      target,
    };
    const result = await runInstallEngine(engineId, target);
    if (result.type === "failed") {
      automaticInstallState.value = {
        type: "failed",
        engineId,
        target,
        error: result.error,
      };
      await showErrorDialog(
        "エンジンのインストールに失敗しました",
        result.error,
      );
      return;
    }

    automaticInstallState.value = {
      type: "succeeded",
      engineId,
      target,
    };
    await window.welcomeBackend.launchMainWindow();
  };

  const switchToMainWindow = () => {
    if (!launchEditorState.value.enabled) {
      throw new UnreachableError();
    }
    void window.welcomeBackend.launchMainWindow();
  };

  const initialize = async (): Promise<void> => {
    const launchContext: WelcomeWindowLaunchContext =
      welcomeWindowLaunchContextSchema.parse(
        await window.welcomeBackend.getWelcomeWindowLaunchContext(),
      );
    switch (launchContext.type) {
      case "initialSetup":
        automaticInstallState.value = {
          type: "waiting",
          engineId: launchContext.engineId,
        };
        break;
      case "initialSetupSelection":
      case "manual":
        automaticInstallState.value = { type: "disabled" };
        break;
      default:
        throw new ExhaustiveError(launchContext);
    }
    window.welcomeBackend.registerIpcHandler({
      updateEngineDownloadProgress: ({ engineId, progress, type }) => {
        if (getEngineProgress(engineId).type === "idle") {
          return;
        }
        setEngineProgress(engineId, { progress, type });
      },
    });
    await Promise.all([loadEngineEmbeddedInfos(), applyThemeFromConfig()]);
  };

  return {
    allEngineState,
    automaticInstallState,
    launchEditorState,
    getSelectedRuntimeTarget,
    setSelectedRuntimeTarget,
    getEngineState,
    getEngineProgress,
    fetchEngineLatestInfo,
    installEngine,
    switchToMainWindow,
    initialize,
  };
}

type WelcomeStore = ReturnType<typeof createWelcomeStore>;

const welcomeStoreKey: InjectionKey<WelcomeStore> = Symbol("welcomeStore");

export function provideWelcomeStore() {
  const store = createWelcomeStore();
  provide(welcomeStoreKey, store);
  return store;
}

export function useStore(): WelcomeStore {
  const store = inject(welcomeStoreKey);
  assertNonNullable(store, "WelcomeStore is not provided");
  return store;
}
