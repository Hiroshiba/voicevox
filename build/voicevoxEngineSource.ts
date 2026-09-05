import { z } from "zod";

export const voicevoxEngineTransferModeSchema = z.enum(["copy", "move"]);
export type VoicevoxEngineTransferMode = z.infer<
  typeof voicevoxEngineTransferModeSchema
>;
export const voicevoxEngineSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("include"),
      directory: z.string().min(1),
      transferMode: voicevoxEngineTransferModeSchema,
    })
    .strict(),
  z.object({ kind: z.literal("exclude") }).strict(),
]);
export type VoicevoxEngineSource = z.infer<typeof voicevoxEngineSourceSchema>;
