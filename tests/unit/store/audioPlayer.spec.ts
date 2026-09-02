import { describe, expect, test, vi } from "vitest";
import type { AudioStreamPlayerResult } from "@/store/audioStreamPlayer";
import { AudioKey, EngineId, SpeakerId, StyleId } from "@/type/preload";

const streamPlayer = vi.hoisted(() => ({
  play: vi.fn(),
  stop: vi.fn(async () => undefined),
  getCurrentTime: vi.fn((): number | undefined => undefined),
}));

vi.mock("@/store/audioStreamPlayer", () => ({
  createAudioStreamPlayer: vi.fn(() => streamPlayer),
}));

import { store } from "@/store";

type SessionControl = {
  readonly callback: () => void;
  readonly resolve: (result: AudioStreamPlayerResult) => void;
};

const prepareSession = (audioKey: AudioKey): SessionControl => {
  store.mutations.INSERT_AUDIO_ITEM({
    audioKey,
    audioItem: {
      text: "",
      voice: {
        engineId: EngineId("audio-player-engine"),
        speakerId: SpeakerId("audio-player-speaker"),
        styleId: StyleId(1),
      },
    },
    prevAudioKey: undefined,
  });
  store.mutations.SET_ACTIVE_AUDIO_KEY({ audioKey });
  store.mutations.SET_AUDIO_NOW_GENERATING({
    audioKey,
    nowGenerating: true,
  });

  let callback: (() => void) | undefined;
  let resolve: ((result: AudioStreamPlayerResult) => void) | undefined;
  streamPlayer.play.mockImplementationOnce(
    (
      _response: Response,
      _startOffset: number,
      _outputDevice: string,
      onFirstPcmScheduled: () => void,
    ) => {
      callback = onFirstPcmScheduled;
      const promise = new Promise<AudioStreamPlayerResult>((nextResolve) => {
        resolve = nextResolve;
      });
      return promise;
    },
  );

  const playPromise = store.actions.PLAY_AUDIO_STREAM({
    response: new Response(null),
    startOffset: 0,
    audioKey,
  });
  void playPromise;

  if (callback == undefined || resolve == undefined) {
    throw new Error("ストリームセッションの初期化に失敗しました。");
  }
  return { callback, resolve };
};

describe("audioPlayerStore", () => {
  test("最初のPCM通知で状態を切り替え、完了時に解除する", async () => {
    const audioKey = AudioKey("audio-player-complete");
    if (store.state.nowPlayingAudioKey != undefined) {
      store.mutations.SET_AUDIO_NOW_PLAYING({
        audioKey: store.state.nowPlayingAudioKey,
        nowPlaying: false,
      });
    }
    streamPlayer.getCurrentTime.mockReturnValue(undefined);
    const session = prepareSession(audioKey);

    expect(store.state.audioStates[audioKey].nowGenerating).toBe(true);
    session.callback();
    expect(store.state.audioStates[audioKey].nowGenerating).toBe(false);
    expect(store.state.nowPlayingAudioKey).toBe(audioKey);

    session.resolve({ type: "completed", audioBlob: new Blob() });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.state.nowPlayingAudioKey).toBeUndefined();
  });

  test("停止はストリームの完了を待ちfalseを返す", async () => {
    const audioKey = AudioKey("audio-player-stop");
    if (store.state.nowPlayingAudioKey != undefined) {
      store.mutations.SET_AUDIO_NOW_PLAYING({
        audioKey: store.state.nowPlayingAudioKey,
        nowPlaying: false,
      });
    }
    const session = prepareSession(audioKey);
    session.callback();

    const stopPromise = store.actions.STOP_AUDIO();
    expect(streamPlayer.stop).toHaveBeenCalled();
    session.resolve({ type: "stopped" });

    await expect(stopPromise).resolves.toBeUndefined();
    expect(store.state.nowPlayingAudioKey).toBeUndefined();
  });

  test("古いPCM通知は後続再生の状態を変更しない", async () => {
    const firstKey = AudioKey("audio-player-old");
    const secondKey = AudioKey("audio-player-new");
    if (store.state.nowPlayingAudioKey != undefined) {
      store.mutations.SET_AUDIO_NOW_PLAYING({
        audioKey: store.state.nowPlayingAudioKey,
        nowPlaying: false,
      });
    }
    const firstSession = prepareSession(firstKey);
    const firstStop = store.actions.STOP_AUDIO();
    firstSession.resolve({ type: "stopped" });
    await firstStop;

    const secondSession = prepareSession(secondKey);
    firstSession.callback();
    expect(store.state.nowPlayingAudioKey).toBeUndefined();
    secondSession.callback();
    expect(store.state.nowPlayingAudioKey).toBe(secondKey);
    secondSession.resolve({ type: "completed", audioBlob: new Blob() });
    await Promise.resolve();
    await Promise.resolve();
  });

  test("エラー時に再生状態を解除してエラーを伝播する", async () => {
    const audioKey = AudioKey("audio-player-error");
    const error = new Error("stream error");
    store.mutations.INSERT_AUDIO_ITEM({
      audioKey,
      audioItem: {
        text: "",
        voice: {
          engineId: EngineId("audio-player-engine"),
          speakerId: SpeakerId("audio-player-speaker"),
          styleId: StyleId(1),
        },
      },
      prevAudioKey: undefined,
    });
    store.mutations.SET_ACTIVE_AUDIO_KEY({ audioKey });
    store.mutations.SET_AUDIO_NOW_PLAYING({ audioKey, nowPlaying: true });
    streamPlayer.play.mockRejectedValueOnce(error);

    await expect(
      store.actions.PLAY_AUDIO_STREAM({
        response: new Response(null),
        startOffset: 0,
        audioKey,
      }),
    ).rejects.toBe(error);
    expect(store.state.nowPlayingAudioKey).toBeUndefined();
  });

  test("ストリーム時刻がある間だけHTML音声より優先する", () => {
    const audioKey = AudioKey("audio-player-time");
    store.mutations.INSERT_AUDIO_ITEM({
      audioKey,
      audioItem: {
        text: "",
        voice: {
          engineId: EngineId("audio-player-engine"),
          speakerId: SpeakerId("audio-player-speaker"),
          styleId: StyleId(1),
        },
      },
      prevAudioKey: undefined,
    });
    store.mutations.SET_ACTIVE_AUDIO_KEY({ audioKey });
    streamPlayer.getCurrentTime.mockReturnValue(1.25);
    const getCurrentTime = store.getters.ACTIVE_AUDIO_ELEM_CURRENT_TIME_GETTER;

    expect(getCurrentTime()).toBe(1.25);
    streamPlayer.getCurrentTime.mockReturnValue(undefined);
    expect(getCurrentTime()).toBe(0);
  });
});
