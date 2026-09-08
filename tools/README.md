# tools/

実行ファイルをダウンロードするスクリプトでは、ダウンロード直後に SHA256 を検証する。
バージョン更新時は、各スクリプト内のハッシュ値を `curl -sL <URL> | sha256sum` で取得した値に書き換える。
公開直後のリリースはサプライチェーン攻撃のリスクが高いため、リリースから 7 日以上経過後に更新すること。

## Windows 同梱版のコマンド導入

ビルドワークフローは、同梱版の EXE と `.nsis.7z` のサイズ・SHA-512、エディターとエンジンのバージョンを `*.nsis.7z.json` に記録する。
手動で生成する場合は、次のコマンドを使う。

```text
pnpm exec tsx tools/generateWindowsInstallerManifest.ts --package-directory dist_electron/nsis-web --engine-directory prepackage/vv-engine --runtime-target windows-x64-directml
```

EXE、`.nsis.7z`、対応する JSON、`Install-VOICEVOX.ps1` を同じディレクトリへ配置し、64 bit の Windows PowerShell で実行する。
`User` は対象ユーザーの非昇格コンテキスト、`Machine` は昇格済みの管理者コンテキストで実行する。
スクリプトは成果物のハッシュを確認するが、JSON 自体の署名は検証しないため、すべて信頼できる配布元から取得すること。

```powershell
powershell -File .\Install-VOICEVOX.ps1 -Scope User -ManifestPath .\voicevox-directml-0.25.0-x64.nsis.7z.json
```

`PackagePath` と `InstallerPath` で別の場所の成果物を指定できる。
`InstallDirectory` でインストール先の絶対パスを指定できる。
導入後は選択したスコープのインストール先、実行ファイル、エンジンの UUID・バージョン、`.vvproj`・`.vvpp`・`.vvppp` の関連付けを確認する。
終了コードは成功が `0`、引数不正が `10`、ファイル欠落が `20`、サイズ・ハッシュ不一致が `21`、インストーラー失敗が `30`、事後確認失敗が `40`、権限不足が `50` となる。
