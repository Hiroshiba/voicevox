<template>
  <ErrorBoundary>
    <TooltipProvider disableHoverableContent :delayDuration="500">
      <MenuBar />
      <QLayout reveal container>
        <WelcomeHeader
          :launchEditorDisabledReason
          @launchEditor="switchToMainWindow"
        />

        <QPageContainer>
          <QPage class="welcome-page">
            <BaseScrollArea>
              <div class="inner">
                <BaseDocumentView class="welcome-intro">
                  VOICEVOXエディタを使用するには、音声合成エンジンのインストールが必要です。
                  以下のエンジン一覧から、インストールまたは更新を行ってください。
                </BaseDocumentView>

                <template v-if="engineInfosState.kind === 'fetched'">
                  <div
                    v-if="engineInfosState.online.kind === 'error'"
                    class="engine-error"
                  >
                    <div class="engine-error-text">
                      オンラインからエンジン情報を取得できませんでした。
                      ネットワークの状態を確認するか、再試行してください。
                      <p class="engine-error-detail">
                        {{ engineInfosState.online.message }}
                      </p>
                    </div>
                    <div class="engine-error-actions">
                      <BaseButton
                        label="再試行"
                        variant="primary"
                        @click="fetchInstalledEngineInfos"
                      />
                    </div>
                  </div>
                </template>

                <div
                  v-if="
                    engineInfosState.kind === 'uninitialized' ||
                    engineInfosState.kind === 'loadingLocal'
                  "
                  class="engine-loading"
                >
                  <QSpinner color="primary" size="2.5rem" :thickness="5" />
                  <div class="loading-text">読み込み中...</div>
                </div>
                <template v-else>
                  <EngineCard
                    v-for="item in engineCardItems"
                    :key="item.localInfo.package.engineId"
                    :engineName="item.localInfo.package.engineName"
                    :localInfo="item.localInfo"
                    :onlineInfo="getOnlineInfo(item)"
                    @selectRuntimeTarget="
                      (target) =>
                        setSelectedRuntimeTarget(
                          item.localInfo.package.engineId,
                          target,
                        )
                    "
                    @installEngine="
                      () => installEngine(item.localInfo.package.engineId)
                    "
                  />
                </template>
              </div>
            </BaseScrollArea>
          </QPage>
        </QPageContainer>
      </QLayout>
    </TooltipProvider>
  </ErrorBoundary>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { TooltipProvider } from "reka-ui";
import MenuBar from "./MenuBar.vue";
import WelcomeHeader from "./WelcomeHeader.vue";
import EngineCard from "./EngineCard.vue";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import {
  EnginePackageLocalInfo,
  EnginePackageRemoteInfo,
} from "@/backend/electron/engineAndVvppController";
import { EngineId } from "@/type/preload";
import type { RuntimeTarget } from "@/domain/defaultEngine/latetDefaultEngine";
import { setThemeToCss } from "@/domain/dom";
import { themes } from "@/domain/theme";
import BaseButton from "@/components/Base/BaseButton.vue";
import BaseScrollArea from "@/components/Base/BaseScrollArea.vue";
import BaseDocumentView from "@/components/Base/BaseDocumentView.vue";
import {
  assertNonNullable,
  ExhaustiveError,
  UnreachableError,
} from "@/type/utility";

type OnlineEngineInfosState =
  | { kind: "ok"; remote: EnginePackageRemoteInfo[] }
  | { kind: "error"; message: string };

type EngineInfosState =
  | { kind: "uninitialized" }
  | { kind: "loadingLocal" }
  | { kind: "fetchingLatest"; local: EnginePackageLocalInfo[] }
  | {
      kind: "fetched";
      local: EnginePackageLocalInfo[];
      online: OnlineEngineInfosState;
    };

const engineInfosState = ref<EngineInfosState>({ kind: "uninitialized" });

const runtimeTargetSelections = ref<Partial<Record<EngineId, RuntimeTarget>>>(
  {},
);

const getRemoteInfoOrThrow = (engineId: EngineId): EnginePackageRemoteInfo => {
  const state = engineInfosState.value;
  if (state.kind !== "fetched" || state.online.kind !== "ok") {
    throw new UnreachableError();
  }
  const remoteInfo = state.online.remote.find(
    (remote) => remote.package.engineId === engineId,
  );
  assertNonNullable(remoteInfo);
  return remoteInfo;
};

function getDefaultRuntimeTarget(
  remoteInfo: EnginePackageRemoteInfo,
): RuntimeTarget {
  let defaultTargetInfo = remoteInfo.availableRuntimeTargets.find(
    (targetInfo) => targetInfo.packageInfo.displayInfo.default,
  );
  defaultTargetInfo ??= remoteInfo.availableRuntimeTargets[0]; // NOTE: defaultは必ずあるはずだけど、重要な箇所なので念のためフォールバックを用意
  assertNonNullable(defaultTargetInfo);
  return defaultTargetInfo.target;
}

function getSelectedRuntimeTarget(
  engineId: EngineId,
  remoteInfo: EnginePackageRemoteInfo,
): RuntimeTarget {
  return (
    runtimeTargetSelections.value[engineId] ??
    getDefaultRuntimeTarget(remoteInfo)
  );
}

type EngineCardItem =
  | { kind: "localOnly"; localInfo: EnginePackageLocalInfo }
  | {
      kind: "withRemote";
      localInfo: EnginePackageLocalInfo;
      remoteInfo: EnginePackageRemoteInfo;
      selectedRuntimeTarget: RuntimeTarget;
    };

const engineCardItems = computed<EngineCardItem[]>(() => {
  const state = engineInfosState.value;
  if (state.kind === "uninitialized" || state.kind === "loadingLocal") {
    throw new UnreachableError();
  }
  if (state.kind !== "fetched" || state.online.kind !== "ok") {
    return state.local.map((localInfo) => ({ kind: "localOnly", localInfo }));
  }
  const remoteInfos = state.online.remote;
  return state.local.map((localInfo) => {
    const remoteInfo = remoteInfos.find(
      (remote) => remote.package.engineId === localInfo.package.engineId,
    );
    assertNonNullable(remoteInfo);
    return {
      kind: "withRemote",
      localInfo,
      remoteInfo,
      selectedRuntimeTarget: getSelectedRuntimeTarget(
        localInfo.package.engineId,
        remoteInfo,
      ),
    };
  });
});

const getInstallRuntimeTarget = (engineId: EngineId): RuntimeTarget => {
  const remoteInfo = getRemoteInfoOrThrow(engineId);
  return getSelectedRuntimeTarget(engineId, remoteInfo);
};

const setSelectedRuntimeTarget = (
  engineId: EngineId,
  target: RuntimeTarget,
) => {
  runtimeTargetSelections.value = {
    ...runtimeTargetSelections.value,
    [engineId]: target,
  };
};

type EngineProgressInfo = {
  progress: number;
  type: "download" | "install";
};
const engineProgressInfo = ref<Partial<Record<EngineId, EngineProgressInfo>>>(
  {},
);
const launchEditorDisabledReason = computed<string | null>(() => {
  const state = engineInfosState.value;
  switch (state.kind) {
    case "uninitialized":
    case "loadingLocal":
      return "エンジン情報を読み込み中です。";
    case "fetchingLatest":
    case "fetched":
      break;
    default:
      throw new ExhaustiveError(state);
  }
  if (Object.keys(engineProgressInfo.value).length > 0) {
    return "エンジンのインストールまたは更新中です。";
  }
  if (
    state.local.every(
      (engineInfo) => engineInfo.installed.status === "notInstalled",
    )
  ) {
    return "エンジンがインストールされていません。";
  }

  return null;
});

const clearEngineProgress = (engineId: EngineId) => {
  const { [engineId]: _, ...rest } = engineProgressInfo.value;
  engineProgressInfo.value = rest;
};

const getEngineProgress = (engineId: EngineId) =>
  engineProgressInfo.value[engineId];
const isDownloadingOrInstalling = (engineId: EngineId) => {
  const progress = getEngineProgress(engineId)?.progress;
  return progress != undefined && progress < 100;
};

const getOnlineInfo = (item: EngineCardItem) => {
  if (item.kind !== "withRemote") {
    return undefined;
  }
  const engineId = item.localInfo.package.engineId;
  return {
    remoteInfo: item.remoteInfo,
    selectedRuntimeTarget: item.selectedRuntimeTarget,
    runtimeSelectDisabled: isDownloadingOrInstalling(engineId),
    progressInfo: getEngineProgress(engineId),
  };
};

const installEngine = async (engineId: EngineId) => {
  const state = engineInfosState.value;
  if (state.kind !== "fetched" || state.online.kind !== "ok") {
    return;
  }
  const target = getInstallRuntimeTarget(engineId);
  engineProgressInfo.value[engineId] = { progress: 0, type: "download" };
  try {
    console.log(`Engine package ${engineId} installation started.`);
    await window.welcomeBackend.installEngine({
      engineId,
      target,
    });
    console.log(`Engine package ${engineId} installation completed.`);
  } catch (error) {
    window.welcomeBackend.logError(
      `Engine package ${engineId} installation failed`,
      error,
    );
  } finally {
    clearEngineProgress(engineId);
    void fetchInstalledEngineInfos();
  }
};

const switchToMainWindow = () => {
  if (launchEditorDisabledReason.value) {
    return;
  }
  void window.welcomeBackend.launchMainWindow();
};

const fetchInstalledEngineInfos = async () => {
  engineInfosState.value = { kind: "loadingLocal" };
  const local = await window.welcomeBackend.fetchEnginePackageLocalInfos();
  engineInfosState.value = { kind: "fetchingLatest", local };
  try {
    const remote =
      await window.welcomeBackend.fetchLatestEnginePackageRemoteInfos();
    engineInfosState.value = {
      kind: "fetched",
      local,
      online: { kind: "ok", remote },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "エンジン情報のオンライン取得に失敗しました。";
    window.welcomeBackend.logError(
      "エンジン情報のオンライン取得に失敗しました",
      error,
    );
    engineInfosState.value = {
      kind: "fetched",
      local,
      online: { kind: "error", message },
    };
  }
};

const applyThemeFromConfig = async () => {
  try {
    const currentTheme = await window.welcomeBackend.getCurrentTheme();
    const theme =
      themes.find((value) => value.name === currentTheme) ?? themes[0];
    if (!theme) {
      return;
    }
    setThemeToCss(theme);
  } catch (error) {
    window.welcomeBackend.logError("テーマの適用に失敗しました", error);
  }
};

onMounted(() => {
  void applyThemeFromConfig();

  window.welcomeBackend.registerIpcHandler({
    updateEngineDownloadProgress: ({ engineId, progress, type }) => {
      engineProgressInfo.value[engineId] = { progress, type };
    },
  });

  void fetchInstalledEngineInfos();
});
</script>

<style scoped lang="scss">
@use "@/styles/v2/colors" as colors;
@use "@/styles/v2/mixin" as mixin;
@use "@/styles/v2/variables" as vars;

.welcome-actions {
  display: flex;
  align-items: center;
  gap: vars.$gap-1;
  flex-wrap: wrap;
}

.welcome-page {
  padding: 0;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: vars.$padding-1 vars.$padding-2;
}

.list-title {
  @include mixin.headline-2;
}

.engine-list {
  display: flex;
  flex-direction: column;
  gap: vars.$gap-1;
  padding: 0 vars.$padding-1 vars.$padding-2;
}

.listitem-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.listitem-title {
  font-weight: 600;
}

.listitem-sub {
  display: flex;
  flex-wrap: wrap;
  gap: vars.$gap-1;
  font-size: 0.75rem;
  color: colors.$display-sub;
}

.listitem-progress {
  font-size: 0.7rem;
  color: colors.$display-sub;
}

.listitem-trailing {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.engine-loading {
  display: grid;
  place-items: center;
  gap: vars.$gap-1;
  padding: vars.$padding-2;
  color: colors.$display-sub;
}

.engine-error {
  display: flex;
  flex-direction: column;
  gap: vars.$gap-1;
  padding: vars.$padding-2;
  border-radius: vars.$radius-2;
  border: 1px solid colors.$warning;
  background-color: colors.$background-alt;
  color: colors.$display-warning;
}

.engine-error-detail {
  display: block;
  font-size: 0.75rem;
  color: colors.$display-warning;
  margin-top: vars.$gap-1;
  word-break: break-word;
  white-space: pre-wrap;
}

.engine-error-actions {
  display: flex;
  justify-content: flex-end;
}

.loading-text {
  font-size: 0.8rem;
}

.detail {
  height: 100%;
}

.inner {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: vars.$padding-2;
  gap: vars.$gap-2;
}

.welcome-intro :deep(h1) {
  margin-bottom: vars.$gap-1;
}

.section {
  display: flex;
  flex-direction: column;
  gap: vars.$gap-1;
}

.section-title {
  @include mixin.headline-3;
}

.empty-state {
  border: 1px solid colors.$border;
  border-radius: vars.$radius-2;
  padding: vars.$padding-2;
  color: colors.$display-sub;
  background-color: colors.$background-alt;
}

.empty-title {
  font-weight: 600;
}
</style>
