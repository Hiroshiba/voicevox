import { engineIdSchema } from "@/type/preload";
import { z } from "zod";

export const welcomeWindowLaunchContextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("initialSetup"), engineId: engineIdSchema }),
  z.object({ type: z.literal("initialSetupSelection") }),
  z.object({ type: z.literal("manual") }),
]);
export type WelcomeWindowLaunchContext = z.infer<
  typeof welcomeWindowLaunchContextSchema
>;
