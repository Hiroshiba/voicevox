import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { expect, test } from "vitest";
import { MultiDownloader } from "@/backend/electron/multiDownloader";

// TODO: setTimeoutを使うとテストの実行時間が伸びたりテストが不安定になってしまうので、
// setTimeoutを使わないテストに変更する

function isClientDisconnectedError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err != null &&
    "code" in err &&
    err.code === "ECONNRESET"
  );
}

class TestServer {
  server: http.Server;

  constructor(
    private endpoints: Record<
      string,
      (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>
    >,
  ) {
    this.server = http.createServer(this.requestListener.bind(this));
    this.server.listen(0);
  }

  get url() {
    const address = this.server.address();
    if (address && typeof address === "object") {
      return `http://localhost:${address.port}`;
    } else {
      throw new Error("Server is not running");
    }
  }

  requestListener(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url ?? "";
    const parsedUrl = new URL(url, "http://localhost");
    const pathname = parsedUrl.pathname;
    const handler = this.endpoints[pathname];
    if (handler) {
      void handler(req, res).catch((err: unknown) => {
        if (isClientDisconnectedError(err)) {
          // クライアントが切断した場合は無視
          return;
        }
        throw err;
      });
    } else {
      res.statusCode = 404;
      res.end("Not Found");
    }
  }

  [Symbol.asyncDispose]() {
    return new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

async function temporaryDirectory() {
  const tempDir = await fs.mkdtemp(
    path.join(tmpdir(), "multi-downloader-test-"),
  );
  return {
    [Symbol.asyncDispose]: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
    path: tempDir,
  };
}

test("テストサーバーが動いている", async () => {
  await using dummyServer = new TestServer({
    "/simple": async (_req, res) => {
      res.statusCode = 200;
      res.end("Hello, World!");
    },
  });
  const response = await fetch(`${dummyServer.url}/simple`);
  const text = await response.text();
  expect(text).toBe("Hello, World!");
});

test("ダウンロードしたファイルはSymbol.asyncDisposeで自動削除される", async () => {
  await using tempDir = await temporaryDirectory();
  await using dummyServer = new TestServer({
    "/simple": async (_req, res) => {
      res.statusCode = 200;
      res.end("Hello, World!");
    },
    "/simple2": async (_req, res) => {
      res.statusCode = 200;
      res.end("Hello, World!!");
    },
  });
  let downloadedPaths: string[];
  {
    await using downloader = new MultiDownloader(tempDir.path, [
      {
        name: "simple.txt",
        size: 13,
        url: `${dummyServer.url}/simple`,
      },
      {
        name: "simple2.txt",
        size: 14,
        url: `${dummyServer.url}/simple2`,
      },
    ]);
    await downloader.download();
    expect(downloader.downloadedPaths).toStrictEqual([
      path.join(tempDir.path, "simple.txt"),
      path.join(tempDir.path, "simple2.txt"),
    ]);
    for (const filePath of downloader.downloadedPaths) {
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
    }
    downloadedPaths = downloader.downloadedPaths;
  }

  // スコープを抜けると削除される
  for (const filePath of downloadedPaths) {
    await expect(fs.stat(filePath)).rejects.toThrow();
  }
});

test("ダウンロードサイズとハッシュを検証する", async () => {
  await using tempDir = await temporaryDirectory();
  await using dummyServer = new TestServer({
    "/simple": async (_req, res) => {
      res.statusCode = 200;
      res.end("Hello, World!");
    },
  });
  {
    await using downloader = new MultiDownloader(tempDir.path, [
      {
        name: "simple.txt",
        size: 13,
        url: `${dummyServer.url}/simple`,
        hash: "sha256:dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f",
      },
    ]);
    await downloader.download();
  }
  {
    await using downloader = new MultiDownloader(tempDir.path, [
      {
        name: "simple.txt",
        size: 13,
        url: `${dummyServer.url}/simple`,
        hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    ]);
    await expect(downloader.download()).rejects.toThrow(
      "ダウンロードハッシュが一致しません",
    );
  }
  {
    await using downloader = new MultiDownloader(tempDir.path, [
      {
        name: "simple.txt",
        size: 12,
        url: `${dummyServer.url}/simple`,
      },
    ]);
    await expect(downloader.download()).rejects.toThrow(
      "ダウンロードサイズが一致しません",
    );
  }
});

test("不正なダウンロード情報を拒否する", async () => {
  await using tempDir = await temporaryDirectory();
  const baseFile = {
    size: 0,
    url: "https://example.com/engine.vvpp",
  };
  for (const name of [
    "/engine.vvpp",
    "C:\\engine.vvpp",
    "..",
    "CON.txt",
    "engine:stream",
  ]) {
    expect(
      () => new MultiDownloader(tempDir.path, [{ ...baseFile, name }]),
    ).toThrow("ダウンロードファイル名が不正です");
  }
  expect(
    () =>
      new MultiDownloader(tempDir.path, [
        {
          ...baseFile,
          name: "engine.vvpp",
          hash: "sha1:0000000000000000000000000000000000000000",
        },
      ]),
  ).toThrow("ダウンロードハッシュの形式が不正です");
});

test("既存ファイルを削除しない", async () => {
  await using tempDir = await temporaryDirectory();
  await fs.writeFile(path.join(tempDir.path, "simple.txt"), "existing");
  await using dummyServer = new TestServer({
    "/simple": async (_req, res) => {
      res.statusCode = 200;
      res.end("Hello, World!");
    },
  });
  {
    await using downloader = new MultiDownloader(tempDir.path, [
      {
        name: "simple.txt",
        size: 13,
        url: `${dummyServer.url}/simple`,
      },
    ]);
    await expect(downloader.download()).rejects.toThrow();
  }
  await expect(
    fs.readFile(path.join(tempDir.path, "simple.txt"), "utf8"),
  ).resolves.toBe("existing");
});

test("外部シグナルでダウンロードをキャンセルする", async () => {
  await using tempDir = await temporaryDirectory();
  const { promise: requestStarted, resolve: requestStartedResolve } =
    Promise.withResolvers<void>();
  await using dummyServer = new TestServer({
    "/cancel": async (_req, res) => {
      requestStartedResolve();
      res.statusCode = 200;
      res.write("partial");
      await new Promise<void>((resolve) => {
        res.on("close", resolve);
      });
    },
  });
  const controller = new AbortController();
  {
    await using downloader = new MultiDownloader(tempDir.path, [
      {
        name: "cancel.txt",
        size: 7,
        url: `${dummyServer.url}/cancel`,
      },
    ]);
    const downloadResult = downloader.download(controller.signal);
    await requestStarted;
    controller.abort();
    await expect(downloadResult).rejects.toThrow();
  }
  await expect(
    fs.stat(path.join(tempDir.path, "cancel.txt")),
  ).rejects.toThrow();
});

test("複数ファイルを同時にダウンロードできる", async () => {
  await using tempDir = await temporaryDirectory();
  let inFlight = 0;
  let maxConcurrent = 0;
  await using dummyServer = new TestServer({
    "/slow": async (_req, res) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 200));
      inFlight -= 1;
      res.statusCode = 200;
      res.end("Hello, World!\n");
    },
  });
  {
    await using downloader = new MultiDownloader(tempDir.path, [
      {
        name: "slow1.txt",
        size: 14,
        url: `${dummyServer.url}/slow`,
      },
      {
        name: "slow2.txt",
        size: 14,
        url: `${dummyServer.url}/slow`,
      },
      {
        name: "slow3.txt",
        size: 14,
        url: `${dummyServer.url}/slow`,
      },
    ]);
    await downloader.download();

    expect(maxConcurrent).toBe(3);
  }
});

test("一つエラーが起きると全体が失敗し、かつそのときでもクリーンアップされる", async () => {
  await using tempDir = await temporaryDirectory();
  let slow1000State: "notStarted" | "pending" | "completed" = "notStarted";
  const { promise: slow1000Settled, resolve: slow1000SettledResolve } =
    Promise.withResolvers<void>();
  await using dummyServer = new TestServer({
    "/slow-100": async (_req, res) => {
      await new Promise((r) => setTimeout(r, 100));
      res.statusCode = 200;
      res.end("Hello, World!\n");
    },
    "/slow-1000": async (_req, res) => {
      slow1000State = "pending";
      await new Promise((r) => setTimeout(r, 1000));
      if (res.destroyed || res.writableEnded) {
        slow1000SettledResolve();
        return;
      }
      res.statusCode = 200;
      try {
        res.end("Hello, World!\n");
        slow1000SettledResolve();
      } catch (err: unknown) {
        if (isClientDisconnectedError(err)) {
          slow1000SettledResolve();
          return;
        }
        throw err;
      } finally {
        slow1000State = "completed";
      }
    },
    "/slow-fail": async (_req, res) => {
      await new Promise((r) => setTimeout(r, 500));
      res.statusCode = 500;
      res.end("Internal Server Error\n");
    },
  });
  {
    await using downloader = new MultiDownloader(tempDir.path, [
      {
        name: "slow1.txt",
        size: 14,
        url: `${dummyServer.url}/slow-100`,
      },
      {
        name: "fail.txt",
        size: 14,
        url: `${dummyServer.url}/slow-fail`,
      },
      {
        name: "slow3.txt",
        size: 14,
        url: `${dummyServer.url}/slow-1000`,
      },
    ]);

    const downloadResult = downloader.download();
    const winner = await Promise.race([
      downloadResult.then(
        () => "download-resolved" as const,
        () => "download-rejected" as const,
      ),
      slow1000Settled.then(() => "slow1000-settled" as const),
    ]);

    expect(winner).toBe("download-rejected");
    await expect(downloadResult).rejects.toThrow();
    // 他の長いリクエストを待たずにすぐに失敗しているはず
    expect(slow1000State).toBe("pending");
  }

  const downloadedPaths = [
    path.join(tempDir.path, "slow1.txt"),
    path.join(tempDir.path, "fail.txt"),
    path.join(tempDir.path, "slow3.txt"),
  ];
  // スコープを抜けると削除される
  for (const filePath of downloadedPaths) {
    await expect(fs.stat(filePath)).rejects.toThrow();
  }
});
