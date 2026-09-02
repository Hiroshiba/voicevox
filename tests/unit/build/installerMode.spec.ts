import { describe, expect, it } from "vitest";
import { parseInstallerMode } from "../../../build/installerMode";

describe("インストーラーのエンジンモード", () => {
  it.each(["download-vvpp", "embed-engine"])(
    "有効なモード %s を受け入れる",
    (mode) => {
      expect(parseInstallerMode(mode)).toBe(mode);
    },
  );

  it.each([undefined, "", "download", "embed-engine-fallback"])(
    "無効なモード %s を拒否する",
    (mode) => {
      expect(() => parseInstallerMode(mode)).toThrow();
    },
  );
});
