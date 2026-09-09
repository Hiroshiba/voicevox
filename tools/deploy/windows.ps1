[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Install", "RemoveEngine")]
  [string]$Action,
  [Parameter(Mandatory = $true)]
  [ValidateSet("User", "Machine")]
  [string]$Scope,
  [string]$SetupPath,
  [string]$PackagePath,
  [string]$EngineSourcePath,
  [string]$AppPath,
  [string]$EnginePath,
  [ValidateSet("windows-x64-cpu", "windows-x64-directml", "windows-x64-cuda")]
  [string]$RuntimeTarget
)

Set-StrictMode -Version 2.0

$voicevoxAppRegistryGuid = "92713bbc-5c5b-5df6-b6d1-5b09e302bf58"
$windowsRuntimeTargets = @(
  "windows-x64-cpu",
  "windows-x64-directml",
  "windows-x64-cuda"
)
$voicevoxProgIds = @(
  "VOICEVOX Project file",
  "VOICEVOX Plugin package",
  "VOICEVOX Plugin package (part)"
)
$machineTrustedSids = @(
  "S-1-5-18",
  "S-1-5-32-544",
  "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"
)

function Get-AbsolutePath {
  param(
    [string]$Value,
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Nameを指定してください。"
  }
  if ($Value -match '["\r\n]') {
    throw "$Nameに使用できない文字が含まれています。"
  }
  if (-not [System.IO.Path]::IsPathRooted($Value)) {
    throw "$Nameには絶対パスを指定してください。"
  }
  return [System.IO.Path]::GetFullPath($Value)
}

function Get-AbsoluteDirectoryPath {
  param(
    [string]$Value,
    [string]$Name
  )

  $path = Get-AbsolutePath $Value $Name
  $root = [System.IO.Path]::GetPathRoot($path)
  $trimmedPath = $path.TrimEnd([char[]]@("\", "/"))
  if ($trimmedPath -ieq $root.TrimEnd([char[]]@("\", "/"))) {
    throw "$Nameにドライブまたは共有のルートは指定できません。"
  }
  return $trimmedPath
}

function Assert-DeploymentPathIsNarrow {
  param(
    [string]$Path
  )

  $exactlyRestrictedPaths = @(
    [Environment]::GetFolderPath("Windows"),
    [Environment]::GetFolderPath("ProgramFiles"),
    [Environment]::GetFolderPath("ProgramFilesX86"),
    [Environment]::GetFolderPath("UserProfile"),
    [Environment]::GetFolderPath("CommonApplicationData"),
    (Get-Location).Path,
    $PSScriptRoot,
    (Split-Path -Parent $PSScriptRoot),
    (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
  )
  foreach ($restrictedPath in $exactlyRestrictedPaths) {
    if (
      (-not [string]::IsNullOrWhiteSpace($restrictedPath)) -and
      ($Path -ieq ([System.IO.Path]::GetFullPath($restrictedPath)).TrimEnd([char[]]@("\", "/")))
    ) {
      throw "配置先に広い共有ディレクトリを指定できません。パス: $Path"
    }
  }
}

function Test-PathWithin {
  param(
    [string]$BasePath,
    [string]$CandidatePath
  )

  if ($CandidatePath -ieq $BasePath) {
    return $true
  }
  return $CandidatePath.StartsWith(
    $BasePath + "\",
    [System.StringComparison]::OrdinalIgnoreCase
  )
}

function Get-PathItemOrNull {
  param(
    [string]$Path
  )

  try {
    return Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  } catch [System.Management.Automation.ItemNotFoundException] {
    return $null
  }
}

function Assert-SafeDirectoryPath {
  param(
    [string]$Path
  )

  $current = New-Object System.IO.DirectoryInfo($Path)
  while ($current -ne $null) {
    $item = Get-PathItemOrNull $current.FullName
    if ($item -ne $null) {
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "再解析点を含むパスは使用できません。パス: $($current.FullName)"
      }
    }
    $current = $current.Parent
  }
}

function Assert-SafeDirectoryTree {
  param(
    [string]$Path
  )

  Assert-SafeDirectoryPath $Path
  foreach ($item in Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction Stop) {
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "再解析点を含むエンジンは使用できません。パス: $($item.FullName)"
    }
  }
}

function Get-ExistingFilePath {
  param(
    [string]$Path,
    [string]$Name
  )

  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($item.PSIsContainer) {
    throw "$Nameが通常ファイルではありません。パス: $Path"
  }
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Nameに再解析点は指定できません。パス: $Path"
  }
  return $item.FullName
}

function Get-ExistingDirectoryPath {
  param(
    [string]$Path,
    [string]$Name
  )

  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (-not $item.PSIsContainer) {
    throw "$Nameがディレクトリではありません。パス: $Path"
  }
  Assert-SafeDirectoryPath $item.FullName
  return $item.FullName.TrimEnd([char[]]@("\", "/"))
}

function Ensure-DirectoryPath {
  param(
    [string]$Path,
    [string]$Name
  )

  Assert-SafeDirectoryPath $Path
  $pathItem = Get-PathItemOrNull $Path
  if ($pathItem -eq $null) {
    [System.IO.Directory]::CreateDirectory($Path) | Out-Null
  }
  return Get-ExistingDirectoryPath $Path $Name
}

function Get-RequiredStringProperty {
  param(
    [object]$Object,
    [string]$PropertyName,
    [string]$Description
  )

  if ($Object -eq $null) {
    throw "$Descriptionがありません。項目: $PropertyName"
  }
  $property = $Object.PSObject.Properties[$PropertyName]
  if (
    ($property -eq $null) -or
    ($property.Value -isnot [string]) -or
    [string]::IsNullOrWhiteSpace([string]$property.Value)
  ) {
    throw "$Descriptionの文字列が不正です。項目: $PropertyName"
  }
  return [string]$property.Value
}

function Read-EngineManifest {
  param(
    [string]$EngineDirectory
  )

  $manifestPath = Join-Path $EngineDirectory "engine_manifest.json"
  $manifestFile = Get-ExistingFilePath $manifestPath "エンジンmanifest"
  $manifest =
    Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 -ErrorAction Stop |
    ConvertFrom-Json -ErrorAction Stop
  if ($manifest -eq $null) {
    throw "エンジンmanifestが空です。ファイル: $manifestFile"
  }
  $uuid = Get-RequiredStringProperty $manifest "uuid" "エンジンmanifest"
  if ($uuid -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
    throw "エンジンmanifestのUUIDが不正です。ファイル: $manifestFile"
  }
  [void](Get-RequiredStringProperty $manifest "version" "エンジンmanifest")
  [void](Get-ExistingFilePath (Join-Path $EngineDirectory "run.exe") "エンジン実行ファイル")
  return $manifest
}

function Read-DeploymentReceipt {
  param(
    [string]$ReceiptPath
  )

  $receiptItem = Get-PathItemOrNull $ReceiptPath
  if ($receiptItem -eq $null) {
    return $null
  }
  $receiptFile = Get-ExistingFilePath $ReceiptPath "配置情報"
  $receipt =
    Get-Content -LiteralPath $receiptFile -Raw -Encoding UTF8 -ErrorAction Stop |
    ConvertFrom-Json -ErrorAction Stop
  if ($receipt -eq $null) {
    throw "配置情報が空です。ファイル: $receiptFile"
  }

  $schemaVersion = $receipt.PSObject.Properties["schemaVersion"]
  if (($schemaVersion -eq $null) -or ($schemaVersion.Value -ne 1)) {
    throw "配置情報のschemaVersionが不正です。ファイル: $receiptFile"
  }
  $appPath = Get-RequiredStringProperty $receipt "appPath" "配置情報"
  $scope = Get-RequiredStringProperty $receipt "scope" "配置情報"
  $state = Get-RequiredStringProperty $receipt "state" "配置情報"
  if (-not [System.IO.Path]::IsPathRooted($appPath)) {
    throw "配置情報のappPathが絶対パスではありません。ファイル: $receiptFile"
  }
  if (($scope -ne "user") -and ($scope -ne "machine")) {
    throw "配置情報のscopeが不正です。ファイル: $receiptFile"
  }
  if (($state -ne "preparing") -and ($state -ne "ready")) {
    throw "配置情報のstateが不正です。ファイル: $receiptFile"
  }

  $engine = $receipt.PSObject.Properties["engine"]
  if (($engine -eq $null) -or ($engine.Value -eq $null)) {
    throw "配置情報のengineがありません。ファイル: $receiptFile"
  }
  $enginePath = Get-RequiredStringProperty $engine.Value "path" "配置情報のengine"
  $uuid = Get-RequiredStringProperty $engine.Value "uuid" "配置情報のengine"
  if ($uuid -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
    throw "配置情報のengine.uuidが不正です。ファイル: $receiptFile"
  }
  [void](Get-RequiredStringProperty $engine.Value "version" "配置情報のengine")
  $target = Get-RequiredStringProperty $engine.Value "target" "配置情報のengine"
  if (-not [System.IO.Path]::IsPathRooted($enginePath)) {
    throw "配置情報のengine.pathが絶対パスではありません。ファイル: $receiptFile"
  }
  if ($windowsRuntimeTargets -notcontains $target) {
    throw "配置情報のengine.targetが不正です。ファイル: $receiptFile"
  }
  return $receipt
}

function Assert-ReceiptIdentity {
  param(
    [object]$Receipt,
    [string]$AppPath,
    [string]$Scope,
    [string]$EnginePath
  )

  if ($Receipt.appPath -ine $AppPath) {
    throw "配置情報のappPathが一致しません。"
  }
  if ($Receipt.scope -ine $Scope.ToLowerInvariant()) {
    throw "配置情報のscopeが一致しません。"
  }
  if ($Receipt.engine.path -ine $EnginePath) {
    throw "配置情報のengine.pathが一致しません。"
  }
}

function Assert-NoDeploymentArtifacts {
  param(
    [string]$EngineParentPath,
    [string]$EnginePath
  )

  $parentItem = Get-PathItemOrNull $EngineParentPath
  if ($parentItem -eq $null) {
    return
  }
  $engineName = Split-Path -Leaf $EnginePath
  foreach ($item in Get-ChildItem -LiteralPath $EngineParentPath -Force -ErrorAction Stop) {
    if (
      $item.Name.StartsWith(".$($engineName).voicevox-engine-staging-", [System.StringComparison]::OrdinalIgnoreCase) -or
      $item.Name.StartsWith("$($engineName).voicevox-engine-backup-", [System.StringComparison]::OrdinalIgnoreCase)
    ) {
      throw "前回の管理エンジン配置が未完了です。残ったstageまたはbackupを確認してください。"
    }
  }
}

function Resolve-EngineSourcePath {
  param(
    [string]$Path
  )

  $sourceDirectory = Get-ExistingDirectoryPath $Path "エンジン入力"
  if ((Get-PathItemOrNull (Join-Path $sourceDirectory "engine_manifest.json")) -eq $null) {
    throw "エンジンmanifestがエンジン入力にありません。展開済みengineまたは旧app内vv-engineを直接指定してください。パス: $Path"
  }
  Assert-SafeDirectoryTree $sourceDirectory
  return $sourceDirectory
}

function Copy-DirectoryContents {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )

  foreach ($item in Get-ChildItem -LiteralPath $SourcePath -Force -ErrorAction Stop) {
    Copy-Item -LiteralPath $item.FullName -Destination $DestinationPath -Recurse -Force -ErrorAction Stop
  }
}

function Get-RegistryString {
  param(
    [string]$RegistryPath,
    [string]$ValueName
  )

  $registryKey = Get-Item -LiteralPath $RegistryPath -ErrorAction Stop
  $value = $registryKey.GetValue($ValueName)
  if (($value -isnot [string]) -or [string]::IsNullOrWhiteSpace([string]$value)) {
    throw "レジストリ値が不正です。パス: $RegistryPath"
  }
  return [string]$value
}

function Get-InstalledAppPath {
  param(
    [string]$RegistryRoot
  )

  $uninstallPath = Join-Path $RegistryRoot "Software\Microsoft\Windows\CurrentVersion\Uninstall\$voicevoxAppRegistryGuid"
  return Get-AbsoluteDirectoryPath (Get-RegistryString $uninstallPath "InstallLocation") "インストール先"
}

function Get-QuotedCommandExecutablePath {
  param(
    [string]$Command
  )

  $trimmedCommand = $Command.Trim()
  if (-not $trimmedCommand.StartsWith('"')) {
    throw "ファイル関連付けのコマンドが引用符で始まっていません。"
  }
  $closingQuote = $trimmedCommand.IndexOf('"', 1)
  if ($closingQuote -le 1) {
    throw "ファイル関連付けのコマンドが不正です。"
  }
  return $trimmedCommand.Substring(1, $closingQuote - 1)
}

function Assert-MachineAcl {
  param(
    [string]$Path,
    [bool]$Target
  )

  $dangerousRights = if ($Target) {
    [System.Security.AccessControl.FileSystemRights]::Write -bor
      [System.Security.AccessControl.FileSystemRights]::Delete -bor
      [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
      [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
      [System.Security.AccessControl.FileSystemRights]::TakeOwnership
  } else {
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
      [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
      [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
      [System.Security.AccessControl.FileSystemRights]::TakeOwnership
  }
  $current = New-Object System.IO.DirectoryInfo($Path)
  while ($current -ne $null) {
    $item = Get-PathItemOrNull $current.FullName
    if ($item -ne $null) {
      $acl = Get-Acl -LiteralPath $current.FullName -ErrorAction Stop
      try {
        $ownerReference = $acl.Owner
        if ($ownerReference -is [string]) {
          $ownerReference = New-Object System.Security.Principal.NTAccount([string]$ownerReference)
        }
        $ownerSid = $ownerReference.Translate(
          [System.Security.Principal.SecurityIdentifier]
        ).Value
      } catch {
        throw [System.InvalidOperationException]::new(
          "Machineスコープの所有者を確認できません。パス: $($current.FullName)",
          $_.Exception
        )
      }
      if ($machineTrustedSids -notcontains $ownerSid) {
        throw "信頼されていない主体がMachineスコープの所有者です。パス: $($current.FullName)"
      }
      foreach ($rule in $acl.Access) {
        if (
          (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0) -and
          ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) -and
          (($rule.FileSystemRights -band $dangerousRights) -ne 0)
        ) {
          try {
            $sid = $rule.IdentityReference.Translate(
              [System.Security.Principal.SecurityIdentifier]
            ).Value
          } catch {
            throw [System.InvalidOperationException]::new(
              "MachineスコープのACL主体を確認できません。パス: $($current.FullName)",
              $_.Exception
            )
          }
          if ($machineTrustedSids -notcontains $sid) {
            if ($Target) {
              throw "Machineスコープの管理対象へ信頼されていない主体が書き込めます。パス: $($current.FullName)"
            }
            throw "信頼されていない主体がMachineスコープの配置先を置換できます。パス: $($current.FullName)"
          }
        }
      }
    }
    if ($Target) {
      break
    }
    $current = $current.Parent
  }
}

function New-MachineSecurity {
  param(
    [bool]$Directory
  )

  $security = if ($Directory) {
    New-Object System.Security.AccessControl.DirectorySecurity
  } else {
    New-Object System.Security.AccessControl.FileSecurity
  }
  $security.SetAccessRuleProtection($true, $false)
  $inheritanceFlags = if ($Directory) {
    [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  $admins = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")
  $system = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")
  $users = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-545")
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  $none = [System.Security.AccessControl.PropagationFlags]::None
  $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($admins, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritanceFlags, $none, $allow)))
  $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritanceFlags, $none, $allow)))
  $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($users, [System.Security.AccessControl.FileSystemRights]::ReadAndExecute, $inheritanceFlags, $none, $allow)))
  $security.SetOwner($admins)
  return $security
}

function Protect-MachinePath {
  param(
    [string]$Path,
    [bool]$Directory
  )

  if ($Directory) {
    [System.IO.Directory]::SetAccessControl($Path, (New-MachineSecurity $true))
    foreach ($item in Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction Stop) {
      if ($item.PSIsContainer) {
        [System.IO.Directory]::SetAccessControl($item.FullName, (New-MachineSecurity $true))
      } else {
        [System.IO.File]::SetAccessControl($item.FullName, (New-MachineSecurity $false))
      }
    }
  } else {
    [System.IO.File]::SetAccessControl($Path, (New-MachineSecurity $false))
  }
}

function Assert-FileAssociations {
  param(
    [string]$RegistryRoot,
    [string]$ExecutablePath
  )

  $classesRoot = Join-Path $RegistryRoot "Software\Classes"
  foreach ($className in $voicevoxProgIds) {
    $commandKey = Join-Path $classesRoot "$className\shell\open\command"
    $commandPath = Get-QuotedCommandExecutablePath (Get-RegistryString $commandKey "")
    $actualPath = Get-AbsolutePath $commandPath "ファイル関連付けの実行ファイル"
    if ($actualPath -ine $ExecutablePath) {
      throw "ファイル関連付けの実行ファイルが一致しません。ProgID: $className"
    }
  }
}

function Write-DeploymentReceipt {
  param(
    [string]$ReceiptPath,
    [string]$AppPath,
    [string]$Scope,
    [string]$State,
    [string]$EnginePath,
    [string]$EngineUuid,
    [string]$EngineVersion,
    [string]$RuntimeTarget
  )

  $receipt = [ordered]@{
    schemaVersion = 1
    appPath = $AppPath
    scope = $Scope.ToLowerInvariant()
    state = $State
    engine = [ordered]@{
      path = $EnginePath
      uuid = $EngineUuid
      version = $EngineVersion
      target = $RuntimeTarget
    }
  }
  $temporaryReceiptPath = "$ReceiptPath.$([Guid]::NewGuid().ToString('N')).tmp"
  $stream = $null
  try {
    $json = $receipt | ConvertTo-Json -Depth 4
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    if ($Scope -eq "Machine") {
      $stream = New-Object System.IO.FileStream(
        $temporaryReceiptPath,
        [System.IO.FileMode]::CreateNew,
        [System.Security.AccessControl.FileSystemRights]::Write,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::None,
        (New-MachineSecurity $false)
      )
    } else {
      $stream = New-Object System.IO.FileStream(
        $temporaryReceiptPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
      )
    }
    $bytes = $utf8.GetBytes($json)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Dispose()
    $stream = $null
    Move-Item -LiteralPath $temporaryReceiptPath -Destination $ReceiptPath -Force -ErrorAction Stop
    $temporaryReceiptPath = $null
  } finally {
    if ($stream -ne $null) {
      $stream.Dispose()
    }
    if (($temporaryReceiptPath -ne $null) -and (Test-Path -LiteralPath $temporaryReceiptPath)) {
      Remove-Item -LiteralPath $temporaryReceiptPath -Force -ErrorAction Stop
    }
  }
}

function Assert-Permissions {
  param(
    [string]$Scope
  )

  if ([IntPtr]::Size -ne 8) {
    throw "64ビット版のPowerShellで実行してください。"
  }
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $isSystem = $identity.User.Value -eq "S-1-5-18"
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  $isAdministrator = $principal.IsInRole(
    [System.Security.Principal.WindowsBuiltInRole]::Administrator
  )
  if (($Scope -eq "Machine") -and (-not $isAdministrator)) {
    throw "Machineスコープには管理者権限が必要です。"
  }
  if (($Scope -eq "User") -and $isSystem) {
    throw "Userスコープは対象ユーザーのコンテキストで実行してください。"
  }
}

function Invoke-RemoveEngine {
  param(
    [string]$Scope,
    [string]$AppPath,
    [string]$EnginePath,
    [string]$RuntimeTarget
  )

  $appPath = Get-AbsoluteDirectoryPath $AppPath "AppPath"
  $enginePath = Get-AbsoluteDirectoryPath $EnginePath "EnginePath"
  Assert-DeploymentPathIsNarrow $appPath
  Assert-DeploymentPathIsNarrow $enginePath
  if (
    (Test-PathWithin $appPath $enginePath) -or
    (Test-PathWithin $enginePath $appPath)
  ) {
    throw "AppPathとEnginePathを重ねることはできません。"
  }
  Assert-SafeDirectoryPath $appPath
  $receiptPath = "$appPath.voicevox-deployment.json"
  $receipt = Read-DeploymentReceipt $receiptPath
  if ($receipt -eq $null) {
    throw "配置情報が見つかりません。ファイル: $receiptPath"
  }
  Assert-ReceiptIdentity $receipt $appPath $Scope $enginePath
  if (($receipt.state -ne "ready") -and ($receipt.state -ne "preparing")) {
    throw "配置情報のstateが不正です。ファイル: $receiptPath"
  }
  Assert-NoDeploymentArtifacts (Split-Path -Parent $enginePath) $enginePath
  if (($RuntimeTarget -ne $null) -and ($RuntimeTarget -ne "") -and ($receipt.engine.target -ne $RuntimeTarget)) {
    throw "配置情報のengine.targetが一致しません。"
  }
  if ($Scope -eq "Machine") {
    Assert-MachineAcl $appPath $true
    Assert-MachineAcl (Split-Path -Parent $appPath) $false
    Assert-MachineAcl (Split-Path -Parent $enginePath) $false
    Assert-MachineAcl $enginePath $true
    Assert-MachineAcl $receiptPath $true
  }

  $existingEnginePath = Get-ExistingDirectoryPath $enginePath "管理エンジン"
  Assert-SafeDirectoryTree $existingEnginePath
  $manifest = Read-EngineManifest $existingEnginePath
  if ($manifest.uuid -ne $receipt.engine.uuid) {
    throw "管理エンジンのUUIDが配置情報と一致しません。"
  }
  if (($receipt.state -eq "ready") -and ($manifest.version -ne $receipt.engine.version)) {
    throw "管理エンジンのバージョンが配置情報と一致しません。"
  }
  Remove-Item -LiteralPath $existingEnginePath -Recurse -Force -ErrorAction Stop
  if ((Get-PathItemOrNull $existingEnginePath) -ne $null) {
    throw "管理エンジンを削除できませんでした。パス: $existingEnginePath"
  }
  Remove-Item -LiteralPath $receiptPath -Force -ErrorAction Stop
}

function Invoke-Install {
  param(
    [string]$Scope,
    [string]$SetupPath,
    [string]$PackagePath,
    [string]$EngineSourcePath,
    [string]$AppPath,
    [string]$EnginePath,
    [string]$RuntimeTarget
  )

  $setupPath = Get-AbsolutePath $SetupPath "SetupPath"
  $packagePath = Get-AbsolutePath $PackagePath "PackagePath"
  $engineSourceInputPath = Get-AbsolutePath $EngineSourcePath "EngineSourcePath"
  $appPath = Get-AbsoluteDirectoryPath $AppPath "AppPath"
  $enginePath = Get-AbsoluteDirectoryPath $EnginePath "EnginePath"
  Assert-DeploymentPathIsNarrow $appPath
  Assert-DeploymentPathIsNarrow $enginePath
  if ([string]::IsNullOrWhiteSpace($RuntimeTarget) -or ($windowsRuntimeTargets -notcontains $RuntimeTarget)) {
    throw "RuntimeTargetにはWindowsの対応ターゲットを指定してください。"
  }
  if (
    (Test-PathWithin $appPath $enginePath) -or
    (Test-PathWithin $enginePath $appPath)
  ) {
    throw "AppPathとEnginePathを重ねることはできません。"
  }

  $setupPath = Get-ExistingFilePath $setupPath "Setup"
  $packagePath = Get-ExistingFilePath $packagePath "NSISパッケージ"
  if (-not $setupPath.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "SetupPathにはexeを指定してください。"
  }
  if (-not $packagePath.EndsWith(".nsis.7z", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "PackagePathには単一のnsis.7zを指定してください。"
  }
  $engineSourcePath = Resolve-EngineSourcePath $engineSourceInputPath
  if (
    (Test-PathWithin $engineSourcePath $enginePath) -or
    (Test-PathWithin $enginePath $engineSourcePath)
  ) {
    throw "EngineSourcePathとEnginePathを重ねることはできません。"
  }
  if ((Test-PathWithin $appPath $setupPath) -or (Test-PathWithin $enginePath $setupPath)) {
    throw "SetupPathが配置先と重なっています。"
  }
  if ((Test-PathWithin $appPath $packagePath) -or (Test-PathWithin $enginePath $packagePath)) {
    throw "PackagePathが配置先と重なっています。"
  }
  $sourceManifest = Read-EngineManifest $engineSourcePath
  $engineUuid = Get-RequiredStringProperty $sourceManifest "uuid" "エンジンmanifest"
  $engineVersion = Get-RequiredStringProperty $sourceManifest "version" "エンジンmanifest"

  $registryRoot = if ($Scope -eq "User") { "HKCU:" } else { "HKLM:" }
  $receiptPath = "$appPath.voicevox-deployment.json"
  $engineParentPath = Split-Path -Parent $enginePath
  $existingAppItem = Get-PathItemOrNull $appPath
  Assert-NoDeploymentArtifacts $engineParentPath $enginePath
  $existingEngineItem = Get-PathItemOrNull $enginePath
  $existingReceipt = Read-DeploymentReceipt $receiptPath
  if ($existingReceipt -ne $null) {
    Assert-ReceiptIdentity $existingReceipt $appPath $Scope $enginePath
    if (($existingReceipt.state -ne "ready") -and ($existingReceipt.state -ne "preparing")) {
      throw "配置情報のstateが不正です。ファイル: $receiptPath"
    }
    if ($existingReceipt.state -eq "preparing") {
      if (($existingReceipt.engine.uuid -ne $engineUuid) -or ($existingReceipt.engine.version -ne $engineVersion) -or ($existingReceipt.engine.target -ne $RuntimeTarget)) {
        throw "準備中の配置情報と入力エンジンが一致しません。"
      }
    }
    if ($existingEngineItem -ne $null) {
      $existingManagedEnginePath = Get-ExistingDirectoryPath $enginePath "管理エンジン"
      Assert-SafeDirectoryTree $existingManagedEnginePath
      $existingManagedManifest = Read-EngineManifest $existingManagedEnginePath
      if ($existingManagedManifest.uuid -ne $existingReceipt.engine.uuid) {
        throw "既存の管理エンジンUUIDが配置情報と一致しません。"
      }
      if (($existingReceipt.state -eq "ready") -and ($existingManagedManifest.version -ne $existingReceipt.engine.version)) {
        throw "既存の管理エンジンのバージョンが配置情報と一致しません。"
      }
    } elseif ($existingReceipt.state -eq "ready") {
      throw "配置情報が示す管理エンジンが見つかりません。"
    }
  } elseif ($existingEngineItem -ne $null) {
    throw "既存のEnginePathは管理対象ではありません。"
  }
  if ($Scope -eq "Machine") {
    if ($existingAppItem -ne $null) {
      Assert-MachineAcl $appPath $true
    }
    Assert-MachineAcl (Split-Path -Parent $appPath) $false
    Assert-MachineAcl $engineParentPath $false
    if ($existingEngineItem -ne $null) {
      Assert-MachineAcl $enginePath $true
    }
    if ($existingReceipt -ne $null) {
      Assert-MachineAcl $receiptPath $true
    }
  }

  $temporaryDirectory = $null
  $engineStagePath = $null
  $engineBackupPath = $null
  try {
    $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "voicevox-deployment-$([Guid]::NewGuid().ToString('N'))"
    if ((Get-PathItemOrNull $temporaryDirectory) -ne $null) {
      throw "一時ディレクトリが既に存在します。パス: $temporaryDirectory"
    }
    [System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
    $setupCopyPath = Join-Path $temporaryDirectory (Split-Path -Leaf $setupPath)
    $packageCopyPath = Join-Path $temporaryDirectory (Split-Path -Leaf $packagePath)
    Copy-Item -LiteralPath $setupPath -Destination $setupCopyPath -Force -ErrorAction Stop
    Copy-Item -LiteralPath $packagePath -Destination $packageCopyPath -Force -ErrorAction Stop

    Ensure-DirectoryPath $engineParentPath "EnginePathの親ディレクトリ" | Out-Null
    $engineName = Split-Path -Leaf $enginePath
    $engineStagePath = Join-Path $engineParentPath ".$($engineName).voicevox-engine-staging-$([Guid]::NewGuid().ToString('N'))"
    if ((Get-PathItemOrNull $engineStagePath) -ne $null) {
      throw "エンジンstageが既に存在します。パス: $engineStagePath"
    }
    if ($Scope -eq "Machine") {
      [System.IO.Directory]::CreateDirectory($engineStagePath, (New-MachineSecurity $true)) | Out-Null
    } else {
      [System.IO.Directory]::CreateDirectory($engineStagePath) | Out-Null
    }
    Copy-DirectoryContents $engineSourcePath $engineStagePath
    Assert-SafeDirectoryTree $engineStagePath
    $stagedManifest = Read-EngineManifest $engineStagePath
    if (($stagedManifest.uuid -ne $engineUuid) -or ($stagedManifest.version -ne $engineVersion)) {
      throw "stageしたエンジンmanifestが入力と一致しません。"
    }
    Ensure-DirectoryPath $appPath "AppPath" | Out-Null
    Write-DeploymentReceipt $receiptPath $appPath $Scope "preparing" $enginePath $engineUuid $engineVersion $RuntimeTarget

    $installScopeArgument = if ($Scope -eq "User") { "/currentuser" } else { "/allusers" }
    $installerArguments = @(
      "/S",
      $installScopeArgument,
      ('--package-file="' + $packageCopyPath + '"'),
      "/D=$appPath"
    )
    $installerProcess = Start-Process -FilePath $setupCopyPath -ArgumentList $installerArguments -Wait -PassThru -ErrorAction Stop
    if ($installerProcess -eq $null) {
      throw "NSISインストーラーが終了しませんでした。"
    }
    if ($installerProcess.ExitCode -ne 0) {
      throw "NSISインストーラーが失敗しました。終了コード: $($installerProcess.ExitCode)"
    }

    $installedAppPath = Get-InstalledAppPath $registryRoot
    if ($installedAppPath -ine $appPath) {
      throw "レジストリのインストール先がAppPathと一致しません。"
    }
    $executablePath = Get-ExistingFilePath (Join-Path $installedAppPath "VOICEVOX.exe") "VOICEVOX実行ファイル"
    Assert-FileAssociations $registryRoot $executablePath
    $currentReceipt = Read-DeploymentReceipt $receiptPath
    if ($currentReceipt -eq $null) {
      throw "配置情報が見つかりません。ファイル: $receiptPath"
    }
    Assert-ReceiptIdentity $currentReceipt $appPath $Scope $enginePath
    if (
      ($currentReceipt.state -ne "preparing") -or
      ($currentReceipt.engine.uuid -ne $engineUuid) -or
      ($currentReceipt.engine.version -ne $engineVersion) -or
      ($currentReceipt.engine.target -ne $RuntimeTarget)
    ) {
      throw "配置情報が導入対象と一致しません。"
    }

    $currentEngineItem = Get-PathItemOrNull $enginePath
    if (($existingEngineItem -eq $null) -and ($currentEngineItem -ne $null)) {
      throw "導入中に未所有のEnginePathが作成されました。"
    }
    if ($currentEngineItem -ne $null) {
      $existingEnginePath = Get-ExistingDirectoryPath $enginePath "管理エンジン"
      Assert-SafeDirectoryTree $existingEnginePath
      $existingManagedManifest = Read-EngineManifest $existingEnginePath
      if ($existingManagedManifest.uuid -ne $engineUuid) {
        throw "既存の管理エンジンUUIDが入力と一致しません。"
      }
      if (
        ($existingReceipt -ne $null) -and
        ($existingReceipt.state -eq "ready") -and
        ($existingManagedManifest.version -ne $existingReceipt.engine.version)
      ) {
        throw "既存の管理エンジンのバージョンが配置情報と一致しません。"
      }
      $engineBackupPath = "$enginePath.voicevox-engine-backup-$([Guid]::NewGuid().ToString('N'))"
      Move-Item -LiteralPath $existingEnginePath -Destination $engineBackupPath -ErrorAction Stop
    }
    Move-Item -LiteralPath $engineStagePath -Destination $enginePath -ErrorAction Stop
    $engineStagePath = $null
    if ($Scope -eq "Machine") {
      Protect-MachinePath $enginePath $true
    }
    $installedEngineManifest = Read-EngineManifest $enginePath
    if (($installedEngineManifest.uuid -ne $engineUuid) -or ($installedEngineManifest.version -ne $engineVersion)) {
      throw "配置したエンジンmanifestが入力と一致しません。"
    }
    Write-DeploymentReceipt $receiptPath $appPath $Scope "ready" $enginePath $engineUuid $engineVersion $RuntimeTarget
    if ($engineBackupPath -ne $null) {
      Remove-Item -LiteralPath $engineBackupPath -Recurse -Force -ErrorAction Stop
      $engineBackupPath = $null
    }
  } finally {
    if (($engineStagePath -ne $null) -and ((Get-PathItemOrNull $engineStagePath) -ne $null)) {
      Remove-Item -LiteralPath $engineStagePath -Recurse -Force -ErrorAction Stop
    }
    if (($temporaryDirectory -ne $null) -and ((Get-PathItemOrNull $temporaryDirectory) -ne $null)) {
      Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction Stop
    }
  }
}

Assert-Permissions $Scope
if ($Action -eq "Install") {
  Invoke-Install $Scope $SetupPath $PackagePath $EngineSourcePath $AppPath $EnginePath $RuntimeTarget
} else {
  Invoke-RemoveEngine $Scope $AppPath $EnginePath $RuntimeTarget
}
Write-Output "VOICEVOXの配置処理が完了しました。"
