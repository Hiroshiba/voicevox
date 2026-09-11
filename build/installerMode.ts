import { z } from "zod";

const installerModeSchema = z.enum(["download-vvpp", "embed-engine"]);

/** インストーラーのエンジンモードを厳密に検証する。 */
export function parseInstallerMode(value: unknown) {
  return installerModeSchema.parse(value);
}
