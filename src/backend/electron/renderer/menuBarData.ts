import { computed } from "vue";
import { useEngineIcons } from "@/composables/useEngineIcons";
import { MenuBarDataOrRef } from "@/domain/menuBarData";
import { useStore } from "@/store";
import { MenuItemData, MenuItemRoot } from "@/components/Menu/type";

export const useElectronMenuBarData = (): MenuBarDataOrRef => {
  const store = useStore();

  const engineIds = computed(() => store.state.engineIds);
  const engineInfos = computed(() => store.state.engineInfos);
  const engineManifests = computed(() => store.state.engineManifests);
  const engineIcons = useEngineIcons(engineManifests);
  const enableMultiEngine = computed(() => store.state.enableMultiEngine);
  // 「エンジン」メニューのエンジン毎の項目
  const engineSubMenuData = computed<MenuItemData[]>(() => {
    let subMenu: MenuItemData[] = [];

    if (Object.values(engineInfos.value).length === 1) {
      const engineInfo = Object.values(engineInfos.value)[0];
      subMenu = [
        {
          type: "button",
          label: "再起動",
          onClick: () => {
            void store.actions.RESTART_ENGINES({
              engineIds: [engineInfo.uuid],
            });
          },
          disableWhenUiLocked: false,
        },
      ].filter((x) => x) as MenuItemData[];
    } else {
      subMenu = [
        ...store.getters.GET_SORTED_ENGINE_INFOS.map(
          (engineInfo) =>
            ({
              type: "root",
              label: engineInfo.name,
              icon:
                engineManifests.value[engineInfo.uuid] &&
                engineIcons.value[engineInfo.uuid],
              subMenu: [
                engineInfo.path && {
                  type: "button",
                  label: "フォルダを開く",
                  onClick: () => {
                    void store.actions.OPEN_ENGINE_DIRECTORY({
                      engineId: engineInfo.uuid,
                    });
                  },
                  disableWhenUiLocked: false,
                },
                {
                  type: "button",
                  label: "再起動",
                  onClick: () => {
                    void store.actions.RESTART_ENGINES({
                      engineIds: [engineInfo.uuid],
                    });
                  },
                  disableWhenUiLocked: false,
                },
              ].filter((x) => x),
            }) as MenuItemRoot,
        ),
        {
          type: "separator",
        },
        {
          type: "button",
          label: "全てのエンジンを再起動",
          onClick: () => {
            void store.actions.RESTART_ENGINES({
              engineIds: engineIds.value,
            });
          },
          disableWhenUiLocked: false,
        },
      ];
    }
    if (enableMultiEngine.value) {
      subMenu.push({
        type: "button",
        label: "エンジンの管理",
        onClick: () => {
          void store.actions.SET_DIALOG_OPEN({
            isEngineManageDialogOpen: true,
          });
        },
        disableWhenUiLocked: false,
      });
    }
    // マルチエンジンオフモードの解除
    if (store.state.isMultiEngineOffMode) {
      subMenu.push({
        type: "button",
        label: "マルチエンジンをオンにして再読み込み",
        onClick() {
          void store.actions.RELOAD_APP({
            isMultiEngineOffMode: false,
          });
        },
        disableWhenUiLocked: false,
        disablreloadingLocked: true,
      });
    }

    return subMenu;
  });

  return {
    file: [],
    edit: [],
    view: [],
    engine: engineSubMenuData,
    setting: [],
  };
};
