<template>
  <div>
    <span>song</span>
    <SequencerPitch v-if="showPitchState" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "@/store";
import SequencerPitch from "@/components/Sing/SequencerPitch.vue";
const props =
  defineProps<{
    showPitch: boolean;
  }>();

const store = useStore();
const showPitchState = computed(() => {
  console.log(
    "store.state.experimentalSetting.showPitchInSongEditor :",
    store.state.experimentalSetting.showPitchInSongEditor
  );
  console.log("props.showPitch :", props.showPitch);
  return store.state.experimentalSetting.showPitchInSongEditor;
  // return props.showPitch;
});
</script>
