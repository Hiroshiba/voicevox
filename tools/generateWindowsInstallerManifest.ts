import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { z } from "zod";

type ArtifactInfo = {
  name: string;
  size: number;
  sha512: string;
};

const engineManifestSchema = z.looseObject({
  uuid: z.string().min(1),
  version: z.string().min(1),
});

const packageJsonSchema = z.object({
  version: z.string().min(1),
});

type InstallerManifest = {
  editorVersion: string;
  engineUuid: string;
  engineVersion: string;
  runtimeTarget: string;
  package: ArtifactInfo;
  installer: ArtifactInfo;
};

const argv = await yargs(hideBin(process.argv))
  .option("package-directory", {
    type: "string",
    demandOption: true,
  })
  .option("engine-directory", {
    type: "string",
    demandOption: true,
  })
  .option("runtime-target", {
    type: "string",
    demandOption: true,
  })
  .strict()
  .help()
  .parse();

const packageDirectory = path.resolve(argv.packageDirectory);
const engineDirectory = path.resolve(argv.engineDirectory);
const runtimeTarget = z.string().min(1).parse(argv.runtimeTarget);
const editorVersion = packageJsonSchema.parse(
  JSON.parse(
    await fs.readFile(path.join(import.meta.dirname, "..", "package.json"), {
      encoding: "utf8",
    }),
  ),
).version;

const packageEntries = await fs.readdir(packageDirectory, {
  withFileTypes: true,
});
const packageFiles = packageEntries.filter(
  (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".nsis.7z"),
);
const installerFiles = packageEntries.filter(
  (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"),
);
if (packageFiles.length !== 1 || installerFiles.length !== 1) {
  throw new Error(
    `NSIS成果物を一意に特定できません。nsis.7z: ${packageFiles.length}、exe: ${installerFiles.length}`,
  );
}

const [packageFile] = packageFiles;
const [installerFile] = installerFiles;
const engineManifest = engineManifestSchema.parse(
  JSON.parse(
    await fs.readFile(path.join(engineDirectory, "engine_manifest.json"), {
      encoding: "utf8",
    }),
  ),
);
const packageInfo = await createArtifactInfo(
  path.join(packageDirectory, packageFile.name),
);
const installerInfo = await createArtifactInfo(
  path.join(packageDirectory, installerFile.name),
);
const manifest: InstallerManifest = {
  editorVersion,
  engineUuid: engineManifest.uuid,
  engineVersion: engineManifest.version,
  runtimeTarget,
  package: packageInfo,
  installer: installerInfo,
};

await fs.writeFile(
  path.join(packageDirectory, `${packageFile.name}.json`),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { encoding: "utf8" },
);

async function createArtifactInfo(filePath: string): Promise<ArtifactInfo> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(
      `成果物が通常ファイルではありません。ファイル: ${filePath}`,
    );
  }

  const hash = createHash("sha512");
  await pipeline(createReadStream(filePath), hash);

  return {
    name: path.basename(filePath),
    size: stat.size,
    sha512: hash.digest("hex"),
  };
}
