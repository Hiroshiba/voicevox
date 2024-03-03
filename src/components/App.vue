<template>
  <KeepAlive v-if="openedEditor != undefined">
    <Component
      :is="openedEditor == 'talk' ? TalkEditor : SingEditor"
      :key="openedEditor"
      :show-pitch="experimentalSetting.showPitchInSongEditor"
    />
  </KeepAlive>
  <!-- <TalkEditor v-show="openedEditor == 'talk'" :show-pitch="false" />
  <SingEditor
    v-show="openedEditor == 'song'"
    :show-pitch="experimentalSetting.showPitchInSongEditor"
  /> -->
  <button @click="toggleShow">
    showPitchInSongEditor:
    {{ experimentalSetting.showPitchInSongEditor }}
  </button>
  <button @click="toggleEditor">toggleEditor: {{ openedEditor }}</button>
</template>

<script setup lang="ts">
import { onMounted, computed, ref } from "vue";
import TalkEditor from "@/components/Talk/TalkEditor.vue";
import SingEditor from "@/components/Sing/SingEditor.vue";
import { useStore } from "@/store";
import { EditorType } from "@/type/preload";

const store = useStore();
const experimentalSetting = computed(() => store.state.experimentalSetting);

const openedEditor = ref<EditorType>("talk");

const toggleShow = () => {
  store.dispatch("SET_EXPERIMENTAL_SETTING", {
    experimentalSetting: {
      ...experimentalSetting.value,
      ["showPitchInSongEditor"]:
        !experimentalSetting.value.showPitchInSongEditor,
    },
  });
};

const toggleEditor = () => {
  openedEditor.value = openedEditor.value == "talk" ? "song" : "talk";
};

onMounted(async () => {
  await store.dispatch("INIT_VUEX");
  await store.dispatch("SET_OPENED_EDITOR", { editor: "talk" });
});
</script>
