import path from "node:path";
import { readdirSync, existsSync, rmSync } from "node:fs";
import dotenv from "dotenv";
import type { Configuration as ElectronBuilderConfiguration } from "electron-builder";
import { z } from "zod";
import afterAllArtifactBuild from "./afterAllArtifactBuild";
import afterPack from "./afterPack";

const DEFAULT_VOICEVOX_ENGINE_DIR = "../voicevox_engine/dist/run/";
const voicevoxEngineSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("include"), directory: z.string().min(1) })
    .strict(),
  z.object({ kind: z.literal("exclude") }).strict(),
]);
type VoicevoxEngineSource = z.infer<typeof voicevoxEngineSourceSchema>;

/** VOICEVOX ENGINEの配置設定を解決する。 */
function resolveVoicevoxEngineSource(
  value: string | undefined,
): VoicevoxEngineSource {
  if (value == undefined) {
    return voicevoxEngineSourceSchema.parse({
      kind: "include",
      directory: DEFAULT_VOICEVOX_ENGINE_DIR,
    });
  }
  if (value === "") {
    return voicevoxEngineSourceSchema.parse({ kind: "exclude" });
  }
  return voicevoxEngineSourceSchema.parse({
    kind: "include",
    directory: value,
  });
}

const rootDir = path.join(import.meta.dirname, "..");
const dotenvPath = [
  path.join(rootDir, ".env.production.local"),
  path.join(rootDir, ".env.production"),
  path.join(rootDir, ".env.local"),
  path.join(rootDir, ".env"),
];
dotenv.config({ path: dotenvPath, quiet: true });

const voicevoxEngineSource = resolveVoicevoxEngineSource(
  process.env.VOICEVOX_ENGINE_DIR,
);

// ${productName} Web Setup ${version}.${ext}
const NSIS_WEB_ARTIFACT_NAME = process.env.NSIS_WEB_ARTIFACT_NAME;

// ${productName}-${version}.${ext}
const LINUX_ARTIFACT_NAME = process.env.LINUX_ARTIFACT_NAME;

// ${packageName}
const LINUX_EXECUTABLE_NAME = process.env.LINUX_EXECUTABLE_NAME;

// ${productName}-${version}.${ext}
const MACOS_ARTIFACT_NAME = process.env.MACOS_ARTIFACT_NAME;

// コード署名証明書
const winSigningHashAlgorithmsSchema = z.array(z.enum(["sha1", "sha256"]));
const WIN_CERTIFICATE_SHA1 = process.env.WIN_CERTIFICATE_SHA1;
const WIN_SIGNING_HASH_ALGORITHMS = process.env.WIN_SIGNING_HASH_ALGORITHMS
  ? winSigningHashAlgorithmsSchema.parse(
      JSON.parse(process.env.WIN_SIGNING_HASH_ALGORITHMS),
    )
  : undefined;

const isMac = process.platform === "darwin";

const isArm64 = process.arch === "arm64";

const macosCodeSigningMode = z
  .enum(["true", "false"])
  .optional()
  .parse(process.env.MACOS_CODE_SIGNING);
const isMacCodeSigning = isMac && macosCodeSigningMode === "true";

// electron-builderのextraFilesは、ファイルのコピー先としてVOICEVOX.app/Contents/を使用する。
// macOSで実行時に使用する7zzをVOICEVOX.app/Contents/MacOS/に配置する。
const extraFilePrefix = isMac ? "MacOS/" : "";
const macosVoicevoxEnginePath = "vv-engine";

const sevenZipFile = readdirSync(path.join(rootDir, "vendored", "7z")).find(
  // Windows: 7za.exe, Linux: 7zzs, macOS: 7zz
  (fileName) => ["7za.exe", "7zzs", "7zz"].includes(fileName),
);

if (!sevenZipFile) {
  throw new Error(
    "7z binary file not found. Run `node ./tools/download7z.ts` first.",
  );
}

const builderOptions: ElectronBuilderConfiguration = {
  beforeBuild: async () => {
    if (existsSync(path.join(rootDir, "dist_electron"))) {
      rmSync(path.join(rootDir, "dist_electron"), {
        recursive: true,
      });
    }
  },
  beforePack: (context) => {
    if (
      context.electronPlatformName !== "darwin" ||
      voicevoxEngineSource.kind !== "include"
    ) {
      return;
    }

    const macosEngineSourceDir = path.resolve(
      rootDir,
      voicevoxEngineSource.directory,
    );
    if (!existsSync(macosEngineSourceDir)) {
      throw new Error(
        `VOICEVOX ENGINEの配置元が見つかりません: ${macosEngineSourceDir}`,
      );
    }

    const macosEngineRunPath = path.join(macosEngineSourceDir, "run");
    if (!existsSync(macosEngineRunPath)) {
      throw new Error(
        `VOICEVOX ENGINEのrunが見つかりません: ${macosEngineRunPath}`,
      );
    }
  },
  directories: {
    output: "dist_electron",
    buildResources: "build",
  },
  files: ["dist/**/*", "package.json"],
  fileAssociations: [
    {
      ext: "vvproj",
      name: "VOICEVOX Project file",
      description: "VOICEVOX Project file",
      role: "Editor",
      icon: "icons/vvproj." + (isMac ? "icns" : "ico"),
    },
    {
      ext: "vvpp",
      name: "VOICEVOX Plugin package",
      description: "VOICEVOX Plugin package",
      role: "Editor",
      icon: "icons/vvpp." + (isMac ? "icns" : "ico"),
    },
    {
      ext: "vvppp",
      name: "VOICEVOX Plugin package (part)",
      description: "VOICEVOX Plugin package (part)",
      role: "Editor",
      icon: "icons/vvpp." + (isMac ? "icns" : "ico"),
    },
  ],
  extraFiles: [
    {
      from: "build/README.txt",
      to: isMac ? "Resources/README.txt" : "README.txt",
    },
    ...(!isMac && voicevoxEngineSource.kind === "include"
      ? [
          {
            from: voicevoxEngineSource.directory,
            to: path.join(extraFilePrefix, "vv-engine"),
          },
        ]
      : []),
    {
      from: path.join(rootDir, "vendored", "7z", sevenZipFile),
      to: extraFilePrefix + sevenZipFile,
    },
  ],
  ...(isMac && voicevoxEngineSource.kind === "include"
    ? {
        extraResources: [
          {
            from: path.resolve(rootDir, voicevoxEngineSource.directory),
            to: macosVoicevoxEnginePath,
          },
        ],
      }
    : {}),
  // electron-builder installer
  productName: "VOICEVOX",
  appId: "jp.hiroshiba.voicevox",
  copyright: "Hiroshiba Kazuyuki",
  afterAllArtifactBuild,
  afterPack: (context) => afterPack(context, voicevoxEngineSource.kind),
  ...(isMacCodeSigning ? { forceCodeSigning: true } : {}),
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  electronLanguages: ["en-US", "ja"],
  toolsets: {
    appimage: "1.0.3",
  },
  win: {
    icon: "public/icon.png",
    target: [
      {
        target: "nsis-web",
        arch: ["x64"],
      },
    ],
    signtoolOptions: {
      certificateSha1: WIN_CERTIFICATE_SHA1 || undefined,
      signingHashAlgorithms: WIN_SIGNING_HASH_ALGORITHMS,
    },
  },
  nsisWeb: {
    artifactName: NSIS_WEB_ARTIFACT_NAME || undefined,
    include: "build/installer.nsh",
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  publish: {
    provider: "github",
    repo: "voicevox",
    vPrefixedTagName: false,
  },
  linux: {
    artifactName: LINUX_ARTIFACT_NAME || undefined,
    executableName: LINUX_EXECUTABLE_NAME || undefined,
    icon: "public/icon.png",
    category: "AudioVideo",
    mimeTypes: ["application/x-voicevox"],
    target: [
      {
        target: "AppImage",
        arch: [isArm64 ? "arm64" : "x64"],
      },
    ],
  },
  mac: {
    artifactName: MACOS_ARTIFACT_NAME || undefined,
    icon: "build/icons/icon-mac.png",
    // NOTE: VOICEVOX ENGINE側の署名を維持するため、Electron Builderによる再署名から除外する。
    signIgnore: `/Contents/Resources/${macosVoicevoxEnginePath}(?:/|$)`,
    category: "public.app-category.utilities",
    target: [
      {
        target: "dmg",
        arch: [isArm64 ? "arm64" : "x64"],
      },
    ],
    // 正式署名しない場合はElectron Builderで署名せず、完成したアプリを後段でad hoc署名する。
    ...(isMacCodeSigning ? { notarize: true } : { identity: null }),
  },
  dmg: {
    icon: "build/icons/icon-dmg.icns",
  },
};

export default builderOptions;
