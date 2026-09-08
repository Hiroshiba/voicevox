import { createHash, type Hash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createLogger } from "@/helpers/log";
import type { ProgressCallback } from "@/helpers/progressHelper";

const log = createLogger("multiDownloader");

export type RemoteFileInfo = {
  url: string;
  size: number;
  name: string;
  hash?: string;
};

type HashAlgorithm = "sha256" | "sha512";

type ParsedHash = {
  algorithm: HashAlgorithm;
  value: string;
};

type HashVerification = {
  expected: string;
  calculator: Hash;
};

/**
 * 複数のファイルを並列にダウンロードするクラス。
 * ダウンロードしたファイルは、[Symbol.asyncDispose]で削除される。
 *
 * ファイルは`${downloadDir}/${name}`に保存される。
 */
export class MultiDownloader {
  private internalDownloadedPaths: string[] = [];
  public readonly totalBytes: number;

  constructor(
    public downloadDir: string,
    public remoteFiles: RemoteFileInfo[],
    private callbacks?: { onProgress: ProgressCallback<"download"> },
  ) {
    for (const file of remoteFiles) {
      validateRemoteFileInfo(file);
    }

    // ダウンロード進捗の初期化
    callbacks?.onProgress?.({ type: "download", progress: 0 });

    let totalBytes = 0;
    for (const file of remoteFiles) {
      totalBytes += file.size;
    }

    this.totalBytes = totalBytes;
  }

  async download(signal?: AbortSignal): Promise<void> {
    const abort = new AbortController();
    const downloadSignal =
      signal == undefined
        ? abort.signal
        : AbortSignal.any([abort.signal, signal]);

    await fs.promises.mkdir(this.downloadDir, { recursive: true });

    const progress = { downloadedBytes: 0 };
    const downloads = this.remoteFiles.map((file, index) =>
      this.downloadFile(file, index, downloadSignal, progress),
    );

    try {
      await Promise.all(downloads);
    } catch (error) {
      abort.abort(error);
      await Promise.allSettled(downloads);
      throw error;
    }
  }

  private async downloadFile(
    remoteFile: RemoteFileInfo,
    index: number,
    downloadSignal: AbortSignal,
    progress: { downloadedBytes: number },
  ): Promise<void> {
    const { url, name, size } = remoteFile;
    const hashVerification = createHashVerification(remoteFile.hash);
    log.info(`Download ${name} from ${url}`);

    const res = await fetch(url, { signal: downloadSignal });
    if (!res.ok || res.body == null) {
      throw new Error(`Failed to download ${name} from ${url}`);
    }

    const downloadPath = path.join(this.downloadDir, name);
    const fileStream = fs.createWriteStream(downloadPath, { flags: "wx" });
    try {
      await once(fileStream, "open");
      this.internalDownloadedPaths[index] = downloadPath;

      let downloadedBytes = 0;
      const transform = new Transform({
        transform: (
          chunk: Buffer,
          _encoding: BufferEncoding,
          callback: TransformCallback,
        ) => {
          downloadedBytes += chunk.length;
          progress.downloadedBytes += chunk.length;
          hashVerification?.calculator.update(chunk);
          this.callbacks?.onProgress?.({
            type: "download",
            progress:
              this.totalBytes === 0
                ? 100
                : (progress.downloadedBytes / this.totalBytes) * 100,
          });
          callback(null, chunk);
        },
      });

      await pipeline(Readable.from(res.body), transform, fileStream, {
        signal: downloadSignal,
      });

      if (downloadedBytes !== size) {
        throw new Error(
          `ダウンロードサイズが一致しません。ファイル: ${name}, 期待値: ${size}, 実際: ${downloadedBytes}`,
        );
      }

      verifyHash(name, hashVerification);
      log.info(`Downloaded ${name} to ${downloadPath}`);
    } catch (error) {
      fileStream.destroy();
      throw error;
    }
  }

  get downloadedPaths() {
    return this.internalDownloadedPaths.filter((p) => p != undefined);
  }

  async [Symbol.asyncDispose]() {
    // ダウンロードしたファイルを削除
    await Promise.all(
      this.downloadedPaths.map(async (path) => {
        log.info(`Delete downloaded file: ${path}`);
        await fs.promises.unlink(path);
      }),
    );
  }
}

function validateRemoteFileInfo(file: RemoteFileInfo): void {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error(`ダウンロードサイズが不正です。ファイル: ${file.name}`);
  }
  validateFileName(file.name);
  parseHash(file.hash);
}

function validateFileName(name: string): void {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    path.posix.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    name.split("").some((character) => character.charCodeAt(0) <= 0x1f) ||
    /[<>:"|?*]/u.test(name) ||
    /[. ]$/u.test(name)
  ) {
    throw new Error(`ダウンロードファイル名が不正です。ファイル: ${name}`);
  }

  const baseName = name
    .split(".")[0]
    .replace(/[. ]+$/u, "")
    .toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(baseName)) {
    throw new Error(`ダウンロードファイル名が不正です。ファイル: ${name}`);
  }
}

function parseHash(hash: string | undefined): ParsedHash | undefined {
  if (hash == undefined) {
    return undefined;
  }

  const match = /^(sha256|sha512):([0-9a-f]+)$/iu.exec(hash);
  if (match == undefined) {
    throw new Error(`ダウンロードハッシュの形式が不正です。値: ${hash}`);
  }

  const algorithm = match[1].toLowerCase() === "sha256" ? "sha256" : "sha512";
  const value = match[2].toLowerCase();
  const expectedLength = algorithm === "sha256" ? 64 : 128;
  if (value.length !== expectedLength) {
    throw new Error(`ダウンロードハッシュの長さが不正です。値: ${hash}`);
  }

  return { algorithm, value };
}

function createHashVerification(
  hash: string | undefined,
): HashVerification | undefined {
  const parsedHash = parseHash(hash);
  if (parsedHash == undefined) {
    return;
  }
  return {
    expected: parsedHash.value,
    calculator: createHash(parsedHash.algorithm),
  };
}

function verifyHash(
  name: string,
  hashVerification: HashVerification | undefined,
): void {
  if (hashVerification == undefined) {
    return;
  }

  const actualHash = hashVerification.calculator.digest("hex");
  if (actualHash !== hashVerification.expected) {
    throw new Error(
      `ダウンロードハッシュが一致しません。ファイル: ${name}, 期待値: ${hashVerification.expected}, 実際: ${actualHash}`,
    );
  }
}
