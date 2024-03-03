<template>
  <div>pitch</div>
</template>

<script setup lang="ts">
import { onMountedOrActivated } from "@/composables/onMountOrActivate";

onMountedOrActivated(() => {
  console.log("呼ばれた");
});
</script>
