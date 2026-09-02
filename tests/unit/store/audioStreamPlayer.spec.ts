import { describe, expect, test, vi } from "vitest";
import {
  createAudioStreamPlayer,
  type AudioStreamPlayerResult,
} from "@/store/audioStreamPlayer";

class FakeBuffer {
  readonly channelData: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channelData = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  copyToChannel(source: Float32Array, channelNumber: number): void {
    this.channelData[channelNumber].set(source);
  }
}

class FakeSource {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  startTime: number | undefined;
  stopCount = 0;

  connect(): void {}

  start(when: number): void {
    this.startTime = when;
  }

  stop(): void {
    this.stopCount += 1;
  }

  end(): void {
    const callback = this.onended;
    if (callback != undefined) callback();
  }
}

class FakeContext {
  currentTime = 0;
  state: "suspended" | "running" | "closed" = "running";
  readonly destination = {};
  readonly buffers: FakeBuffer[] = [];
  readonly sources: FakeSource[] = [];
  readonly sinkIds: string[] = [];
  resumeCount = 0;
  resumeError: Error | undefined;
  sinkError: Error | undefined;

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): FakeBuffer {
    const buffer = new FakeBuffer(numberOfChannels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  async resume(): Promise<void> {
    this.resumeCount += 1;
    if (this.resumeError != undefined) throw this.resumeError;
    this.state = "running";
  }

  async setSinkId(sinkId: string): Promise<void> {
    if (this.sinkError != undefined) throw this.sinkError;
    this.sinkIds.push(sinkId);
  }
}

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

const chunk = (id: string, payload: Uint8Array): Uint8Array => {
  const header = new Uint8Array(8);
  for (let index = 0; index < 4; index += 1) {
    header[index] = id.charCodeAt(index);
  }
  new DataView(header.buffer).setUint32(4, payload.length, true);
  const padding =
    payload.length % 2 === 1 ? new Uint8Array(1) : new Uint8Array(0);
  return concatBytes(header, payload, padding);
};

const createFmt = (channelCount: number, sampleRate: number): Uint8Array => {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, channelCount, true);
  view.setUint32(4, sampleRate, true);
  view.setUint32(8, sampleRate * channelCount * 2, true);
  view.setUint16(12, channelCount * 2, true);
  view.setUint16(14, 16, true);
  return bytes;
};

const createWav = (
  channelCount: number,
  sampleRate: number,
  pcm: Uint8Array,
  extraChunks: Uint8Array[],
): Uint8Array => {
  const chunks = [
    chunk("fmt ", createFmt(channelCount, sampleRate)),
    ...extraChunks,
    chunk("data", pcm),
  ];
  const body = concatBytes(new TextEncoder().encode("WAVE"), ...chunks);
  const header = new Uint8Array(8);
  header.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(header.buffer).setUint32(4, body.length, true);
  return concatBytes(header, body);
};

const createResponse = (parts: Uint8Array[]): Response => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
  return new Response(stream);
};

const splitBytes = (bytes: Uint8Array, size: number): Uint8Array[] => {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    parts.push(bytes.slice(offset, offset + size));
  }
  return parts;
};

const createPlayer = (context: FakeContext) => {
  return createAudioStreamPlayer({
    createAudioContext: () => context,
  });
};

const waitForSources = async (): Promise<void> => {
  for (let index = 0; index < 256; index += 1) {
    await Promise.resolve();
  }
};

const expectCompleted = async (
  promise: Promise<AudioStreamPlayerResult>,
  context: FakeContext,
): Promise<Blob> => {
  await waitForSources();
  for (const source of context.sources) source.end();
  const result = await promise;
  expect(result.type).toBe("completed");
  if (result.type !== "completed")
    throw new Error("音声ストリームが完了していません。");
  return result.audioBlob;
};

describe("createAudioStreamPlayer", () => {
  test("suspendedなAudioContextを再開してから再生する", async () => {
    const context = new FakeContext();
    context.state = "suspended";
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array(0), []);

    await player.play(createResponse([wav]), 0, "default", () => undefined);

    expect(context.resumeCount).toBe(1);
    expect(context.state).toBe("running");
  });

  test("AudioContextのresume errorを伝播する", async () => {
    const context = new FakeContext();
    const error = new Error("resume error");
    context.state = "suspended";
    context.resumeError = error;
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array(0), []);

    await expect(
      player.play(createResponse([wav]), 0, "default", () => undefined),
    ).rejects.toBe(error);
  });

  test("閉じたAudioContextはエラーにする", async () => {
    const context = new FakeContext();
    context.state = "closed";
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array(0), []);

    await expect(
      player.play(createResponse([wav]), 0, "default", () => undefined),
    ).rejects.toThrow("AudioContextが閉じています");
  });

  test("ヘッダーとフレームを任意の境界で分割してmonoを再生する", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array([0, 0, 0, 64]), []);
    const onFirstPcmScheduled = vi.fn();

    const promise = player.play(
      createResponse(splitBytes(wav, 1)),
      0,
      "default",
      onFirstPcmScheduled,
    );
    const blob = await expectCompleted(promise, context);

    expect(onFirstPcmScheduled).toHaveBeenCalledTimes(1);
    expect(context.buffers).toHaveLength(2);
    expect(context.buffers[0].channelData[0]).toEqual(new Float32Array([0]));
    expect(context.buffers[1].channelData[0]).toEqual(new Float32Array([0.5]));
    expect(await blob.arrayBuffer()).toEqual(wav.buffer);
    expect(blob.type).toBe("audio/wav");
  });

  test("stereo PCMをチャンネルごとに再生する", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(
      2,
      10,
      new Uint8Array([0, 0, 0, 64, 0, 192, 0, 32]),
      [],
    );

    const promise = player.play(
      createResponse([wav]),
      0,
      "default",
      () => undefined,
    );
    await expectCompleted(promise, context);

    expect(context.buffers[0].channelData[0]).toEqual(
      new Float32Array([0, -0.5]),
    );
    expect(context.buffers[0].channelData[1]).toEqual(
      new Float32Array([0.5, 0.25]),
    );
  });

  test("未知チャンクと奇数長のパディングを読み飛ばす", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array([0, 64]), [
      chunk("JUNK", new Uint8Array([1, 2, 3])),
    ]);

    const promise = player.play(
      createResponse(splitBytes(wav, 5)),
      0,
      "default",
      () => undefined,
    );
    await expectCompleted(promise, context);

    expect(context.buffers).toHaveLength(1);
    expect(context.buffers[0].channelData[0]).toEqual(new Float32Array([0.5]));
  });

  test("PCMの先行待機をせず現在時刻にスケジュールする", async () => {
    const context = new FakeContext();
    context.currentTime = 12;
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array([0, 0]), []);
    const promise = player.play(
      createResponse([wav]),
      0,
      "default",
      () => undefined,
    );

    await waitForSources();
    expect(context.sources[0].startTime).toBe(12);
    context.sources[0].end();
    await promise;
  });

  test("自然完了は全sourceの終了を待つ", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array([0, 0, 0, 64]), []);
    const wavHead = wav.slice(0, wav.length - 2);
    const pcmTail = wav.slice(wav.length - 2);
    const promise = player.play(
      createResponse([wavHead, pcmTail]),
      0,
      "default",
      () => undefined,
    );
    await waitForSources();

    expect(context.sources).toHaveLength(2);
    context.sources[0].end();
    const pendingResult = await Promise.race([
      promise.then(() => "resolved"),
      Promise.resolve("pending"),
    ]);
    expect(pendingResult).toBe("pending");
    context.sources[1].end();
    const result = await promise;
    expect(result.type).toBe("completed");
    expect(player.getCurrentTime()).toBeUndefined();
  });

  test("音切れ中のgetCurrentTimeは直前の音声位置を返す", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array([0, 0, 0, 64]), []);
    const firstPart = wav.slice(0, wav.length - 2);
    const secondPart = wav.slice(wav.length - 2);
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(nextController) {
          controller = nextController;
        },
      }),
    );
    const promise = player.play(response, 3, "default", () => undefined);
    if (controller == undefined)
      throw new Error("stream controllerがありません。");
    controller.enqueue(firstPart);
    await waitForSources();

    expect(context.sources).toHaveLength(1);
    context.currentTime = 0.5;
    expect(player.getCurrentTime()).toBeCloseTo(3.1);
    controller.enqueue(secondPart);
    controller.close();
    await waitForSources();

    expect(context.sources).toHaveLength(2);
    context.currentTime = 0.5;
    expect(player.getCurrentTime()).toBeCloseTo(3.1);
    context.currentTime = 0.55;
    expect(player.getCurrentTime()).toBeCloseTo(3.15);
    context.sources[0].end();
    context.sources[1].end();
    await promise;
  });

  test("停止はreaderと未終了sourceを停止してstoppedを返す", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array([0, 0, 0, 64]), []);
    const promise = player.play(
      createResponse([wav]),
      0,
      "default",
      () => undefined,
    );
    await waitForSources();

    await player.stop();
    await expect(promise).resolves.toEqual({ type: "stopped" });
    expect(context.sources[0].stopCount).toBe(1);
    expect(player.getCurrentTime()).toBeUndefined();
  });

  test("不正形式はエラーにする", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const invalid = new Uint8Array(12);
    invalid.set(new TextEncoder().encode("NOPE"));

    await expect(
      player.play(createResponse([invalid]), 0, "default", () => undefined),
    ).rejects.toThrow("RIFF");
  });

  test("reader errorを伝播する", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const error = new Error("reader error");
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(error);
        },
      }),
    );

    await expect(
      player.play(response, 0, "default", () => undefined),
    ).rejects.toBe(error);
  });

  test("setSinkId errorを伝播する", async () => {
    const context = new FakeContext();
    const error = new Error("sink error");
    context.sinkError = error;
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array(0), []);

    await expect(
      player.play(createResponse([wav]), 0, "default", () => undefined),
    ).rejects.toBe(error);
    expect(player.getCurrentTime()).toBeUndefined();
  });

  test("レスポンスボディがない場合はエラーにする", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);

    await expect(
      player.play(new Response(null), 0, "default", () => undefined),
    ).rejects.toThrow("レスポンスボディがありません");
    expect(player.getCurrentTime()).toBeUndefined();
  });

  test("RIFFの宣言サイズと受信サイズが異なる場合はエラーにする", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array(0), []);
    new DataView(wav.buffer).setUint32(4, wav.length - 8 + 1, true);

    await expect(
      player.play(createResponse([wav]), 0, "default", () => undefined),
    ).rejects.toThrow("RIFFチャンクサイズと受信サイズが一致しません");
  });

  test("開始offsetを加算しスケジュール済み時間を上限にする", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array([0, 0, 0, 64]), []);
    const promise = player.play(
      createResponse([wav]),
      4,
      "default",
      () => undefined,
    );
    await waitForSources();

    expect(player.getCurrentTime()).toBe(4);
    context.currentTime = 100;
    expect(player.getCurrentTime()).toBeCloseTo(4.2);
    context.sources[0].end();
    await promise;
  });

  test("playごとに出力デバイスを設定しdefaultは空文字にする", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array(0), []);

    await player.play(createResponse([wav]), 0, "default", () => undefined);
    await player.play(createResponse([wav]), 0, "device-1", () => undefined);

    expect(context.sinkIds).toEqual(["", "device-1"]);
  });

  test("古いsource callbackは後続セッションに影響しない", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array([0, 0]), []);
    const firstPromise = player.play(
      createResponse([wav]),
      0,
      "default",
      () => undefined,
    );
    await waitForSources();
    const oldCallback = context.sources[0].onended;
    if (oldCallback == undefined) throw new Error("終了callbackがありません。");
    await player.stop();
    await expect(firstPromise).resolves.toEqual({ type: "stopped" });

    const secondPromise = player.play(
      createResponse([wav]),
      0,
      "default",
      () => undefined,
    );
    await waitForSources();
    oldCallback();
    expect(context.sources[1].stopCount).toBe(0);
    context.sources[1].end();
    const result = await secondPromise;
    expect(result.type).toBe("completed");
  });

  test("再生中のplayはエラーにする", async () => {
    const context = new FakeContext();
    const player = createPlayer(context);
    const wav = createWav(1, 10, new Uint8Array([0, 0]), []);
    const firstPromise = player.play(
      createResponse([wav]),
      0,
      "default",
      () => undefined,
    );
    await waitForSources();

    await expect(
      player.play(createResponse([wav]), 0, "default", () => undefined),
    ).rejects.toThrow("再生中");
    context.sources[0].end();
    await firstPromise;
  });
});
