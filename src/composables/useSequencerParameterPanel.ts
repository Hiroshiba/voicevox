import { computed, watch } from "vue";
import type { ParameterPanelEditTarget } from "@/store/type";
import type { ExperimentalSettingType } from "@/type/preload";

type SequencerParameterPanelStore = {
  state: {
    experimentalSetting: Pick<
      ExperimentalSettingType,
      "enableVolumeEditInSongEditor" | "enablePhonemeTimingEditInSongEditor"
    >;
    parameterPanelEditTarget: ParameterPanelEditTarget;
  };
  actions: {
    SET_PARAMETER_PANEL_EDIT_TARGET: (payload: {
      editTarget: ParameterPanelEditTarget;
    }) => Promise<void>;
  };
};

/** 歌唱エディタのパラメーターパネルの表示と編集対象を管理する。 */
export const useSequencerParameterPanel = (
  store: SequencerParameterPanelStore,
) => {
  const enableVolumeEditInSongEditor = computed(
    () => store.state.experimentalSetting.enableVolumeEditInSongEditor,
  );
  const enablePhonemeTimingEditInSongEditor = computed(
    () => store.state.experimentalSetting.enablePhonemeTimingEditInSongEditor,
  );
  const isParameterPanelOpen = computed(
    () =>
      enableVolumeEditInSongEditor.value ||
      enablePhonemeTimingEditInSongEditor.value,
  );
  const parameterPanelEditTarget = computed(
    () => store.state.parameterPanelEditTarget,
  );

  const setParameterPanelEditTarget = (
    editTarget: ParameterPanelEditTarget,
  ) => {
    void store.actions.SET_PARAMETER_PANEL_EDIT_TARGET({ editTarget });
  };

  watch(
    [
      parameterPanelEditTarget,
      enableVolumeEditInSongEditor,
      enablePhonemeTimingEditInSongEditor,
    ],
    ([editTarget, enableVolumeEdit, enablePhonemeTimingEdit]) => {
      if (
        editTarget === "VOLUME" &&
        !enableVolumeEdit &&
        enablePhonemeTimingEdit
      ) {
        setParameterPanelEditTarget("PHONEME_TIMING");
        return;
      }
      if (
        editTarget === "PHONEME_TIMING" &&
        !enablePhonemeTimingEdit &&
        enableVolumeEdit
      ) {
        setParameterPanelEditTarget("VOLUME");
      }
    },
    { immediate: true, flush: "sync" },
  );

  return {
    enableVolumeEditInSongEditor,
    enablePhonemeTimingEditInSongEditor,
    isParameterPanelOpen,
    parameterPanelEditTarget,
    setParameterPanelEditTarget,
  };
};
