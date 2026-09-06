import { z } from "zod";

export const voicevoxEngineTransferModeSchema = z.enum(["copy", "move"]);
export type VoicevoxEngineTransferMode = z.infer<
  typeof voicevoxEngineTransferModeSchema
>;
export type VoicevoxEngineSource =
  | {
      kind: "include";
      directory: string;
      transferMode: VoicevoxEngineTransferMode;
    }
  | { kind: "exclude" };
