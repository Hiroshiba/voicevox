import { mount, shallowMount } from "@vue/test-utils";
import { effectScope, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import ParameterPanelEditTargetSwitcher from "@/components/Sing/ParameterPanelEditTargetSwitcher.vue";
import SequencerParameterPanel from "@/components/Sing/SequencerParameterPanel.vue";
import SequencerPhonemeTimingEditor from "@/components/Sing/SequencerPhonemeTimingEditor.vue";
import SequencerVolumeEditor from "@/components/Sing/SequencerVolumeEditor/Container.vue";
import { useSequencerParameterPanel } from "@/composables/useSequencerParameterPanel";
import type { ViewportInfo } from "@/sing/viewHelper";
import type { ParameterPanelEditTarget } from "@/store/type";

type ExperimentalFlags = {
  enableVolumeEditInSongEditor: boolean;
  enablePhonemeTimingEditInSongEditor: boolean;
};

type TestState = {
  experimentalSetting: ExperimentalFlags;
  parameterPanelEditTarget: ParameterPanelEditTarget;
};

const viewportInfo: ViewportInfo = {
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
};

const createParameterPanelControl = (
  flags: ExperimentalFlags,
  editTarget: ParameterPanelEditTarget,
) => {
  const state = reactive<TestState>({
    experimentalSetting: { ...flags },
    parameterPanelEditTarget: editTarget,
  });
  const setParameterPanelEditTarget = vi.fn(
    async ({ editTarget }: { editTarget: ParameterPanelEditTarget }) => {
      state.parameterPanelEditTarget = editTarget;
    },
  );
  const scope = effectScope();
  const control = scope.run(() =>
    useSequencerParameterPanel({
      state,
      actions: {
        SET_PARAMETER_PANEL_EDIT_TARGET: setParameterPanelEditTarget,
      },
    }),
  );
  if (control == undefined) {
    throw new Error("パラメーターパネルの制御を作成できませんでした。");
  }

  return {
    state,
    control,
    setParameterPanelEditTarget,
    stop: () => scope.stop(),
  };
};

describe("useSequencerParameterPanel", () => {
  it.each([
    {
      name: "両方無効",
      flags: {
        enableVolumeEditInSongEditor: false,
        enablePhonemeTimingEditInSongEditor: false,
      },
      expectedOpen: false,
      expectedEditTarget: "VOLUME",
      expectedActionCount: 0,
    },
    {
      name: "ボリューム編集だけ有効",
      flags: {
        enableVolumeEditInSongEditor: true,
        enablePhonemeTimingEditInSongEditor: false,
      },
      expectedOpen: true,
      expectedEditTarget: "VOLUME",
      expectedActionCount: 0,
    },
    {
      name: "音素タイミング編集だけ有効",
      flags: {
        enableVolumeEditInSongEditor: false,
        enablePhonemeTimingEditInSongEditor: true,
      },
      expectedOpen: true,
      expectedEditTarget: "PHONEME_TIMING",
      expectedActionCount: 1,
    },
    {
      name: "両方有効",
      flags: {
        enableVolumeEditInSongEditor: true,
        enablePhonemeTimingEditInSongEditor: true,
      },
      expectedOpen: true,
      expectedEditTarget: "VOLUME",
      expectedActionCount: 0,
    },
  ] satisfies {
    name: string;
    flags: ExperimentalFlags;
    expectedOpen: boolean;
    expectedEditTarget: ParameterPanelEditTarget;
    expectedActionCount: number;
  }[])(
    "$nameの場合に表示状態と編集対象が正しい",
    ({ flags, expectedOpen, expectedEditTarget, expectedActionCount }) => {
      const result = createParameterPanelControl(flags, "VOLUME");

      expect(result.control.isParameterPanelOpen.value).toBe(expectedOpen);
      expect(result.state.parameterPanelEditTarget).toBe(expectedEditTarget);
      expect(result.setParameterPanelEditTarget).toHaveBeenCalledTimes(
        expectedActionCount,
      );

      result.stop();
    },
  );

  it("選択中のボリューム編集を無効にすると音素タイミング編集へ切り替える", () => {
    const result = createParameterPanelControl(
      {
        enableVolumeEditInSongEditor: true,
        enablePhonemeTimingEditInSongEditor: true,
      },
      "VOLUME",
    );

    result.state.experimentalSetting.enableVolumeEditInSongEditor = false;

    expect(result.state.parameterPanelEditTarget).toBe("PHONEME_TIMING");
    expect(result.setParameterPanelEditTarget).toHaveBeenCalledExactlyOnceWith({
      editTarget: "PHONEME_TIMING",
    });

    result.stop();
  });

  it("選択中の音素タイミング編集を無効にするとボリューム編集へ切り替える", () => {
    const result = createParameterPanelControl(
      {
        enableVolumeEditInSongEditor: true,
        enablePhonemeTimingEditInSongEditor: true,
      },
      "PHONEME_TIMING",
    );

    result.state.experimentalSetting.enablePhonemeTimingEditInSongEditor = false;

    expect(result.state.parameterPanelEditTarget).toBe("VOLUME");
    expect(result.setParameterPanelEditTarget).toHaveBeenCalledExactlyOnceWith({
      editTarget: "VOLUME",
    });

    result.stop();
  });

  it("両方無効になった場合は選択中の編集対象を変更しない", () => {
    const result = createParameterPanelControl(
      {
        enableVolumeEditInSongEditor: true,
        enablePhonemeTimingEditInSongEditor: false,
      },
      "VOLUME",
    );

    result.state.experimentalSetting.enableVolumeEditInSongEditor = false;

    expect(result.control.isParameterPanelOpen.value).toBe(false);
    expect(result.state.parameterPanelEditTarget).toBe("VOLUME");
    expect(result.setParameterPanelEditTarget).not.toHaveBeenCalled();

    result.stop();
  });
});

describe("SequencerParameterPanel", () => {
  it.each([
    {
      name: "両方無効",
      flags: {
        enableVolumeEditInSongEditor: false,
        enablePhonemeTimingEditInSongEditor: false,
      },
      editTarget: "VOLUME",
      expectedButtonTargets: [],
      expectedVolumeEditor: false,
      expectedPhonemeTimingEditor: false,
    },
    {
      name: "ボリューム編集だけ有効",
      flags: {
        enableVolumeEditInSongEditor: true,
        enablePhonemeTimingEditInSongEditor: false,
      },
      editTarget: "VOLUME",
      expectedButtonTargets: ["VOLUME"],
      expectedVolumeEditor: true,
      expectedPhonemeTimingEditor: false,
    },
    {
      name: "音素タイミング編集だけ有効",
      flags: {
        enableVolumeEditInSongEditor: false,
        enablePhonemeTimingEditInSongEditor: true,
      },
      editTarget: "PHONEME_TIMING",
      expectedButtonTargets: ["PHONEME_TIMING"],
      expectedVolumeEditor: false,
      expectedPhonemeTimingEditor: true,
    },
    {
      name: "両方有効",
      flags: {
        enableVolumeEditInSongEditor: true,
        enablePhonemeTimingEditInSongEditor: true,
      },
      editTarget: "VOLUME",
      expectedButtonTargets: ["PHONEME_TIMING", "VOLUME"],
      expectedVolumeEditor: true,
      expectedPhonemeTimingEditor: false,
    },
  ] satisfies {
    name: string;
    flags: ExperimentalFlags;
    editTarget: ParameterPanelEditTarget;
    expectedButtonTargets: ParameterPanelEditTarget[];
    expectedVolumeEditor: boolean;
    expectedPhonemeTimingEditor: boolean;
  }[])(
    "$nameの場合に対応する切り替えボタンとエディターだけを表示する",
    async ({
      flags,
      editTarget,
      expectedButtonTargets,
      expectedVolumeEditor,
      expectedPhonemeTimingEditor,
    }) => {
      const changeEditTarget = vi.fn();
      const panel = shallowMount(SequencerParameterPanel, {
        props: {
          viewportInfo,
          editTarget,
          ...flags,
          changeEditTarget,
        },
      });
      const switcher = mount(ParameterPanelEditTargetSwitcher, {
        props: {
          editTarget,
          ...flags,
          changeEditTarget,
        },
        global: {
          stubs: {
            QBtnGroup: { template: "<div><slot /></div>" },
            QBtn: { template: "<button><slot /></button>" },
            QIcon: true,
            QTooltip: true,
          },
        },
      });

      expect(panel.findComponent(SequencerVolumeEditor).exists()).toBe(
        expectedVolumeEditor,
      );
      expect(panel.findComponent(SequencerPhonemeTimingEditor).exists()).toBe(
        expectedPhonemeTimingEditor,
      );

      const buttons = switcher.findAll(".segment-switch");
      expect(buttons).toHaveLength(expectedButtonTargets.length);
      for (const [index, expectedTarget] of expectedButtonTargets.entries()) {
        await buttons[index].trigger("click");
        expect(changeEditTarget).toHaveBeenNthCalledWith(
          index + 1,
          expectedTarget,
        );
      }
    },
  );

  it("両方有効で音素タイミング編集を選択した場合は音素タイミングエディターだけを表示する", () => {
    const panel = shallowMount(SequencerParameterPanel, {
      props: {
        viewportInfo,
        editTarget: "PHONEME_TIMING",
        enableVolumeEditInSongEditor: true,
        enablePhonemeTimingEditInSongEditor: true,
        changeEditTarget: vi.fn(),
      },
    });

    expect(panel.findComponent(SequencerVolumeEditor).exists()).toBe(false);
    expect(panel.findComponent(SequencerPhonemeTimingEditor).exists()).toBe(
      true,
    );
  });
});
