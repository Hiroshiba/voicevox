import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  runtimeTargetSchema,
  type RuntimeTarget,
} from "@/domain/defaultEngine/latestDefaultEngine";

const vvppEngineMetadataFileName = "engine_install_metadata.json";
const vvppEngineMetadataSchema = z.object({
  target: runtimeTargetSchema,
});

/** VVPPエンジンの導入ターゲットを読み込む。 */
export function readVvppEngineMetadata(
  engineDir: string,
): { target: RuntimeTarget } | undefined {
  const metadataPath = path.join(engineDir, vvppEngineMetadataFileName);
  if (!fs.existsSync(metadataPath)) {
    return undefined;
  }
  return vvppEngineMetadataSchema.parse(
    JSON.parse(fs.readFileSync(metadataPath, "utf8")),
  );
}

/** VVPPエンジンの導入ターゲットを書き込む。 */
export async function writeVvppEngineMetadata(
  engineDir: string,
  target: RuntimeTarget,
): Promise<void> {
  const metadataPath = path.join(engineDir, vvppEngineMetadataFileName);
  await fs.promises.writeFile(metadataPath, JSON.stringify({ target }));
}
