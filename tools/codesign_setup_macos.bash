#!/usr/bin/env bash
# !!! コードサイニング証明書を取り扱うので取り扱い注意 !!!

# 公証用APIキーを一時ファイルへ復元し、署名・公証用の環境変数を設定する

set -eu

if [ ! -v APPLE_API_KEY_BASE64 ]; then
    echo "APPLE_API_KEY_BASE64が未定義です" >&2
    exit 1
fi
APPLE_API_KEY="$(mktemp -d)/voicevox-apple-api-key.p8"

printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode >"$APPLE_API_KEY"
echo "CSC_LINK=$(printf '%s' "$CSC_LINK" | tr -d '\r\n')" >> "$GITHUB_ENV"
echo "CSC_KEY_PASSWORD=$CSC_KEY_PASSWORD" >> "$GITHUB_ENV"
echo "APPLE_API_KEY=$APPLE_API_KEY" >> "$GITHUB_ENV"
echo "APPLE_API_KEY_ID=$APPLE_API_KEY_ID" >> "$GITHUB_ENV"
echo "APPLE_API_ISSUER=$APPLE_API_ISSUER" >> "$GITHUB_ENV"
