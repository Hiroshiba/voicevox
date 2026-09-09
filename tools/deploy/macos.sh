#!/usr/bin/env bash
set -euo pipefail

readonly launch_services_register="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
readonly receipt_suffix=".voicevox-deployment.json"
readonly voicevox_bundle_identifier="jp.hiroshiba.voicevox"
readonly voicevox_executable_name="VOICEVOX"

app_stage_root=""
engine_stage_root=""
receipt_temp_path=""
app_backup_path=""
engine_backup_path=""

usage() {
  printf '%s\n' \
    '使い方:' \
    '  macos.sh install --scope user|machine --app-source APP --app-path APP --engine-source ENGINE --engine-path ENGINE --runtime-target macos-x64-cpu|macos-arm64-cpu' \
    '  macos.sh remove-engine --scope user|machine --app-path APP --engine-path ENGINE' >&2
  exit 2
}

die() {
  printf 'エラー: %s\n' "$1" >&2
  exit 1
}

cleanup_directory() {
  local directory=$1
  if [[ -n "$directory" && -d "$directory" && ! -L "$directory" ]]; then
    rm -rf "$directory"
  fi
}

cleanup() {
  local status=$?
  local cleanup_status=0

  if [[ -n "$receipt_temp_path" && -e "$receipt_temp_path" && ! -L "$receipt_temp_path" ]]; then
    rm -f "$receipt_temp_path" || cleanup_status=1
  fi
  cleanup_directory "$app_stage_root" || cleanup_status=1
  cleanup_directory "$engine_stage_root" || cleanup_status=1

  if [[ "$status" -eq 0 && "$cleanup_status" -ne 0 ]]; then
    status=1
  fi
  trap - EXIT
  exit "$status"
}

trap cleanup EXIT

assert_no_control_characters() {
  local value=$1
  case "$value" in
    *$'\n'*|*$'\r'*|*$'\t'*)
      die "改行または制御文字を含む値は指定できません。"
      ;;
  esac
}

assert_absolute_path() {
  local value=$1
  local name=$2
  assert_no_control_characters "$value"
  [[ "$value" == /* ]] || die "$nameには絶対パスを指定してください。"
}

path_within() {
  local base=$1
  local candidate=$2
  [[ "$candidate" == "$base" || "$candidate" == "$base/"* ]]
}

paths_overlap() {
  local first=$1
  local second=$2
  path_within "$first" "$second" || path_within "$second" "$first"
}

assert_not_broad_path() {
  local path=$1
  local name=$2
  case "$path" in
    /|/System|/Library|/Library/Application\ Support|/Applications|/Users|/Volumes|/private|/tmp|/var|/usr|/bin|/sbin|/opt)
      die "$nameに広い共有ディレクトリを指定できません。パス: $path"
      ;;
    /System/*|/private/tmp/*|/private/var/*|/var/*|/usr/*|/bin/*|/sbin/*)
      die "$nameに管理対象外のシステム領域を指定できません。パス: $path"
      ;;
  esac
}

assert_destination_scope() {
  local path=$1
  local name=$2

  assert_absolute_path "$path" "$name"
  assert_not_broad_path "$path" "$name"
  if [[ "$scope" == "user" ]]; then
    case "$path" in
      "$user_home"|"$user_home/Applications"|"$user_home/Library"|"$user_home/Library/Application Support"|"$user_home/Documents"|"$user_home/Downloads")
        die "$nameに広いユーザー領域を指定できません。パス: $path"
        ;;
      /Users/*)
        path_within "$user_home" "$path" || die "Userスコープの配置先は対象ユーザーのホーム以下にしてください。パス: $path"
        ;;
    esac
  else
    case "$path" in
      /Users/*|/private/var/root/*)
        die "Machineスコープの配置先に個人領域を指定できません。パス: $path"
        ;;
    esac
  fi
  case "$path" in
    /Volumes/*)
      local volume_relative=${path#/Volumes/}
      local volume_name=${volume_relative%%/*}
      local volume_root="/Volumes/$volume_name"
      [[ "$volume_relative" == */* ]] || die "$nameには外部ボリューム直下ではなく専用ディレクトリを指定してください。パス: $path"
      [[ -d "$volume_root" && ! -L "$volume_root" ]] || die "外部ボリュームが見つかりません。パス: $volume_root"
      ;;
  esac
}

assert_destination_input() {
  local value=$1
  local name=$2
  local normalized=${value%/}

  assert_absolute_path "$value" "$name"
  [[ "$normalized" != "/" && -n "$normalized" ]] || die "$nameにルートを指定できません。"
  case "$normalized" in
    *"/../"*|*"/./"*|*"//"*|*/..|*/.)
      die "$nameに正規化が必要なパス要素を指定できません。パス: $value"
      ;;
  esac
  assert_destination_scope "$normalized" "$name"
}

assert_no_symlink_in_path() {
  local current=$1
  while [[ "$current" != "/" ]]; do
    if [[ -L "$current" ]]; then
      die "シンボリックリンクを含む配置先は指定できません。パス: $current"
    fi
    current=$(dirname "$current")
  done
}

canonical_existing_directory() {
  local value=$1
  local name=$2
  local canonical

  assert_absolute_path "$value" "$name"
  [[ -d "$value" && ! -L "$value" ]] || die "$nameが通常のディレクトリではありません。パス: $value"
  if ! canonical=$(cd -P "$value" && pwd -P); then
    die "$nameの実パスを解決できません。パス: $value"
  fi
  printf '%s\n' "$canonical"
}

canonical_destination_path() {
  local value=$1
  local name=$2
  local normalized=${value%/}
  local parent
  local basename_value
  local canonical_parent

  assert_destination_input "$value" "$name"
  parent=$(dirname "$normalized")
  basename_value=$(basename "$normalized")
  [[ "$basename_value" != "." && "$basename_value" != ".." && -n "$basename_value" ]] || die "$nameの末尾が不正です。"
  assert_no_symlink_in_path "$parent"

  if [[ ! -d "$parent" ]]; then
    printf '%s/%s\n' "$parent" "$basename_value"
    return
  fi
  [[ -d "$parent" && ! -L "$parent" ]] || die "$nameの親ディレクトリが不正です。パス: $parent"
  if ! canonical_parent=$(cd -P "$parent" && pwd -P); then
    die "$nameの親ディレクトリを解決できません。パス: $parent"
  fi
  printf '%s/%s\n' "$canonical_parent" "$basename_value"
}

assert_user_parent_writable() {
  local directory=$1
  [[ -d "$directory" && ! -L "$directory" && -O "$directory" && -w "$directory" ]] || die "Userスコープの親ディレクトリを変更できません。パス: $directory"
}

assert_machine_directory() {
  local directory=$1
  local owner
  local group
  local mode
  local mode_value

  [[ -d "$directory" && ! -L "$directory" ]] || die "Machineスコープの親ディレクトリが不正です。パス: $directory"
  if ! owner=$(stat -f '%Su' "$directory"); then
    die "Machineスコープの所有者を確認できません。パス: $directory"
  fi
  [[ "$owner" == "root" ]] || die "Machineスコープの親ディレクトリはroot所有である必要があります。パス: $directory"
  if ! group=$(stat -f '%Sg' "$directory"); then
    die "Machineスコープのグループを確認できません。パス: $directory"
  fi
  if ! mode=$(stat -f '%Lp' "$directory"); then
    die "Machineスコープの権限を確認できません。パス: $directory"
  fi
  mode_value=$((8#$mode))
  (( (mode_value & 2) == 0 )) || die "Machineスコープの親ディレクトリへ他のユーザーが書き込めます。パス: $directory"
  if (( (mode_value & 16) != 0 )); then
    case "$group" in
      wheel|admin)
        ;;
      *)
        die "Machineスコープの親ディレクトリへ信頼されていないグループが書き込めます。パス: $directory"
        ;;
    esac
  fi
  assert_no_machine_acl_write_allow "$directory"
}

assert_machine_parent_secure() {
  local current=$1
  while :; do
    assert_machine_directory "$current"
    [[ "$current" == "/" ]] && break
    current=$(dirname "$current")
  done
}

assert_destination_parent_secure() {
  local path=$1
  local parent
  parent=$(dirname "$path")
  if [[ "$scope" == "user" ]]; then
    assert_user_parent_writable "$parent"
  else
    assert_machine_parent_secure "$parent"
  fi
}

ensure_destination_parent() {
  local path=$1
  local name=$2
  local parent

  parent=$(dirname "$path")
  if [[ ! -d "$parent" ]]; then
    mkdir -p "$parent"
  fi
  [[ -d "$parent" && ! -L "$parent" ]] || die "$nameの親ディレクトリが不正です。パス: $parent"
  assert_no_symlink_in_path "$parent"
  assert_destination_parent_secure "$path"
}

assert_regular_file() {
  local path=$1
  local name=$2
  [[ -f "$path" && ! -L "$path" ]] || die "$nameが通常ファイルではありません。パス: $path"
}

assert_directory() {
  local path=$1
  local name=$2
  [[ -d "$path" && ! -L "$path" ]] || die "$nameが通常のディレクトリではありません。パス: $path"
}

assert_machine_tree_secure() {
  local path=$1
  local writable_path
  local non_root_path

  assert_directory "$path" "Machineスコープの配置先"
  writable_path=$(find -P "$path" \( -type d -o -type f \) -perm +022 -print -quit)
  [[ -z "$writable_path" ]] || die "Machineスコープの配置先へ他のユーザーが書き込めます。パス: $writable_path"
  non_root_path=$(find -P "$path" \( -type d -o -type f \) ! -user root -print -quit)
  [[ -z "$non_root_path" ]] || die "Machineスコープの配置先がroot所有ではありません。パス: $non_root_path"
  if ! find -P "$path" \( -type d -o -type f \) -exec ls -lde {} + | awk '
    /^[[:space:]]*[0-9]+:/ && /allow/ && /(write|append|add_file|add_subdirectory|delete|chown)/ {
      found = 1
    }
    END {
      exit found
    }
  '; then
    die "Machineスコープの配置先に書き込みを許可するACLがあります。パス: $path"
  fi
}

normalize_machine_stage() {
  local path=$1

  assert_directory "$path" "Machineスコープのstage"
  if ! find -P "$path" \( -type d -o -type f \) -exec chown root:wheel {} +; then
    die "Machineスコープのstageをroot所有へ変更できません。パス: $path"
  fi
  if ! find -P "$path" -type d -exec chmod u=rwx,go=rx {} +; then
    die "Machineスコープのstageのディレクトリ権限を設定できません。パス: $path"
  fi
  if ! find -P "$path" -type f ! -perm +111 -exec chmod u=rw,go=r {} +; then
    die "Machineスコープのstageのファイル権限を設定できません。パス: $path"
  fi
  if ! find -P "$path" -type f -perm +111 -exec chmod u=rwx,go=rx {} +; then
    die "Machineスコープのstageの実行権限を設定できません。パス: $path"
  fi
}

assert_machine_file_secure() {
  local path=$1
  local owner
  local group
  local mode
  local mode_value

  assert_regular_file "$path" "Machineスコープの配置情報"
  owner=$(stat -f '%Su' "$path")
  [[ "$owner" == "root" ]] || die "Machineスコープの配置情報がroot所有ではありません。パス: $path"
  group=$(stat -f '%Sg' "$path")
  mode=$(stat -f '%Lp' "$path")
  mode_value=$((8#$mode))
  (( (mode_value & 2) == 0 )) || die "Machineスコープの配置情報へ他のユーザーが書き込めます。パス: $path"
  if (( (mode_value & 16) != 0 )); then
    case "$group" in
      wheel|admin)
        ;;
      *)
        die "Machineスコープの配置情報へ信頼されていないグループが書き込めます。パス: $path"
        ;;
    esac
  fi
  assert_no_machine_acl_write_allow "$path"
}

assert_no_machine_acl_write_allow() {
  local path=$1

  # shellcheck disable=SC2012
  if ! ls -lde "$path" | awk '
    /^[[:space:]]*[0-9]+:/ && /allow/ && /(write|append|add_file|add_subdirectory|delete|chown)/ {
      found = 1
    }
    END {
      exit found
    }
  '; then
    die "Machineスコープの配置先に書き込みを許可するACLがあります。パス: $path"
  fi
}

assert_no_deployment_artifacts() {
  local parent=$1
  local name=$2
  local candidate

  for candidate in "$parent/.$name.voicevox-deployment-"* "$parent/$name.voicevox-deployment-backup-"* "$parent/$name.voicevox-engine-backup-"*; do
    if [[ -e "$candidate" || -L "$candidate" ]]; then
      die "前回の管理配置のstageまたはbackupが残っています。パス: $candidate"
    fi
  done
}

extract_json_string() {
  local keypath=$1
  local path=$2
  local value

  if ! value=$(jq -er "$keypath | select(type == \"string\" and length > 0 and (test(\"[\\u0000-\\u001f]\") | not))" "$path"); then
    die "配置情報またはmanifestの項目を読み込めません。項目: $keypath、パス: $path"
  fi
  assert_no_control_characters "$value"
  printf '%s\n' "$value"
}

extract_plist_value() {
  local keypath=$1
  local path=$2
  local value

  if ! value=$(plutil -extract "$keypath" raw -o - "$path"); then
    die "アプリケーションInfo.plistの項目を読み込めません。項目: $keypath、パス: $path"
  fi
  assert_no_control_characters "$value"
  [[ -n "$value" ]] || die "アプリケーションInfo.plistの項目が空です。項目: $keypath、パス: $path"
  printf '%s\n' "$value"
}

validate_uuid() {
  local value=$1
  local name=$2
  [[ "$value" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || die "$nameのUUIDが不正です。"
}

validate_runtime_target() {
  local target=$1
  case "$target" in
    macos-x64-cpu|macos-arm64-cpu)
      ;;
    *)
      die "macOSのRuntime Targetが不正です。値: $target"
      ;;
  esac
}

validate_engine_directory() {
  local directory=$1
  local manifest_path
  local run_path

  assert_directory "$directory" "エンジン"
  manifest_path="$directory/engine_manifest.json"
  run_path="$directory/run"
  assert_regular_file "$manifest_path" "エンジンmanifest"
  if ! jq -e -s 'length == 1 and (.[0] | type == "object")' "$manifest_path" >/dev/null; then
    die "エンジンmanifestを読み込めません。パス: $manifest_path"
  fi
  manifest_uuid=$(extract_json_string ".uuid" "$manifest_path")
  manifest_version=$(extract_json_string ".version" "$manifest_path")
  validate_uuid "$manifest_uuid" "エンジンmanifest"
  assert_regular_file "$run_path" "エンジン実行ファイル"
  [[ -x "$run_path" ]] || die "エンジン実行ファイルに実行権限がありません。パス: $run_path"
}

validate_application_identity() {
  local app_path=$1
  local info_path
  local bundle_identifier
  local bundle_executable
  local executable_path

  assert_directory "$app_path" "アプリケーション"
  info_path="$app_path/Contents/Info.plist"
  assert_regular_file "$info_path" "アプリケーションのInfo.plist"
  if ! plutil -lint "$info_path" >/dev/null; then
    die "アプリケーションのInfo.plistを読み込めません。パス: $info_path"
  fi
  bundle_identifier=$(extract_plist_value "CFBundleIdentifier" "$info_path")
  [[ "$bundle_identifier" == "$voicevox_bundle_identifier" ]] || die "VOICEVOX以外のアプリケーションは配置できません。CFBundleIdentifier: $bundle_identifier"
  bundle_executable=$(extract_plist_value "CFBundleExecutable" "$info_path")
  [[ "$bundle_executable" == "$voicevox_executable_name" ]] || die "VOICEVOX以外のアプリケーションは配置できません。CFBundleExecutable: $bundle_executable"
  executable_path="$app_path/Contents/MacOS/$bundle_executable"
  assert_regular_file "$executable_path" "アプリケーションの実行ファイル"
  [[ -x "$executable_path" ]] || die "アプリケーションの実行ファイルに実行権限がありません。パス: $executable_path"
}

validate_application_source() {
  local app_path=$1
  local embedded_engine_path

  validate_application_identity "$app_path"
  embedded_engine_path="$app_path/Contents/Resources/vv-engine"
  if [[ -e "$embedded_engine_path" || -L "$embedded_engine_path" ]]; then
    die "app-sourceにアプリ内エンジンを指定できません。エンジンは.appの外へ配置してください。"
  fi
}

write_receipt() {
  local path=$1
  local app_path=$2
  local receipt_scope=$3
  local state=$4
  local engine_path=$5
  local engine_uuid=$6
  local engine_version=$7
  local runtime_target=$8

  case "$state" in
    preparing|ready)
      ;;
    *)
      die "配置情報のstateが不正です。値: $state"
      ;;
  esac
  validate_runtime_target "$runtime_target"
  validate_uuid "$engine_uuid" "配置情報のengine"
  assert_no_control_characters "$engine_version"

  receipt_temp_path=$(mktemp "${path}.tmp.XXXXXX")
  if ! jq -n \
    --arg app_path "$app_path" \
    --arg receipt_scope "$receipt_scope" \
    --arg state "$state" \
    --arg engine_path "$engine_path" \
    --arg engine_uuid "$engine_uuid" \
    --arg engine_version "$engine_version" \
    --arg runtime_target "$runtime_target" \
    '{schemaVersion: 1, appPath: $app_path, scope: $receipt_scope, state: $state, engine: {path: $engine_path, uuid: $engine_uuid, version: $engine_version, target: $runtime_target}}' \
    > "$receipt_temp_path"; then
    die "配置情報を生成できません。パス: $path"
  fi

  if [[ "$receipt_scope" == "machine" ]]; then
    chmod 644 "$receipt_temp_path"
  else
    chmod 600 "$receipt_temp_path"
  fi
  mv -f "$receipt_temp_path" "$path"
  receipt_temp_path=""
  if [[ "$receipt_scope" == "machine" ]]; then
    assert_machine_file_secure "$path"
  fi
}

read_receipt() {
  local path=$1

  assert_regular_file "$path" "配置情報"
  if ! jq -e -s '
    length == 1 and
    (.[0] | type == "object" and
      .schemaVersion == 1 and
      (.engine | type == "object"))
  ' "$path" >/dev/null; then
    die "配置情報を読み込めません。パス: $path"
  fi
  receipt_app_path=$(extract_json_string ".appPath" "$path")
  receipt_scope=$(extract_json_string ".scope" "$path")
  receipt_state=$(extract_json_string ".state" "$path")
  receipt_engine_path=$(extract_json_string ".engine.path" "$path")
  receipt_engine_uuid=$(extract_json_string ".engine.uuid" "$path")
  receipt_engine_version=$(extract_json_string ".engine.version" "$path")
  receipt_runtime_target=$(extract_json_string ".engine.target" "$path")

  assert_absolute_path "$receipt_app_path" "配置情報のappPath"
  assert_absolute_path "$receipt_engine_path" "配置情報のengine.path"
  [[ "$receipt_scope" == "user" || "$receipt_scope" == "machine" ]] || die "配置情報のscopeが不正です。パス: $path"
  [[ "$receipt_state" == "preparing" || "$receipt_state" == "ready" ]] || die "配置情報のstateが不正です。パス: $path"
  validate_uuid "$receipt_engine_uuid" "配置情報のengine"
  validate_runtime_target "$receipt_runtime_target"
}

assert_receipt_identity() {
  local app_path=$1
  local engine_path=$2
  [[ "$receipt_app_path" == "$app_path" ]] || die "配置情報のappPathが一致しません。"
  [[ "$receipt_scope" == "$scope" ]] || die "配置情報のscopeが一致しません。"
  [[ "$receipt_engine_path" == "$engine_path" ]] || die "配置情報のengine.pathが一致しません。"
}

register_launch_services() {
  local app_path=$1
  [[ -x "$launch_services_register" ]] || die "Launch Services登録コマンドが見つかりません。"
  if ! "$launch_services_register" -f "$app_path"; then
    die "Launch Servicesへの登録に失敗しました。パス: $app_path"
  fi
}

install_deployment() {
  local app_source=$1
  local app_destination_input=$2
  local engine_source=$3
  local engine_destination_input=$4
  local runtime_target=$5
  local app_source_path
  local engine_source_path
  local app_path
  local engine_path
  local receipt_path
  local app_parent
  local engine_parent
  local app_stage
  local engine_stage
  local operation_id
  local source_uuid
  local source_version
  local staged_uuid
  local staged_version
  local existing_receipt=0
  local existing_engine=0
  local existing_app=0

  validate_runtime_target "$runtime_target"
  app_source_path=$(canonical_existing_directory "$app_source" "app-source")
  [[ "$app_source_path" == *.app ]] || die "app-sourceには.appディレクトリを指定してください。"
  validate_application_source "$app_source_path"
  engine_source_path=$(canonical_existing_directory "$engine_source" "engine-source")
  validate_engine_directory "$engine_source_path"
  source_uuid=$manifest_uuid
  source_version=$manifest_version

  app_path=$(canonical_destination_path "$app_destination_input" "app-path")
  engine_path=$(canonical_destination_path "$engine_destination_input" "engine-path")
  [[ "$app_path" == *.app ]] || die "app-pathには.appディレクトリを指定してください。"
  assert_destination_scope "$app_path" "app-path"
  assert_destination_scope "$engine_path" "engine-path"
  paths_overlap "$app_path" "$engine_path" && die "app-pathとengine-pathを重ねることはできません。"
  paths_overlap "$app_source_path" "$app_path" && die "app-sourceとapp-pathを重ねることはできません。"
  paths_overlap "$app_source_path" "$engine_path" && die "app-sourceとengine-pathを重ねることはできません。"
  paths_overlap "$engine_source_path" "$engine_path" && die "engine-sourceとengine-pathを重ねることはできません。"
  ensure_destination_parent "$app_path" "app-path"
  ensure_destination_parent "$engine_path" "engine-path"
  app_path=$(canonical_destination_path "$app_path" "app-path")
  engine_path=$(canonical_destination_path "$engine_path" "engine-path")

  app_parent=$(dirname "$app_path")
  engine_parent=$(dirname "$engine_path")
  receipt_path="${app_path}${receipt_suffix}"
  assert_no_deployment_artifacts "$app_parent" "$(basename "$app_path")"
  assert_no_deployment_artifacts "$engine_parent" "$(basename "$engine_path")"
  if [[ -e "$app_path" || -L "$app_path" ]]; then
    assert_directory "$app_path" "既存のapp-path"
    validate_application_identity "$app_path"
    existing_app=1
  fi
  if [[ -e "$receipt_path" || -L "$receipt_path" ]]; then
    assert_regular_file "$receipt_path" "既存の配置情報"
    if [[ "$scope" == "machine" ]]; then
      assert_machine_file_secure "$receipt_path"
    fi
    read_receipt "$receipt_path"
    assert_receipt_identity "$app_path" "$engine_path"
    existing_receipt=1
  fi
  if [[ -e "$engine_path" || -L "$engine_path" ]]; then
    assert_directory "$engine_path" "既存のengine-path"
    existing_engine=1
  fi
  if [[ "$existing_receipt" -eq 0 && "$existing_engine" -eq 1 ]]; then
    die "既存のengine-pathは管理対象ではありません。"
  fi
  if [[ "$existing_receipt" -eq 1 ]]; then
    if [[ "$receipt_state" == "preparing" ]]; then
      [[ "$receipt_engine_uuid" == "$source_uuid" && "$receipt_engine_version" == "$source_version" && "$receipt_runtime_target" == "$runtime_target" ]] || die "準備中の配置情報と入力エンジンが一致しません。"
    fi
    if [[ "$existing_engine" -eq 1 ]]; then
      validate_engine_directory "$engine_path"
      [[ "$manifest_uuid" == "$receipt_engine_uuid" ]] || die "既存の管理エンジンUUIDが配置情報と一致しません。"
      if [[ "$receipt_state" == "ready" ]]; then
        [[ "$manifest_version" == "$receipt_engine_version" ]] || die "既存の管理エンジンのバージョンが配置情報と一致しません。"
      fi
    elif [[ "$receipt_state" == "ready" ]]; then
      die "配置情報が示す管理エンジンが見つかりません。"
    fi
  fi

  app_stage_root=$(mktemp -d "$app_parent/.$(basename "$app_path").voicevox-deployment-XXXXXX")
  engine_stage_root=$(mktemp -d "$engine_parent/.$(basename "$engine_path").voicevox-deployment-XXXXXX")
  operation_id=$(basename "$app_stage_root")
  app_stage="$app_stage_root/$(basename "$app_path")"
  engine_stage="$engine_stage_root/$(basename "$engine_path")"
  if ! ditto "$engine_source_path" "$engine_stage"; then
    die "engine-sourceをstageへコピーできません。"
  fi
  if [[ "$scope" == "machine" ]]; then
    normalize_machine_stage "$engine_stage"
  fi
  validate_engine_directory "$engine_stage"
  staged_uuid=$manifest_uuid
  staged_version=$manifest_version
  [[ "$staged_uuid" == "$source_uuid" && "$staged_version" == "$source_version" ]] || die "stageしたエンジンmanifestが入力と一致しません。"

  if ! ditto "$app_source_path" "$app_stage"; then
    die "app-sourceをstageへコピーできません。"
  fi
  if [[ "$scope" == "machine" ]]; then
    normalize_machine_stage "$app_stage"
  fi
  validate_application_source "$app_stage"
  if [[ "$scope" == "machine" ]]; then
    assert_machine_tree_secure "$app_stage"
    assert_machine_tree_secure "$engine_stage"
  fi
  write_receipt "$receipt_path" "$app_path" "$scope" "preparing" "$engine_path" "$source_uuid" "$source_version" "$runtime_target"

  app_backup_path="$app_path.voicevox-deployment-backup-$operation_id"
  engine_backup_path="$engine_path.voicevox-engine-backup-$operation_id"
  [[ ! -e "$app_backup_path" && ! -L "$app_backup_path" ]] || die "appのbackup先が既に存在します。パス: $app_backup_path"
  [[ ! -e "$engine_backup_path" && ! -L "$engine_backup_path" ]] || die "engineのbackup先が既に存在します。パス: $engine_backup_path"
  if [[ "$existing_app" -eq 1 ]]; then
    mv "$app_path" "$app_backup_path"
  fi
  mv "$app_stage" "$app_path"
  if [[ "$existing_engine" -eq 1 ]]; then
    mv "$engine_path" "$engine_backup_path"
  fi
  mv "$engine_stage" "$engine_path"
  validate_application_source "$app_path"
  validate_engine_directory "$engine_path"
  [[ "$manifest_uuid" == "$source_uuid" && "$manifest_version" == "$source_version" ]] || die "配置したエンジンmanifestが入力と一致しません。"
  if [[ "$scope" == "machine" ]]; then
    assert_machine_tree_secure "$app_path"
    assert_machine_tree_secure "$engine_path"
  fi
  register_launch_services "$app_path"
  write_receipt "$receipt_path" "$app_path" "$scope" "ready" "$engine_path" "$source_uuid" "$source_version" "$runtime_target"
  if [[ -n "$app_backup_path" && -e "$app_backup_path" ]]; then
    rm -rf "$app_backup_path"
    app_backup_path=""
  fi
  if [[ -n "$engine_backup_path" && -e "$engine_backup_path" ]]; then
    rm -rf "$engine_backup_path"
    engine_backup_path=""
  fi
  printf 'VOICEVOXの配置が完了しました。app-path: %s、engine-path: %s\n' "$app_path" "$engine_path"
}

remove_engine() {
  local app_destination_input=$1
  local engine_destination_input=$2
  local app_path
  local engine_path
  local receipt_path

  app_path=$(canonical_destination_path "$app_destination_input" "app-path")
  engine_path=$(canonical_destination_path "$engine_destination_input" "engine-path")
  assert_destination_scope "$app_path" "app-path"
  assert_destination_scope "$engine_path" "engine-path"
  paths_overlap "$app_path" "$engine_path" && die "app-pathとengine-pathを重ねることはできません。"
  assert_destination_parent_secure "$app_path"
  assert_destination_parent_secure "$engine_path"
  receipt_path="${app_path}${receipt_suffix}"
  assert_regular_file "$receipt_path" "配置情報"
  if [[ "$scope" == "machine" ]]; then
    assert_machine_file_secure "$receipt_path"
  fi
  read_receipt "$receipt_path"
  assert_receipt_identity "$app_path" "$engine_path"
  assert_directory "$engine_path" "管理エンジン"
  if [[ "$scope" == "machine" ]]; then
    assert_machine_tree_secure "$engine_path"
  fi
  validate_engine_directory "$engine_path"
  [[ "$manifest_uuid" == "$receipt_engine_uuid" ]] || die "管理エンジンのUUIDが配置情報と一致しません。"
  if [[ "$receipt_state" == "ready" ]]; then
    [[ "$manifest_version" == "$receipt_engine_version" ]] || die "管理エンジンのバージョンが配置情報と一致しません。"
  fi
  assert_no_deployment_artifacts "$(dirname "$engine_path")" "$(basename "$engine_path")"
  rm -rf "$engine_path"
  [[ ! -e "$engine_path" && ! -L "$engine_path" ]] || die "管理エンジンを削除できませんでした。パス: $engine_path"
  rm -f "$receipt_path"
  [[ ! -e "$receipt_path" && ! -L "$receipt_path" ]] || die "配置情報を削除できませんでした。パス: $receipt_path"
  printf 'VOICEVOXの管理エンジンを削除しました。engine-path: %s\n' "$engine_path"
}

parse_arguments() {
  action=${1-}
  [[ "$action" == "install" || "$action" == "remove-engine" ]] || usage
  shift

  scope=""
  app_source=""
  app_destination=""
  engine_source=""
  engine_destination=""
  runtime_target=""
  has_scope=0
  has_app_source=0
  has_app_destination=0
  has_engine_source=0
  has_engine_destination=0
  has_runtime_target=0

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --scope)
        [[ "$has_scope" -eq 0 && "$#" -ge 2 ]] || usage
        scope=$2
        has_scope=1
        shift 2
        ;;
      --app-source)
        [[ "$has_app_source" -eq 0 && "$#" -ge 2 ]] || usage
        app_source=$2
        has_app_source=1
        shift 2
        ;;
      --app-path)
        [[ "$has_app_destination" -eq 0 && "$#" -ge 2 ]] || usage
        app_destination=$2
        has_app_destination=1
        shift 2
        ;;
      --engine-source)
        [[ "$has_engine_source" -eq 0 && "$#" -ge 2 ]] || usage
        engine_source=$2
        has_engine_source=1
        shift 2
        ;;
      --engine-path)
        [[ "$has_engine_destination" -eq 0 && "$#" -ge 2 ]] || usage
        engine_destination=$2
        has_engine_destination=1
        shift 2
        ;;
      --runtime-target)
        [[ "$has_runtime_target" -eq 0 && "$#" -ge 2 ]] || usage
        runtime_target=$2
        has_runtime_target=1
        shift 2
        ;;
      *)
        usage
        ;;
    esac
  done
}

main() {
  local current_uid

  parse_arguments "$@"
  [[ "$(uname -s)" == "Darwin" ]] || die "macOSで実行してください。"
  for command in awk chmod chown ditto find jq ls mktemp plutil stat; do
    command -v "$command" >/dev/null 2>&1 || die "必要なコマンドが見つかりません。コマンド: $command"
  done
  [[ -x "$launch_services_register" ]] || die "Launch Services登録コマンドが見つかりません。"
  current_uid=$(id -u)
  case "$scope" in
    user)
      [[ "$current_uid" != "0" ]] || die "Userスコープはroot以外の対象ユーザーとして実行してください。"
      ;;
    machine)
      [[ "$current_uid" == "0" ]] || die "Machineスコープにはroot権限が必要です。"
      ;;
    *)
      die "scopeにはuserまたはmachineを指定してください。"
      ;;
  esac
  user_home=$(canonical_existing_directory "$HOME" "HOME")

  if [[ "$action" == "install" ]]; then
    [[ "$has_scope" -eq 1 && "$has_app_source" -eq 1 && "$has_app_destination" -eq 1 && "$has_engine_source" -eq 1 && "$has_engine_destination" -eq 1 && "$has_runtime_target" -eq 1 ]] || usage
    install_deployment "$app_source" "$app_destination" "$engine_source" "$engine_destination" "$runtime_target"
  else
    [[ "$has_scope" -eq 1 && "$has_app_destination" -eq 1 && "$has_engine_destination" -eq 1 && "$has_app_source" -eq 0 && "$has_engine_source" -eq 0 && "$has_runtime_target" -eq 0 ]] || usage
    remove_engine "$app_destination" "$engine_destination"
  fi
}

main "$@"
