import { createApp } from "vue";
import { createGtm } from "@gtm-support/vue-gtm";
import { Quasar, Dialog, Loading, Notify } from "quasar";
import iconSet from "quasar/icon-set/material-icons";
import { store, storeKey } from "./store";
import { ipcMessageReceiver } from "./plugins/ipcMessageReceiverPlugin";
import { hotkeyPlugin } from "./plugins/hotkeyPlugin";
import {
  getOrThrowIpcResult,
  IpcResult,
} from "./backend/electron/ipcResultHelper";
import { Sandbox } from "./type/preload";
import App from "@/components/App.vue";
import { markdownItPlugin } from "@/plugins/markdownItPlugin";

import "@quasar/extras/material-icons/material-icons.css";
import "quasar/dist/quasar.sass";
import "./styles/_index.scss";

// NOTE: 起動後、設定を読み込んでからvue-gtmを有効化する関係上、dataLayerの用意が間に合わず、値が欠落してしまう箇所が存在する
//       ため、それを防止するため自前でdataLayerをあらかじめ用意する
window.dataLayer = [];

// mainWorldで使用するためのAPIアンラッパー
function createMainWorldApiProxy(sandboxApi: Sandbox): Sandbox {
  console.log("createMainWorldApiProxy");
  return new Proxy({} as Sandbox, {
    get: (_, prop: keyof Sandbox) => {
      const original = sandboxApi[prop];
      if (typeof original !== "function")
        throw new Error(`${prop} is not a function`);
      return async (...args: unknown[]) => {
        console.log(`get ${prop}`);
        // @ts-expect-error 型パズルが難しいので無視
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result = await original(...args);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        return getOrThrowIpcResult(result as IpcResult<unknown>);
      };
    },
  });
}

// @ts-expect-error 型パズルが難しいので無視
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
window.electron = createMainWorldApiProxy(window.electron);

createApp(App)
  .use(store, storeKey)
  .use(
    createGtm({
      id: import.meta.env.VITE_GTM_CONTAINER_ID ?? "GTM-DUMMY",
      // NOTE: 最初はgtm.jsを読まず、プライバシーポリシーに同意後に読み込む
      enabled: false,
    }),
  )
  .use(Quasar, {
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
  })
  .use(hotkeyPlugin)
  .use(ipcMessageReceiver, { store })
  .use(markdownItPlugin)
  .mount("#app");
