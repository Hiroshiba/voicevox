#!/usr/bin/env bash
# !!! コードサイニング証明書を取り扱うので取り扱い注意 !!!

# 公証用APIキーを一時ファイルへ復元する

set -eu

if [ ! -v APPLE_API_KEY_BASE64 ]; then
    echo "APPLE_API_KEY_BASE64が未定義です" >&2
    exit 1
fi
if [ -z "$APPLE_API_KEY_BASE64" ]; then
    echo "APPLE_API_KEY_BASE64が空文字です" >&2
    exit 1
fi

APPLE_API_KEY_PATH="$(mktemp -d)/voicevox-apple-api-key.p8"

printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode >"$APPLE_API_KEY_PATH"
echo "APPLE_API_KEY_PATH=$APPLE_API_KEY_PATH" >> "$GITHUB_ENV"
