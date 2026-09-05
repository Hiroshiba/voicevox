#!/usr/bin/env bash
# !!! コードサイニング証明書を取り扱うので取り扱い注意 !!!

# 公証用APIキーを一時ファイルへ復元する

set -eu

APPLE_API_KEY_PATH="$(mktemp -d)/voicevox-apple-api-key.p8"
APPLE_API_KEY_DIRECTORY="${APPLE_API_KEY_PATH%/*}"

cleanup() {
    local status=$?
    if ! rm -f "$APPLE_API_KEY_PATH"; then
        echo "App Store Connect APIキーの一時ファイルを削除できませんでした。" >&2
        if [ "$status" -eq 0 ]; then
            status=1
        fi
    fi
    if ! rmdir "$APPLE_API_KEY_DIRECTORY"; then
        echo "App Store Connect APIキーの一時ディレクトリを削除できませんでした。" >&2
        if [ "$status" -eq 0 ]; then
            status=1
        fi
    fi
    exit "$status"
}
trap cleanup EXIT

if [ ! -v APPLE_API_KEY_BASE64 ]; then
    echo "APPLE_API_KEY_BASE64が未定義です" >&2
    exit 1
fi
if [ -z "$APPLE_API_KEY_BASE64" ]; then
    echo "APPLE_API_KEY_BASE64が空文字です" >&2
    exit 1
fi
if ! printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode >"$APPLE_API_KEY_PATH"; then
    echo "App Store Connect APIキーの復元に失敗しました。" >&2
    exit 1
fi
echo "APPLE_API_KEY_PATH=$APPLE_API_KEY_PATH" >> "$GITHUB_ENV"

trap - EXIT
