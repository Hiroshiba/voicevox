import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  provide,
  ref,
  toValue,
  type ComputedRef,
  type InjectionKey,
  type MaybeRefOrGetter,
} from "vue";
import { resolveTheme } from "@/domain/theme";
import type { ThemeConf, ThemeSetting } from "@/type/preload";
import { assertNonNullable } from "@/type/utility";

const themeKey: InjectionKey<ComputedRef<ThemeConf | undefined>> =
  Symbol("theme");

/** 環境の明暗を監視し、表示するテーマを子へ提供する */
export function provideTheme(
  setting: MaybeRefOrGetter<ThemeSetting | undefined>,
): ComputedRef<ThemeConf | undefined> {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const prefersDark = ref(media.matches);
  const updatePrefersDark = (): void => {
    prefersDark.value = media.matches;
  };

  onMounted(() => {
    media.addEventListener("change", updatePrefersDark);
    updatePrefersDark();
  });
  onUnmounted(() => {
    media.removeEventListener("change", updatePrefersDark);
  });

  const theme = computed(() => {
    const currentSetting = toValue(setting);
    if (currentSetting == undefined) return undefined;
    return resolveTheme(currentSetting, prefersDark.value);
  });
  provide(themeKey, theme);
  return theme;
}

/** ルートが提供する表示中のテーマを取得する */
export function useTheme(): ComputedRef<ThemeConf> {
  const theme = inject(themeKey);
  assertNonNullable(theme, "テーマが提供されていません");
  return computed(() => {
    const currentTheme = theme.value;
    assertNonNullable(currentTheme, "テーマが読み込まれていません");
    return currentTheme;
  });
}
