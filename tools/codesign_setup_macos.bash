#!/usr/bin/env bash
# !!! コードサイニング証明書を取り扱うので取り扱い注意 !!!

# 公証用APIキーを一時ファイルへ復元する

set -eu

if [ "${APPLE_API_KEY_PATH+x}" != x ]; then
    echo "APPLE_API_KEY_PATHが未定義です" >&2
    exit 1
fi
if [ -z "$APPLE_API_KEY_PATH" ]; then
    echo "APPLE_API_KEY_PATHが空文字です" >&2
    exit 1
fi

cleanup() {
    local status=$?
    if ! rm -f "$APPLE_API_KEY_PATH"; then
        echo "App Store Connect APIキーの一時ファイルを削除できませんでした。" >&2
        if [ "$status" -eq 0 ]; then
            status=1
        fi
    fi
    exit "$status"
}
trap cleanup EXIT

if [ "${APPLE_API_KEY_BASE64+x}" != x ]; then
    echo "APPLE_API_KEY_BASE64が未定義です" >&2
    exit 1
fi
if [ -z "$APPLE_API_KEY_BASE64" ]; then
    echo "APPLE_API_KEY_BASE64が空文字です" >&2
    exit 1
fi
umask 077
if ! printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode >"$APPLE_API_KEY_PATH"; then
    echo "App Store Connect APIキーの復元に失敗しました。" >&2
    exit 1
fi

trap - EXIT
