!ifndef VOICEVOX_INSTALLER_COMMON_INCLUDED
!define VOICEVOX_INSTALLER_COMMON_INCLUDED

!include "LogicLib.nsh"
!include "FileFunc.nsh"

!macro customHeader
  ; インストール成功後に%LOCALAPPDATA%\voicevox-updater\を削除する
  Function .onInstSuccess
    ; https://github.com/electron-userland/electron-builder/blob/f717e0ea67cec7c5c298889efee7df724838491a/packages/app-builder-lib/templates/nsis/include/installer.nsh#L77
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
        ${if} ${isUpdated}
          StrCpy $1 "--updated"
        ${else}
          StrCpy $1 ""
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

      !insertmacro locateVvppTmp  un.removeVvppTmp
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

!endif
