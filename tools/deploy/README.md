# 管理者・オフライン向けの配置

準備済みのエディターとエンジンを、ネットワークから取得せずに配置します。
配置スクリプトはアプリやエンジンを起動せず、配置とOSごとの登録処理がすべて完了した場合だけ終了コード0を返します。
GPUドライバーや音声合成の動作確認は含みません。

通常のWindowsインストーラーでは、アプリを全ユーザー向けに導入しても、エンジンは起動したユーザーごとにダウンロードされます。
エンジンも共有する場合は、この配置手順を使ってください。
インストール不要で個人利用する場合は、CPU・DirectMLのエンジン同梱ZIPも利用できます。

## 準備

- Windowsでは、エンジン分離版のSetup.exeと、それに対応する単一の`.nsis.7z`を用意します。
- macOSでは、エンジン分離版の署名済み`VOICEVOX.app`を用意します。
- 使用するエディターに対応する公式エンジンを展開し、`engine_manifest.json`と実行ファイルがあるディレクトリを用意します。
- エンジンのRuntime Targetを確認します。Windowsは`windows-x64-cpu`、`windows-x64-directml`、`windows-x64-cuda`、macOSは`macos-x64-cpu`、`macos-arm64-cpu`です。

入力ファイルの真正性やハッシュの検証は、このスクリプトでは行いません。管理者が信頼できる配布元から準備してください。
配布元は読み取り専用でも利用できます。WindowsのNSISには作業用コピーを渡すため、パッケージの原本は消費しません。
エンジン入力には旧アプリ内の`vv-engine`も指定できます。アプリを更新する前に、エンジンを作業用ディレクトリへ確保します。

更新・削除の前に、対象を使っているすべてのユーザーのVOICEVOXとエンジンを終了してください。
同じ配置先への処理を並行して実行しないでください。
エンジンの配置先はアプリの外の専用ディレクトリとし、入力元や他の配置先と重ねないでください。
既存のエンジンを更新する場合も、入力元は更新先とは別に用意します。

## Windows

64ビット版Windows PowerShell 5.1で実行します。
`Machine`は昇格済みの管理者またはSYSTEM、`User`は導入対象のユーザーとして実行してください。
SYSTEMから別のユーザーの個人環境へ導入する機能はありません。

```powershell
.\windows.ps1 -Action Install -Scope Machine `
  -SetupPath "D:\packages\VOICEVOX.Setup.exe" `
  -PackagePath "D:\packages\voicevox.nsis.7z" `
  -EngineSourcePath "D:\packages\engine" `
  -AppPath "C:\Program Files\VOICEVOX" `
  -EnginePath "C:\Program Files\VOICEVOX Engine" `
  -RuntimeTarget windows-x64-directml
```

個人導入では`-Scope User`と、そのユーザーが管理する配置先を指定します。
関連付けはNSISで登録し、他のアプリを既定にしているユーザーの選択は強制変更しません。
全ユーザー導入では、通常ユーザーが配置先を置換できる場所や、管理対象へ書き込める独自ACLの場所を拒否します。

配置ツールが所有するエンジンだけを削除する場合は、導入時と同じスコープと配置先を指定します。

```powershell
.\windows.ps1 -Action RemoveEngine -Scope Machine `
  -AppPath "C:\Program Files\VOICEVOX" `
  -EnginePath "C:\Program Files\VOICEVOX Engine"
```

アプリは通常のWindowsアンインストーラーで削除します。

## macOS

JSONの処理に使う`jq`を、対象端末へ事前に用意してください。スクリプトは依存コマンドのダウンロードも行いません。
`user`は導入対象ユーザー、`machine`はrootで実行します。
署名済み`.app`はファイル内容を変更せずにコピーし、エンジンは`.app`の外へ配置します。
`machine`ではコピー先の所有者をrootにし、一般ユーザーが読み取り・実行できる権限に整えます。
`machine`の配置先の親にも保護が必要です。root所有でない親や、信頼されないグループ・他のユーザーが書き込める親、書き込みや所有者変更を許可する独自ACLがある場所は拒否します。
`user`では、コピーしたディレクトリに所有者の読み書き・実行権限を確保します。

```bash
sudo bash macos.sh install --scope machine \
  --app-source /Volumes/VOICEVOX/VOICEVOX.app \
  --app-path /Applications/VOICEVOX.app \
  --engine-source /Volumes/Packages/engine \
  --engine-path '/Library/Application Support/VOICEVOX Engine' \
  --runtime-target macos-arm64-cpu
```

個人導入では`sudo`を付けず、`--scope user`と、そのユーザーのApplications等の配置先を指定します。
外部ボリュームでも、権限の条件を満たす専用ディレクトリを指定できます。ボリューム自体をエンジン配置先にはできません。
配置後のLaunch Services登録は、スクリプトを実行したユーザーに対する処理です。
`machine`ではroot側の登録となり、他ユーザーの登録完了は保証しません。通常は`/Applications`へ配置し、各ユーザーのログイン後に関連付けを確認してください。
別の場所へ配置した場合など、認識されないときは対象ユーザーとして次を実行します。既定アプリの強制変更は行いません。
コマンド末尾のアプリパスは、実際の配置先へ置き換えてください。

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/VOICEVOX.app
```

別配置したエンジンの署名・公証とGatekeeperでの動作は、エディターとは別に確認してください。

```bash
sudo bash macos.sh remove-engine --scope machine \
  --app-path /Applications/VOICEVOX.app \
  --engine-path '/Library/Application Support/VOICEVOX Engine'
```

アプリは配置した`.app`を削除します。

## 配置情報と失敗時の扱い

アプリの隣に`<アプリの配置先>.voicevox-deployment.json`を保存します。
このファイルは、スコープ、エンジンのパス・UUID・バージョン・Runtime Target、配置の完了状態を記録します。
外部ツールからエンジン実体を参照する場合は、スクリプトに指定したエンジンの配置先を使ってください。
エディターは同じUUIDについて、同梱エンジン、管理者配置エンジン、個人用VVPPの順で採用します。
管理者配置エンジンはエディターから更新・削除できません。変更後はエディターを起動し直してください。

配置情報が準備中、エンジンが見つからない、またはmanifestと一致しない場合は起動を止めます。
個人領域へ自動的に別のエンジンを導入することはありません。
配置情報を手動で消したり、アプリやエンジンだけを移動したりしないでください。配置情報自体がなくなったことは検出できません。

完全なロールバックは行いません。途中で失敗すると、アプリだけが更新済みの場合や、エンジンの一時ディレクトリ・バックアップが残る場合があります。
エラーと残ったファイルを確認してから、同じ入力で再実行してください。残存ファイルの整理が必要な場合は、対象を確認して手動で復旧します。
準備中の情報を手動で導入済みに変更してはいけません。

エンジン削除コマンドは配置情報で所有を確認したディレクトリだけを削除します。
ユーザー設定、プロジェクト、個人用VVPP、他ユーザーの領域は削除しません。
アプリを残して管理エンジンと配置情報を削除すると、次回起動は通常の初回自動導入になります。
