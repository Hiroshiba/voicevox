type AudioStreamDestination = object;

interface AudioStreamBuffer {
  copyToChannel(source: Float32Array, channelNumber: number): void;
}

interface AudioStreamBufferSource {
  buffer: AudioStreamBuffer | null;
  onended: (() => void) | null;
  connect(destination: AudioStreamDestination): void;
  start(when: number): void;
  stop(): void;
}

interface AudioStreamContext {
  readonly currentTime: number;
  readonly destination: AudioStreamDestination;
  readonly state: AudioStreamContextState;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioStreamBuffer;
  createBufferSource(): AudioStreamBufferSource;
  resume(): Promise<void>;
  setSinkId(sinkId: string): Promise<void>;
}

type AudioStreamContextState = "suspended" | "running" | "closed";

export interface AudioStreamPlayerDependencies {
  readonly createAudioContext: () => AudioStreamContext;
}

export type AudioStreamPlayerResult =
  | { readonly type: "completed"; readonly audioBlob: Blob }
  | { readonly type: "stopped" };

export interface AudioStreamPlayer {
  play(
    response: Response,
    startOffset: number,
    outputDevice: string,
    onFirstPcmScheduled: () => void,
  ): Promise<AudioStreamPlayerResult>;
  stop(): Promise<void>;
  getCurrentTime(): number | undefined;
}

interface PcmChunk {
  readonly channelData: readonly Float32Array[];
  readonly frameCount: number;
  readonly sampleRate: number;
}

interface WavFormat {
  readonly channelCount: number;
  readonly sampleRate: number;
  readonly blockAlign: number;
}

type WavParserState = "riffHeader" | "chunkHeader" | "chunkData" | "padding";

class WavStreamParser {
  private pending = new Uint8Array(0);
  private pendingOffset = 0;
  private receivedLength = 0;
  private expectedFileLength: number | undefined;
  private state: WavParserState = "riffHeader";
  private currentChunkId = "";
  private currentChunkLength = 0;
  private currentChunkRemaining = 0;
  private fmtChunkSeen = false;
  private fmtBytes = new Uint8Array(0);
  private format: WavFormat | undefined;
  private dataChunkSeen = false;
  private pcmBytes = new Uint8Array(0);

  push(bytes: Uint8Array): PcmChunk[] {
    this.receivedLength += bytes.length;
    this.appendPending(bytes);
    return this.processPending();
  }

  finish(): void {
    this.processPending();

    if (
      this.expectedFileLength != undefined &&
      this.receivedLength !== this.expectedFileLength
    ) {
      throw new Error("WAVのRIFFチャンクサイズと受信サイズが一致しません。");
    }
    if (this.state === "riffHeader") {
      throw new Error("WAVヘッダーが不完全です。");
    }
    if (this.state === "chunkData" && this.currentChunkRemaining !== 0) {
      throw new Error("WAVチャンクが不完全です。");
    }
    if (this.state === "padding") {
      throw new Error("WAVチャンクのパディングが不完全です。");
    }
    if (this.availableLength() !== 0) {
      throw new Error("WAVチャンクヘッダーが不完全です。");
    }
    if (this.format == undefined) {
      throw new Error("WAVのfmtチャンクがありません。");
    }
    if (!this.dataChunkSeen) {
      throw new Error("WAVのdataチャンクがありません。");
    }
    if (this.pcmBytes.length !== 0) {
      throw new Error("WAVのPCMデータが完全なフレームで終わっていません。");
    }
  }

  private availableLength(): number {
    return this.pending.length - this.pendingOffset;
  }

  private appendPending(bytes: Uint8Array): void {
    if (bytes.length === 0) return;

    const remaining = this.pending.subarray(this.pendingOffset);
    const next = new Uint8Array(remaining.length + bytes.length);
    next.set(remaining, 0);
    next.set(bytes, remaining.length);
    this.pending = next;
    this.pendingOffset = 0;
  }

  private take(length: number): Uint8Array | undefined {
    if (this.availableLength() < length) return undefined;

    const bytes = this.pending.subarray(
      this.pendingOffset,
      this.pendingOffset + length,
    );
    this.pendingOffset += length;
    return bytes;
  }

  private processPending(): PcmChunk[] {
    const pcmChunks: PcmChunk[] = [];

    while (true) {
      if (this.state === "riffHeader") {
        const header = this.take(12);
        if (header == undefined) return pcmChunks;
        this.parseRiffHeader(header);
        this.state = "chunkHeader";
        continue;
      }

      if (this.state === "chunkHeader") {
        const header = this.take(8);
        if (header == undefined) return pcmChunks;
        this.parseChunkHeader(header);
        this.state = "chunkData";
        continue;
      }

      if (this.state === "chunkData") {
        if (this.currentChunkRemaining === 0) {
          this.state =
            this.currentChunkLength % 2 === 1 ? "padding" : "chunkHeader";
          continue;
        }

        const length = Math.min(
          this.currentChunkRemaining,
          this.availableLength(),
        );
        if (length === 0) return pcmChunks;
        const bytes = this.take(length);
        if (bytes == undefined) {
          throw new Error("WAVチャンクの読み取りに失敗しました。");
        }
        this.currentChunkRemaining -= length;

        if (this.currentChunkId === "fmt ") {
          this.appendFmtBytes(bytes);
        } else if (this.currentChunkId === "data") {
          this.appendPcmBytes(bytes);
        }

        const chunk = this.takePcmChunk();
        if (chunk != undefined) pcmChunks.push(chunk);
        continue;
      }

      const padding = this.take(1);
      if (padding == undefined) return pcmChunks;
      this.state = "chunkHeader";
    }
  }

  private parseRiffHeader(header: Uint8Array): void {
    if (readAscii(header, 0, 4) !== "RIFF") {
      throw new Error("WAVのRIFFヘッダーが不正です。");
    }
    if (readAscii(header, 8, 4) !== "WAVE") {
      throw new Error("WAVのWAVE識別子が不正です。");
    }
    this.expectedFileLength = readUint32LittleEndian(header, 4) + 8;
  }

  private parseChunkHeader(header: Uint8Array): void {
    this.currentChunkId = readAscii(header, 0, 4);
    this.currentChunkLength = readUint32LittleEndian(header, 4);
    this.currentChunkRemaining = this.currentChunkLength;

    if (this.currentChunkId === "fmt ") {
      if (this.fmtChunkSeen) {
        throw new Error("WAVのfmtチャンクが複数あります。");
      }
      this.fmtChunkSeen = true;
      if (this.currentChunkLength < 16) {
        throw new Error("WAVのfmtチャンクが不完全です。");
      }
    }
    if (this.currentChunkId === "data") {
      this.dataChunkSeen = true;
    }
  }

  private appendFmtBytes(bytes: Uint8Array): void {
    const bytesToKeep = Math.min(16 - this.fmtBytes.length, bytes.length);
    if (bytesToKeep === 0) return;

    const next = new Uint8Array(this.fmtBytes.length + bytesToKeep);
    next.set(this.fmtBytes, 0);
    next.set(bytes.subarray(0, bytesToKeep), this.fmtBytes.length);
    this.fmtBytes = next;
    if (this.fmtBytes.length === 16) {
      this.format = parseWavFormat(this.fmtBytes);
    }
  }

  private appendPcmBytes(bytes: Uint8Array): void {
    const next = new Uint8Array(this.pcmBytes.length + bytes.length);
    next.set(this.pcmBytes, 0);
    next.set(bytes, this.pcmBytes.length);
    this.pcmBytes = next;
  }

  private takePcmChunk(): PcmChunk | undefined {
    if (this.format == undefined) return undefined;
    const frameCount = Math.floor(
      this.pcmBytes.length / this.format.blockAlign,
    );
    if (frameCount === 0) return undefined;

    const consumedLength = frameCount * this.format.blockAlign;
    const channelData = Array.from(
      { length: this.format.channelCount },
      () => new Float32Array(frameCount),
    );

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frameOffset = frameIndex * this.format.blockAlign;
      for (
        let channelIndex = 0;
        channelIndex < this.format.channelCount;
        channelIndex += 1
      ) {
        const sampleOffset = frameOffset + channelIndex * 2;
        let sample = readUint16LittleEndian(this.pcmBytes, sampleOffset);
        if (sample >= 0x8000) sample -= 0x10000;
        channelData[channelIndex][frameIndex] = sample / 0x8000;
      }
    }

    this.pcmBytes = this.pcmBytes.slice(consumedLength);
    return {
      channelData,
      frameCount,
      sampleRate: this.format.sampleRate,
    };
  }
}

const readAscii = (
  bytes: Uint8Array,
  offset: number,
  length: number,
): string => {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index]);
  }
  return text;
};

const readUint16LittleEndian = (bytes: Uint8Array, offset: number): number => {
  return bytes[offset] | (bytes[offset + 1] << 8);
};

const readUint32LittleEndian = (bytes: Uint8Array, offset: number): number => {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
};

const parseWavFormat = (bytes: Uint8Array): WavFormat => {
  const audioFormat = readUint16LittleEndian(bytes, 0);
  const channelCount = readUint16LittleEndian(bytes, 2);
  const sampleRate = readUint32LittleEndian(bytes, 4);
  const byteRate = readUint32LittleEndian(bytes, 8);
  const blockAlign = readUint16LittleEndian(bytes, 12);
  const bitsPerSample = readUint16LittleEndian(bytes, 14);

  if (audioFormat !== 1) {
    throw new Error("WAVの音声形式はPCMに対応していません。");
  }
  if (channelCount !== 1 && channelCount !== 2) {
    throw new Error("WAVのチャンネル数は1または2である必要があります。");
  }
  if (sampleRate === 0) {
    throw new Error("WAVのサンプルレートが不正です。");
  }
  if (bitsPerSample !== 16) {
    throw new Error("WAVのビット深度は16 bitである必要があります。");
  }
  if (blockAlign !== channelCount * 2) {
    throw new Error("WAVのblockAlignが不正です。");
  }
  if (byteRate !== sampleRate * blockAlign) {
    throw new Error("WAVのbyteRateが不正です。");
  }

  return { channelCount, sampleRate, blockAlign };
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise == undefined) {
    throw new Error("Promiseの初期化に失敗しました。");
  }
  return { promise, resolve: resolvePromise };
};

interface ScheduledSource {
  readonly source: AudioStreamBufferSource;
  ended: boolean;
}

interface ScheduledSegment {
  readonly contextStartTime: number;
  readonly duration: number;
  readonly audioStartTime: number;
}

type SessionPhase =
  | "reading"
  | "streamEnded"
  | "stopped"
  | "completed"
  | "errored";

interface Session {
  readonly startOffset: number;
  readonly context: AudioStreamContext;
  readonly parser: WavStreamParser;
  readonly responseChunks: ArrayBuffer[];
  readonly sources: Set<ScheduledSource>;
  readonly scheduledSegments: ScheduledSegment[];
  readonly completion: Deferred<AudioStreamPlayerResult>;
  readonly onFirstPcmScheduled: () => void;
  phase: SessionPhase;
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  firstStartContextTime: number | undefined;
  nextStartContextTime: number | undefined;
  scheduledAudioDuration: number;
  callbackCalled: boolean;
}

type ReadOutcome =
  | {
      readonly type: "read";
      readonly result: ReadableStreamReadResult<Uint8Array>;
    }
  | {
      readonly type: "completion";
      readonly result: AudioStreamPlayerResult;
    };

class AudioStreamPlayerImpl implements AudioStreamPlayer {
  private readonly dependencies: AudioStreamPlayerDependencies;
  private audioContext: AudioStreamContext | undefined;
  private activeSession: Session | undefined;

  constructor(dependencies: AudioStreamPlayerDependencies) {
    this.dependencies = dependencies;
  }

  async play(
    response: Response,
    startOffset: number,
    outputDevice: string,
    onFirstPcmScheduled: () => void,
  ): Promise<AudioStreamPlayerResult> {
    if (this.activeSession != undefined) {
      throw new Error("音声ストリームはすでに再生中です。");
    }
    if (!Number.isFinite(startOffset) || startOffset < 0) {
      throw new Error("音声ストリームの開始位置が不正です。");
    }

    const session = this.createSession(startOffset, onFirstPcmScheduled);
    this.activeSession = session;

    try {
      const body = response.body;
      if (body == undefined) {
        throw new Error("音声ストリームのレスポンスボディがありません。");
      }
      await this.ensureContextReady(session.context);
      await session.context.setSinkId(
        outputDevice === "default" ? "" : outputDevice,
      );
      if (session.phase === "stopped") {
        return await session.completion.promise;
      }
      session.reader = body.getReader();
      return await this.consume(session);
    } catch (error: unknown) {
      if (session.phase === "stopped") {
        return await session.completion.promise;
      }
      this.failSession(session);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const session = this.activeSession;
    if (session == undefined) return;

    this.activeSession = undefined;
    session.phase = "stopped";
    session.completion.resolve({ type: "stopped" });
    this.stopSources(session);

    const reader = session.reader;
    if (reader != undefined) {
      await reader.cancel();
    }
  }

  getCurrentTime(): number | undefined {
    const session = this.activeSession;
    if (session == undefined || session.firstStartContextTime == undefined) {
      return undefined;
    }

    let audioTime = 0;
    for (const segment of session.scheduledSegments) {
      if (session.context.currentTime < segment.contextStartTime) break;
      const segmentEndTime = segment.contextStartTime + segment.duration;
      if (session.context.currentTime < segmentEndTime) {
        audioTime =
          segment.audioStartTime +
          session.context.currentTime -
          segment.contextStartTime;
        return session.startOffset + audioTime;
      }
      audioTime = segment.audioStartTime + segment.duration;
    }
    return session.startOffset + audioTime;
  }

  private createSession(
    startOffset: number,
    onFirstPcmScheduled: () => void,
  ): Session {
    const context = this.getAudioContext();
    return {
      startOffset,
      context,
      parser: new WavStreamParser(),
      responseChunks: [],
      sources: new Set(),
      scheduledSegments: [],
      completion: createDeferred<AudioStreamPlayerResult>(),
      onFirstPcmScheduled,
      phase: "reading",
      reader: undefined,
      firstStartContextTime: undefined,
      nextStartContextTime: undefined,
      scheduledAudioDuration: 0,
      callbackCalled: false,
    };
  }

  private async ensureContextReady(context: AudioStreamContext): Promise<void> {
    const contextState = context.state;
    if (contextState === "closed") {
      throw new Error("AudioContextが閉じています。");
    }
    if (contextState === "suspended") {
      await context.resume();
      if (context.state === "closed") {
        throw new Error("AudioContextが閉じています。");
      }
    }
  }

  private getAudioContext(): AudioStreamContext {
    if (this.audioContext == undefined) {
      this.audioContext = this.dependencies.createAudioContext();
    }
    return this.audioContext;
  }

  private async consume(session: Session): Promise<AudioStreamPlayerResult> {
    const reader = session.reader;
    if (reader == undefined) {
      throw new Error("音声ストリームのreaderがありません。");
    }

    while (true) {
      const outcome = await this.readNext(reader, session.completion.promise);
      if (outcome.type === "completion") return outcome.result;
      if (session.phase === "stopped") {
        return await session.completion.promise;
      }
      if (outcome.result.done) break;
      const value = outcome.result.value;
      if (value == undefined) {
        throw new Error("音声ストリームのチャンクがありません。");
      }
      const responseChunk = new ArrayBuffer(value.byteLength);
      new Uint8Array(responseChunk).set(value);
      session.responseChunks.push(responseChunk);
      const pcmChunks = session.parser.push(value);
      for (const pcmChunk of pcmChunks) {
        this.schedulePcm(session, pcmChunk);
      }
    }

    session.parser.finish();
    session.phase = "streamEnded";
    this.completeIfReady(session);
    return await session.completion.promise;
  }

  private async readNext(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    completion: Promise<AudioStreamPlayerResult>,
  ): Promise<ReadOutcome> {
    const readPromise = reader.read();
    const readOutcome = readPromise.then(
      (result): ReadOutcome => ({ type: "read", result }),
      (error: unknown): never => {
        throw error;
      },
    );
    const completionOutcome = completion.then(
      (result): ReadOutcome => ({ type: "completion", result }),
    );
    return await Promise.race([readOutcome, completionOutcome]);
  }

  private schedulePcm(session: Session, pcmChunk: PcmChunk): void {
    if (session.phase !== "reading") return;

    const buffer = session.context.createBuffer(
      pcmChunk.channelData.length,
      pcmChunk.frameCount,
      pcmChunk.sampleRate,
    );
    for (
      let channelIndex = 0;
      channelIndex < pcmChunk.channelData.length;
      channelIndex += 1
    ) {
      buffer.copyToChannel(pcmChunk.channelData[channelIndex], channelIndex);
    }

    const source = session.context.createBufferSource();
    source.buffer = buffer;
    source.connect(session.context.destination);
    const scheduledSource: ScheduledSource = { source, ended: false };
    source.onended = () => {
      if (scheduledSource.ended) return;
      scheduledSource.ended = true;
      session.sources.delete(scheduledSource);
      this.completeIfReady(session);
    };
    session.sources.add(scheduledSource);

    const currentTime = session.context.currentTime;
    const startTime = Math.max(
      currentTime,
      session.nextStartContextTime ?? currentTime,
    );
    try {
      source.start(startTime);
    } catch (error: unknown) {
      session.sources.delete(scheduledSource);
      source.onended = null;
      throw error;
    }

    if (session.firstStartContextTime == undefined) {
      session.firstStartContextTime = startTime;
    }
    const duration = pcmChunk.frameCount / pcmChunk.sampleRate;
    session.scheduledSegments.push({
      contextStartTime: startTime,
      duration,
      audioStartTime: session.scheduledAudioDuration,
    });
    session.nextStartContextTime = startTime + duration;
    session.scheduledAudioDuration += duration;
    if (!session.callbackCalled) {
      session.callbackCalled = true;
      session.onFirstPcmScheduled();
    }
  }

  private completeIfReady(session: Session): void {
    if (session.phase !== "streamEnded" || session.sources.size !== 0) return;

    session.phase = "completed";
    this.activeSession =
      this.activeSession === session ? undefined : this.activeSession;
    session.completion.resolve({
      type: "completed",
      audioBlob: new Blob(session.responseChunks, { type: "audio/wav" }),
    });
  }

  private stopSources(session: Session): void {
    const sources = [...session.sources];
    for (const scheduledSource of sources) {
      if (scheduledSource.ended) continue;
      scheduledSource.ended = true;
      scheduledSource.source.stop();
      scheduledSource.source.onended = null;
    }
    session.sources.clear();
  }

  private failSession(session: Session): void {
    if (session.phase === "stopped" || session.phase === "completed") return;
    session.phase = "errored";
    this.activeSession =
      this.activeSession === session ? undefined : this.activeSession;
    this.stopSources(session);
  }
}

/** WAVストリームを再生するプレイヤーを生成する。 */
export const createAudioStreamPlayer = (
  dependencies: AudioStreamPlayerDependencies,
): AudioStreamPlayer => {
  return new AudioStreamPlayerImpl(dependencies);
};
