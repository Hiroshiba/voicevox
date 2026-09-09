!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef BUILD_UNINSTALLER
  !define VOICEVOX_AUTO_START_APP
  !define VOICEVOX_INITIAL_ENGINE_TARGET_DIRECTML "windows-x64-directml"
  !define VOICEVOX_INITIAL_ENGINE_TARGET_CPU "windows-x64-cpu"
  !define VOICEVOX_INITIAL_ENGINE_TARGET_CUDA "windows-x64-cuda"

  Var voicevoxInitialEngineTarget
  Var voicevoxInitialEngineTargetSkipped
  Var voicevoxInitialEngineTargetDirectMLRadioButton
  Var voicevoxInitialEngineTargetCPURadioButton
  Var voicevoxInitialEngineTargetCUDARadioButton

  !macro customFinishPage
  !macroend

  AutoCloseWindow true
!endif

!macro customHeader
  Function .onInstSuccess
    ; インストール後に%LOCALAPPDATA%\voicevox-updater\を削除する
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    Push $R0
    ${GetParent} "$LOCALAPPDATA\${APP_PACKAGE_STORE_FILE}" $R0
    RMDir /r "$R0"
    Pop $R0
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}

    !ifdef VOICEVOX_AUTO_START_APP
      ${ifNot} ${Silent}
        HideWindow
        StrCpy $1 "--voicevox-initial-engine-target=$voicevoxInitialEngineTarget"
        ${if} ${isUpdated}
          StrCpy $1 "$1 --updated"
        ${endif}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
        ${if} $0 != "ok"
        ${andIf} $0 != "fallback"
          MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST "アプリを自動起動できませんでした。インストール先またはスタートメニューから手動で起動してください。戻り値: $0"
        ${endif}
      ${endif}
    !endif
  FunctionEnd
!macroend

!ifndef BUILD_UNINSTALLER
  !macro validateVoicevoxInitialEngineTarget
    ${If} $voicevoxInitialEngineTarget == "${VOICEVOX_INITIAL_ENGINE_TARGET_DIRECTML}"
    ${OrIf} $voicevoxInitialEngineTarget == "${VOICEVOX_INITIAL_ENGINE_TARGET_CPU}"
    ${OrIf} $voicevoxInitialEngineTarget == "${VOICEVOX_INITIAL_ENGINE_TARGET_CUDA}"
    ${Else}
      MessageBox MB_OK|MB_ICONSTOP "初回起動時のエンジン選択を引き継げませんでした。セットアップを中止します。"
      SetErrorLevel 1
      Quit
    ${EndIf}
  !macroend

  !macro customInit
    StrCpy $voicevoxInitialEngineTarget ""
    ${If} ${UAC_IsInnerInstance}
      !insertmacro UAC_AsUser_GetGlobalVar $voicevoxInitialEngineTarget
    ${Else}
      StrCpy $voicevoxInitialEngineTarget "${VOICEVOX_INITIAL_ENGINE_TARGET_DIRECTML}"
    ${EndIf}
    !insertmacro validateVoicevoxInitialEngineTarget
  !macroend

  !macro customWelcomePage
    Page custom voicevoxInitialEngineTargetPageShow voicevoxInitialEngineTargetPageLeave
    !insertmacro voicevoxInitialEngineTargetPageFunctions
  !macroend

  !macro voicevoxInitialEngineTargetPageFunctions
  Function voicevoxInitialEngineTargetPageShow
    ${If} ${UAC_IsInnerInstance}
    ${AndIf} $voicevoxInitialEngineTargetSkipped != "1"
      StrCpy $voicevoxInitialEngineTargetSkipped "1"
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "エンジンの選択" "初回起動時に使用するエンジンを選択してください。"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == "error"
      MessageBox MB_OK|MB_ICONSTOP "エンジン選択画面を作成できませんでした。セットアップを中止します。"
      SetErrorLevel 1
      Quit
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "初回起動時に導入するエンジンを選択してください。"
    Pop $0
    ${NSD_CreateLabel} 0 24u 100% 36u "全ユーザー向けにインストールしても、エンジンはVOICEVOXを起動したユーザーごとに導入されます。"
    Pop $0

    ${NSD_CreateRadioButton} 10u 68u 280u 18u "DirectML 推奨"
    Pop $voicevoxInitialEngineTargetDirectMLRadioButton
    ${NSD_CreateRadioButton} 10u 90u 280u 18u "CPU"
    Pop $voicevoxInitialEngineTargetCPURadioButton
    ${NSD_CreateRadioButton} 10u 112u 280u 18u "CUDA"
    Pop $voicevoxInitialEngineTargetCUDARadioButton

    ${If} $voicevoxInitialEngineTarget == "${VOICEVOX_INITIAL_ENGINE_TARGET_DIRECTML}"
      ${NSD_SetState} $voicevoxInitialEngineTargetDirectMLRadioButton ${BST_CHECKED}
    ${ElseIf} $voicevoxInitialEngineTarget == "${VOICEVOX_INITIAL_ENGINE_TARGET_CPU}"
      ${NSD_SetState} $voicevoxInitialEngineTargetCPURadioButton ${BST_CHECKED}
    ${ElseIf} $voicevoxInitialEngineTarget == "${VOICEVOX_INITIAL_ENGINE_TARGET_CUDA}"
      ${NSD_SetState} $voicevoxInitialEngineTargetCUDARadioButton ${BST_CHECKED}
    ${Else}
      !insertmacro validateVoicevoxInitialEngineTarget
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function voicevoxInitialEngineTargetPageLeave
    ${NSD_GetState} $voicevoxInitialEngineTargetDirectMLRadioButton $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $voicevoxInitialEngineTarget "${VOICEVOX_INITIAL_ENGINE_TARGET_DIRECTML}"
    ${Else}
      ${NSD_GetState} $voicevoxInitialEngineTargetCPURadioButton $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $voicevoxInitialEngineTarget "${VOICEVOX_INITIAL_ENGINE_TARGET_CPU}"
      ${Else}
        ${NSD_GetState} $voicevoxInitialEngineTargetCUDARadioButton $0
        ${If} $0 == ${BST_CHECKED}
          StrCpy $voicevoxInitialEngineTarget "${VOICEVOX_INITIAL_ENGINE_TARGET_CUDA}"
        ${Else}
          MessageBox MB_OK|MB_ICONEXCLAMATION "初回起動時のエンジンを選択してください。"
          Abort
        ${EndIf}
      ${EndIf}
    ${EndIf}
    !insertmacro validateVoicevoxInitialEngineTarget
  FunctionEnd
  !macroend
!endif

; "%VITE_APP_NAME%"が空の状態でビルドすると他のソフトのファイルを消してしまうためビルドエラーにする。
!define DOLLAR "$"
!if "$%VITE_APP_NAME%" == "${DOLLAR}%VITE_APP_NAME%"
  !error 'The environment variable "%VITE_APP_NAME%" is undefined.'
!endif
!if "$%VITE_APP_NAME%" == ""
  !error 'The environment variable "%VITE_APP_NAME%" is empty.'
!endif

!macro locateVvppTmp callbacks
  ${Locate} "$APPDATA\$%VITE_APP_NAME%\vvpp-engines\.tmp" "/L=D /M=????????????? /G=0" ${callbacks}
!macroend

!macro locateVvppEngines callbacks
  ${Locate} "$APPDATA\$%VITE_APP_NAME%\vvpp-engines" "/L=D /M=*+????????-????-????-????-???????????? /G=0" ${callbacks}
!macroend

!macro customUninstallPage
  ; エンジンディレクトリが存在する場合は、消去するかのチェックボックスを案内する
  ; 存在しない場合はそのまま終了する
  UninstPage custom un.removeUserDataPage un.removeUserDataPageLeave

  Function un.removeUserDataPage
    Push $0

    Var /GLOBAL isExistEngine
    StrCpy $isExistEngine "0"

    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}

    Push $R0

    StrCpy $R0 "0"
    !insertmacro locateVvppTmp un.isExistVvppTmp
    ${If} $R0 == "1"
      StrCpy $isExistEngine "1"
    ${Else}
      RMDir "$APPDATA\$%VITE_APP_NAME%\vvpp-engines\.tmp"
    ${EndIf}
    ClearErrors

    ${If} $isExistEngine == "0"
      StrCpy $R0 "0"
      !insertmacro locateVvppEngines un.isExistVvppEngines
      ${If} $R0 == "1"
        StrCpy $isExistEngine "1"
      ${Else}
        RMDir "$APPDATA\$%VITE_APP_NAME%\vvpp-engines"
      ${EndIf}
      ClearErrors
    ${EndIf}

    Pop $R0

    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}

    ${If} $isExistEngine == "0"
      Pop $0
      Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $0

    ${If} $0 == "error"
      Pop $0
      Abort
    ${EndIf}

    ; 既にアンインストールは完了してしまっているためキャンセルボタンは無効化する
    GetDlgItem $0 $HWNDPARENT 2
    EnableWindow $0 0

    ${NSD_CreateCheckBox} 0 0 100% 12u "追加エンジンを削除する"
    Var /GLOBAL removeAdditionalEngineCheckBox
    Pop $removeAdditionalEngineCheckBox

    nsDialogs::Show

    Pop $0
  FunctionEnd

  Function un.removeUserDataPageLeave
    Push $0
    ; 削除の処理
    ${NSD_GetState} $removeAdditionalEngineCheckBox $0

    ${If} $0 == ${BST_CHECKED}
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}

      !insertmacro locateVvppTmp un.removeVvppTmp
      RMDir "$APPDATA\$%VITE_APP_NAME%\vvpp-engines\.tmp"
      !insertmacro locateVvppEngines un.removeVvppEngines
      RMDir "$APPDATA\$%VITE_APP_NAME%\vvpp-engines"
      ; 未知のファイルが残っている場合削除されずにエラーフラグが立つのでクリアする
      ClearErrors

      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
    Pop $0
  FunctionEnd

  Function un.isExistVvppTmp
    ; 実行された場合は"$R0"に"1"を代入する。
    StrCpy $R0 "1"
    Push "StopLocate"
  FunctionEnd

  Function un.removeVvppTmp
    RMDir /r "$R9"
    Push ""
  FunctionEnd

  Function un.isExistVvppEngines
    ; "engine_manifest.json"がある場合"$R0"に"1"を代入する。
    ${If} ${FileExists} "$R9\engine_manifest.json"
      StrCpy $R0 "1"
      Push "StopLocate"
    ${Else}
      Push ""
    ${EndIf}
  FunctionEnd

  Function un.removeVvppEngines
    ; "engine_manifest.json"があるか確認してから削除する。
    ${If} ${FileExists} "$R9\engine_manifest.json"
      RMDir /r "$R9"
      ClearErrors
    ${EndIf}
    Push ""
  FunctionEnd

  ; MUI_UNPAGE_FINISHの戻るボタンを無効化する
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.disableBack

  Function un.disableBack
    Push $0
    GetDlgItem $0 $HWNDPARENT 3
    EnableWindow $0 0
    Pop $0
  FunctionEnd
!macroend
