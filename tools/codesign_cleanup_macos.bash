#!/usr/bin/env bash
# !!! コードサイニング証明書を取り扱うので取り扱い注意 !!!

# 公証用APIキーの一時ファイルを削除する

set -eu

if [ ! -v APPLE_API_KEY ]; then
    echo "APPLE_API_KEYが未定義です" >&2
    exit 1
fi

rm "$APPLE_API_KEY"
rmdir "${APPLE_API_KEY%/*}"
