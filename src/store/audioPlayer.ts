/**
 * 通常音声とストリーミング音声の再生・停止などを担当する。
 */
import { createPartialStore } from "./vuex";
import {
  createAudioStreamPlayer,
  type AudioStreamPlayer,
  type AudioStreamPlayerResult,
} from "./audioStreamPlayer";
import type { AudioPlayerStoreState, AudioPlayerStoreTypes } from "./type";
import { showAlertDialog } from "@/components/Dialog/Dialog";
import type { AudioKey } from "@/type/preload";

// ユニットテストが落ちるのを回避するための遅延読み込み
const getAudioElement = (() => {
  let audioElement: HTMLAudioElement | undefined = undefined;
  return () => {
    if (audioElement == undefined) {
      audioElement = new Audio();
    }
    return audioElement;
  };
})();

const getAudioStreamPlayer = (() => {
  let player: AudioStreamPlayer | undefined = undefined;
  return () => {
    if (player == undefined) {
      player = createAudioStreamPlayer({
        createAudioContext: createCompatibleAudioContext,
      });
    }
    return player;
  };
})();

type AudioStreamSession = {
  readonly id: number;
  readonly promise: Promise<AudioStreamPlayerResult>;
};

let nextAudioStreamSessionId = 0;
let activeAudioStreamSession: AudioStreamSession | undefined = undefined;

type SupportedAudioContext = AudioContext & {
  readonly state: "suspended" | "running" | "closed";
};

const isSupportedAudioContext = (
  context: AudioContext,
): context is SupportedAudioContext => context.state !== "interrupted";

type CompatibleAudioBuffer = {
  readonly nativeBuffer: AudioBuffer;
  copyToChannel(source: Float32Array, channelNumber: number): void;
};

const createCompatibleAudioContext = () => {
  const nativeContext = new AudioContext();
  if (!isSupportedAudioContext(nativeContext)) {
    throw new Error("AudioContextの状態に対応していません。");
  }

  const destination = {};
  const getState = (): "suspended" | "running" | "closed" => {
    if (nativeContext.state === "suspended") return "suspended";
    if (nativeContext.state === "running") return "running";
    if (nativeContext.state === "closed") return "closed";
    throw new Error("AudioContextの状態に対応していません。");
  };

  return {
    get currentTime() {
      return nativeContext.currentTime;
    },
    destination,
    get state() {
      return getState();
    },
    createBuffer(
      numberOfChannels: number,
      length: number,
      sampleRate: number,
    ): CompatibleAudioBuffer {
      const nativeBuffer = nativeContext.createBuffer(
        numberOfChannels,
        length,
        sampleRate,
      );
      return {
        nativeBuffer,
        copyToChannel(source, channelNumber) {
          nativeBuffer.copyToChannel(new Float32Array(source), channelNumber);
        },
      };
    },
    createBufferSource() {
      const nativeSource = nativeContext.createBufferSource();
      let buffer: CompatibleAudioBuffer | null = null;
      let onended: (() => void) | null = null;
      nativeSource.onended = () => {
        if (onended != undefined) onended();
      };
      return {
        get buffer() {
          return buffer;
        },
        set buffer(value: CompatibleAudioBuffer | null) {
          buffer = value;
          nativeSource.buffer = value?.nativeBuffer ?? null;
        },
        get onended() {
          return onended;
        },
        set onended(value: (() => void) | null) {
          onended = value;
        },
        connect(value: object) {
          if (value !== destination) {
            throw new Error("AudioContextの出力先が不正です。");
          }
          nativeSource.connect(nativeContext.destination);
        },
        start(when: number) {
          nativeSource.start(when);
        },
        stop() {
          nativeSource.stop();
        },
      };
    },
    resume() {
      return nativeContext.resume();
    },
    setSinkId(sinkId: string) {
      return nativeContext.setSinkId(sinkId);
    },
  };
};

export const audioPlayerStoreState: AudioPlayerStoreState = {
  nowPlayingAudioKey: undefined,
};

export const audioPlayerStore = createPartialStore<AudioPlayerStoreTypes>({
  ACTIVE_AUDIO_ELEM_CURRENT_TIME_GETTER: {
    getter: (state) => {
      return () => {
        const streamCurrentTime = getAudioStreamPlayer().getCurrentTime();
        if (streamCurrentTime != undefined) return streamCurrentTime;
        return state._activeAudioKey != undefined
          ? getAudioElement().currentTime
          : undefined;
      };
    },
  },

  NOW_PLAYING: {
    getter(state, getters) {
      const activeAudioKey = getters.ACTIVE_AUDIO_KEY;
      return (
        activeAudioKey != undefined &&
        activeAudioKey === state.nowPlayingAudioKey
      );
    },
  },

  SET_AUDIO_NOW_PLAYING: {
    mutation(
      state,
      { audioKey, nowPlaying }: { audioKey: AudioKey; nowPlaying: boolean },
    ) {
      state.nowPlayingAudioKey = nowPlaying ? audioKey : undefined;
    },
  },

  SET_AUDIO_SOURCE: {
    mutation(_, { audioBlob }: { audioBlob: Blob }) {
      getAudioElement().src = URL.createObjectURL(audioBlob);
    },
  },

  PLAY_AUDIO_PLAYER: {
    async action(
      { state, mutations },
      { offset, audioKey }: { offset?: number; audioKey?: AudioKey },
    ) {
      const audioElement = getAudioElement();

      if (offset != undefined) {
        audioElement.currentTime = offset;
      }

      // 一部ブラウザではsetSinkIdが実装されていないので、その環境では無視する
      if (audioElement.setSinkId) {
        audioElement
          .setSinkId(state.savingSetting.audioOutputDevice)
          .catch((err: unknown) => {
            const stop = () => {
              audioElement.pause();
              audioElement.removeEventListener("canplay", stop);
            };
            audioElement.addEventListener("canplay", stop);
            void showAlertDialog({
              title: "エラー",
              message: "再生デバイスが見つかりません",
            });
            throw err;
          });
      }

      // 再生終了時にresolveされるPromiseを返す
      const played = async () => {
        if (audioKey) {
          mutations.SET_AUDIO_NOW_PLAYING({ audioKey, nowPlaying: true });
        }
      };
      audioElement.addEventListener("play", played);

      let paused: () => void;
      const audioPlayPromise = new Promise<boolean>((resolve) => {
        paused = () => {
          resolve(audioElement.ended);
        };
        audioElement.addEventListener("pause", paused);
      }).finally(async () => {
        audioElement.removeEventListener("play", played);
        audioElement.removeEventListener("pause", paused);
        if (audioKey) {
          mutations.SET_AUDIO_NOW_PLAYING({ audioKey, nowPlaying: false });
        }
      });

      void audioElement.play();

      return audioPlayPromise;
    },
  },

  PLAY_AUDIO_STREAM: {
    async action(
      { state, mutations },
      {
        response,
        startOffset,
        audioKey,
      }: { response: Response; startOffset: number; audioKey: AudioKey },
    ) {
      if (activeAudioStreamSession != undefined) {
        throw new Error("音声ストリームはすでに再生中です。");
      }
      const sessionId = ++nextAudioStreamSessionId;
      const player = getAudioStreamPlayer();
      const playPromise = player.play(
        response,
        startOffset,
        state.savingSetting.audioOutputDevice,
        () => {
          const session = activeAudioStreamSession;
          if (session == undefined || session.id !== sessionId) return;
          mutations.SET_AUDIO_NOW_PLAYING({ audioKey, nowPlaying: true });
          mutations.SET_AUDIO_NOW_GENERATING({
            audioKey,
            nowGenerating: false,
          });
        },
      );

      const clearSession = () => {
        const session = activeAudioStreamSession;
        if (session == undefined || session.id !== sessionId) return;
        activeAudioStreamSession = undefined;
        if (state.nowPlayingAudioKey === audioKey) {
          mutations.SET_AUDIO_NOW_PLAYING({ audioKey, nowPlaying: false });
        }
      };
      const settledPromise = playPromise.then(
        (result) => {
          clearSession();
          return result;
        },
        (error: unknown) => {
          clearSession();
          throw error;
        },
      );
      activeAudioStreamSession = { id: sessionId, promise: settledPromise };
      const result = await settledPromise;
      return result.type === "completed";
    },
  },

  STOP_AUDIO: {
    // 停止中でも呼び出して問題ない
    async action() {
      getAudioElement().pause();
      const session = activeAudioStreamSession;
      if (session == undefined) return;
      await getAudioStreamPlayer().stop();
      await session.promise;
    },
  },
});
