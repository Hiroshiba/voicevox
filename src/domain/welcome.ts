import { z } from "zod";
import { engineIdSchema } from "@/type/preload";

export const initialEngineTargetSchema = z.enum([
  "windows-x64-cpu",
  "windows-x64-directml",
  "windows-x64-cuda",
]);
export type InitialEngineTarget = z.infer<typeof initialEngineTargetSchema>;

export const welcomeWindowLaunchContextSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("initialSetup"),
    engineId: engineIdSchema,
    initialEngineTarget: initialEngineTargetSchema.optional(),
  }),
  z.object({ type: z.literal("manual") }),
]);
export type WelcomeWindowLaunchContext = z.infer<
  typeof welcomeWindowLaunchContextSchema
>;
