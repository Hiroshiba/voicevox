import { z } from "zod";

const installerModeSchema = z.enum(["download", "embed"]);

/** インストーラーのエンジンモードを厳密に検証する。 */
export function parseInstallerMode(value: unknown) {
  return installerModeSchema.parse(value);
}
