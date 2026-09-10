import { setup, type Preview } from "@storybook/vue3-vite";
import { Quasar, Dialog, Loading, Notify } from "quasar";
import iconSet from "quasar/icon-set/material-icons";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import { watchEffect } from "vue";
import { z } from "zod";
import { addActionsWithEmits } from "./utils/argTypesEnhancers";
import { store, storeKey } from "@/store";
import { markdownItPlugin } from "@/plugins/markdownItPlugin";

import "@quasar/extras/material-icons/material-icons.css";
import "quasar/dist/quasar.sass";
import "@/styles/_index.scss";
import { assertNonNullable } from "@/type/utility";
import { setThemeToCss, setFontToCss } from "@/domain/dom";
import { provideTheme } from "@/composables/useTheme";

setup((app) => {
  app.use(Quasar, {
    config: {
      brand: {
        primary: "#a5d4ad",
        secondary: "#212121",
        negative: "var(--color-warning)",
      },
    },
    iconSet,
    plugins: {
      Dialog,
      Loading,
      Notify,
    },
  });
  app.use(markdownItPlugin);
  app.use(store, storeKey);
});

const preview: Preview = {
  tags: ["autodocs"],
  parameters: {
    docs: {
      toc: true,
    },
    backgrounds: {
      default: "theme",
      values: [
        {
          name: "theme",
          value: "var(--color-v2-background)",
        },
        {
          name: "light",
          value: "#fff",
        },
        {
          name: "dark",
          value: "#333",
        },
      ],
      grid: {
        cellSize: 8,
        cellAmount: 4,
        opacity: 0.1,
      },
    },
  },
  decorators: [
    withThemeByDataAttribute({
      themes: {
        light: "false",
        dark: "true",
      },
      defaultTheme: "light",
      attributeName: "is-dark-theme",
    }),

    // テーマの設定をCSSへ反映する
    (_, context) => {
      const { themeOverride } = z
        .object({
          themeOverride: z.enum(["light", "dark"]).optional(),
        })
        .parse(context.parameters.themes ?? {});
      return {
        setup() {
          setFontToCss("default");
          const theme = provideTheme(() => {
            const selectedTheme = z
              .enum(["light", "dark"])
              .default("light")
              .parse(themeOverride ?? context.globals.theme);
            return selectedTheme === "dark" ? "Dark" : "Default";
          });
          watchEffect(
            () => {
              const currentTheme = theme.value;
              assertNonNullable(currentTheme);
              setThemeToCss(currentTheme);
            },
            { flush: "sync" },
          );
        },
        template: `<story />`,
      };
    },
  ],
  argTypesEnhancers: [addActionsWithEmits],
};

export default preview;
