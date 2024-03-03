<template>
  <SequencerPitch v-if="showPitch" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "@/store";
import SequencerPitch from "@/components/Sing/SequencerPitch.vue";

const store = useStore();
const showPitch = computed(() => {
  return store.state.experimentalSetting.showPitchInSongEditor;
});
</script>
