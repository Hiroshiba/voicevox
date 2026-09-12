<template>
  <ErrorBoundary>
    <TooltipProvider disableHoverableContent :delayDuration="500">
      <MenuBar />
      <QLayout reveal container>
        <WelcomeHeader />

        <QPageContainer>
          <QPage class="welcome-page">
            <BaseScrollArea>
              <div class="inner">
                <BaseDocumentView class="welcome-intro">
                  <template
                    v-if="store.initialSetupState.value === 'preparing'"
                  >
                    音声合成エンジンを準備しています。準備が完了すると、自動でエディタが開きます。
                  </template>
                  <template
                    v-else-if="store.initialSetupState.value === 'failed'"
                  >
                    音声合成エンジンの準備に失敗しました。以下のエンジン一覧から再試行してください。
                  </template>
                  <template v-else>
                    VOICEVOXエディタを使用するには、音声合成エンジンのインストールが必要です。
                    以下のエンジン一覧から、インストールまたは更新を行ってください。
                  </template>
                </BaseDocumentView>

                <EngineList />
              </div>
            </BaseScrollArea>
          </QPage>
        </QPageContainer>
      </QLayout>
    </TooltipProvider>
  </ErrorBoundary>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { TooltipProvider } from "reka-ui";
import MenuBar from "./MenuBar.vue";
import WelcomeHeader from "./WelcomeHeader.vue";
import EngineList from "./EngineList.vue";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import BaseScrollArea from "@/components/Base/BaseScrollArea.vue";
import BaseDocumentView from "@/components/Base/BaseDocumentView.vue";
import { provideWelcomeStore } from "@/welcome/store";

const store = provideWelcomeStore();

onMounted(() => {
  void store.initialize();
});
</script>

<style scoped lang="scss">
@use "@/styles/v2/colors" as colors;
@use "@/styles/v2/mixin" as mixin;
@use "@/styles/v2/variables" as vars;

.welcome-page {
  padding: 0;
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
</style>
