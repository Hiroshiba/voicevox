# !!! コードサイニング証明書を取り扱うので取り扱い注意 !!!

# eSignerCKAで読み込んだコードサイニング証明書を破棄する

set -eu

if [ ! -v THUMBPRINT_PATH ]; then # THUMBPRINTの出力先
    echo "THUMBPRINT_PATHが未定義です"
    exit 1
fi

if [ ! -v SIGNTOOL_PATH_PATH ]; then # 対応しているsigntoolのパスの出力先
    echo "SIGNTOOL_PATH_PATHが未定義です"
    exit 1
fi

if [ ! -v ESIGNERCKA_INSTALL_DIR ]; then # eSignerCKAのインストール先
    ESIGNERCKA_INSTALL_DIR='..\eSignerCKA'
fi

# 証明書を破棄
powershell "& '$ESIGNERCKA_INSTALL_DIR\eSignerCKATool.exe' unload"

# THUMBPRINTとsigntoolのパスの受け渡し用ファイルを削除
rm "$THUMBPRINT_PATH" "$SIGNTOOL_PATH_PATH"
