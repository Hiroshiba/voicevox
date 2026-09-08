[CmdletBinding()]
param(
  [string]$Scope,
  [string]$ManifestPath,
  [string]$PackagePath,
  [string]$InstallerPath,
  [string]$InstallDirectory
)

Set-StrictMode -Version 2.0

$successCode = 0
$invalidArgumentCode = 10
$missingFileCode = 20
$hashMismatchCode = 21
$installerCode = 30
$postconditionCode = 40
$permissionCode = 50

function Stop-Installation {
  param(
    [int]$Code,
    [string]$Message
  )

  Write-Error -Message $Message -ErrorAction Continue
  exit $Code
}

function Get-RequiredProperty {
  param(
    [object]$Object,
    [string]$PropertyName,
    [int]$Code
  )

  if ($Object -eq $null) {
    Stop-Installation $Code "必須の値がありません。項目: $PropertyName"
  }

  $property = $Object.PSObject.Properties[$PropertyName]
  if ($property -eq $null) {
    Stop-Installation $Code "必須の項目がありません。項目: $PropertyName"
  }

  return $property.Value
}

function Read-JsonFile {
  param(
    [string]$Path,
    [int]$Code
  )

  try {
    $json = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
    return ($json | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit $Code
  }
}

function Get-VerifiedFilePath {
  param(
    [string]$Path,
    [string]$Description,
    [long]$ExpectedSize,
    [string]$ExpectedHash
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-Installation $missingFileCode "ファイルが見つかりません。${Description}: $Path"
  }

  $file = Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($file.PSIsContainer) {
    Stop-Installation $missingFileCode "通常ファイルではありません。${Description}: $Path"
  }
  if ($file.Length -ne $ExpectedSize) {
    Stop-Installation $hashMismatchCode "成果物のサイズが一致しません。${Description}: $Path"
  }

  try {
    $actualHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA512 -ErrorAction Stop).Hash
  } catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit $hashMismatchCode
  }
  if ($actualHash -ine $ExpectedHash) {
    Stop-Installation $hashMismatchCode "成果物のSHA-512ハッシュが一致しません。${Description}: $Path"
  }

  return $file.FullName
}

function Get-RegistryString {
  param(
    [string]$RegistryPath,
    [string]$ValueName
  )

  try {
    $registryKey = Get-Item -LiteralPath $RegistryPath -ErrorAction Stop
  } catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit $postconditionCode
  }

  try {
    $value = $registryKey.GetValue($ValueName)
  } catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit $postconditionCode
  }
  if (($value -isnot [string]) -or [string]::IsNullOrWhiteSpace($value)) {
    Stop-Installation $postconditionCode "レジストリ値が不正です。値: $ValueName"
  }

  return [string]$value
}

function Get-QuotedCommandExecutablePath {
  param(
    [string]$Command
  )

  $trimmedCommand = $Command.Trim()
  if (
    [string]::IsNullOrWhiteSpace($trimmedCommand) -or
    (-not $trimmedCommand.StartsWith('"'))
  ) {
    Stop-Installation $postconditionCode "ファイル関連付けのコマンドが不正です。"
  }

  $closingQuote = $trimmedCommand.IndexOf('"', 1)
  if ($closingQuote -le 1) {
    Stop-Installation $postconditionCode "ファイル関連付けのコマンドが不正です。"
  }

  return $trimmedCommand.Substring(1, $closingQuote - 1)
}

if (($Scope -ne "User") -and ($Scope -ne "Machine")) {
  Stop-Installation $invalidArgumentCode "ScopeにはUserまたはMachineを指定してください。"
}
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  Stop-Installation $invalidArgumentCode "ManifestPathを指定してください。"
}
if (-not [string]::IsNullOrWhiteSpace($InstallDirectory)) {
  if (-not [System.IO.Path]::IsPathRooted($InstallDirectory)) {
    Stop-Installation $invalidArgumentCode "InstallDirectoryには絶対パスを指定してください。"
  }
  if ($InstallDirectory -match '["\r\n]') {
    Stop-Installation $invalidArgumentCode "InstallDirectoryに使用できない文字が含まれています。"
  }
}
if ([IntPtr]::Size -ne 8) {
  Stop-Installation $invalidArgumentCode "64ビット版のPowerShellで実行してください。"
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = New-Object System.Security.Principal.WindowsPrincipal($currentIdentity)
$isSystem = $currentIdentity.User.Value -eq "S-1-5-18"
$isAdministrator = $currentPrincipal.IsInRole(
  [System.Security.Principal.WindowsBuiltInRole]::Administrator
)
if (($Scope -eq "Machine") -and (-not $isAdministrator)) {
  Stop-Installation $permissionCode "Machineスコープには管理者権限が必要です。"
}
if (($Scope -eq "User") -and ($isSystem -or $isAdministrator)) {
  Stop-Installation $permissionCode "Userスコープは非昇格のユーザーコンテキストで実行してください。"
}

if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  Stop-Installation $missingFileCode "manifestファイルが見つかりません。ファイル: $ManifestPath"
}
$manifestFile = Get-Item -LiteralPath $ManifestPath -ErrorAction Stop
$manifest = Read-JsonFile $manifestFile.FullName $invalidArgumentCode

foreach ($propertyName in @("editorVersion", "engineUuid", "engineVersion", "runtimeTarget")) {
  $value = Get-RequiredProperty $manifest $propertyName $invalidArgumentCode
  if (($value -isnot [string]) -or [string]::IsNullOrWhiteSpace($value)) {
    Stop-Installation $invalidArgumentCode "文字列の値が必要です。項目: $propertyName"
  }
}
$engineUuid = [string](Get-RequiredProperty $manifest "engineUuid" $invalidArgumentCode)
$engineVersion = [string](Get-RequiredProperty $manifest "engineVersion" $invalidArgumentCode)
$package = Get-RequiredProperty $manifest "package" $invalidArgumentCode
$installer = Get-RequiredProperty $manifest "installer" $invalidArgumentCode
if (
  ($package -eq $null) -or
  ($package -is [string]) -or
  ($package -is [System.ValueType]) -or
  ($package -is [System.Array]) -or
  ($installer -eq $null) -or
  ($installer -is [string]) -or
  ($installer -is [System.ValueType]) -or
  ($installer -is [System.Array])
) {
  Stop-Installation $invalidArgumentCode "成果物情報が不正です。"
}

$packageName = Get-RequiredProperty $package "name" $invalidArgumentCode
$packageSizeValue = Get-RequiredProperty $package "size" $invalidArgumentCode
$packageHash = Get-RequiredProperty $package "sha512" $invalidArgumentCode
$installerName = Get-RequiredProperty $installer "name" $invalidArgumentCode
$installerSizeValue = Get-RequiredProperty $installer "size" $invalidArgumentCode
$installerHash = Get-RequiredProperty $installer "sha512" $invalidArgumentCode
if (
  ($packageName -isnot [string]) -or
  [string]::IsNullOrWhiteSpace($packageName) -or
  ($installerName -isnot [string]) -or
  [string]::IsNullOrWhiteSpace($installerName) -or
  ($packageHash -isnot [string]) -or
  ($packageHash -notmatch '^[0-9a-fA-F]{128}$') -or
  ($installerHash -isnot [string]) -or
  ($installerHash -notmatch '^[0-9a-fA-F]{128}$')
) {
  Stop-Installation $invalidArgumentCode "成果物情報の文字列が不正です。"
}
if (
  ($packageSizeValue -isnot [int]) -and
  ($packageSizeValue -isnot [long])
) {
  Stop-Installation $invalidArgumentCode "成果物サイズは整数で指定してください。"
}
if (
  ($installerSizeValue -isnot [int]) -and
  ($installerSizeValue -isnot [long])
) {
  Stop-Installation $invalidArgumentCode "成果物サイズは整数で指定してください。"
}
if (($packageSizeValue -lt 0) -or ($installerSizeValue -lt 0)) {
  Stop-Installation $invalidArgumentCode "成果物サイズは0以上で指定してください。"
}
[long]$packageSize = $packageSizeValue
[long]$installerSize = $installerSizeValue
if (
  ($packageName -eq ".") -or
  ($packageName -eq "..") -or
  ($packageName -match '[/\\:]') -or
  (-not $packageName.EndsWith(".nsis.7z", [System.StringComparison]::OrdinalIgnoreCase)) -or
  ($installerName -eq ".") -or
  ($installerName -eq "..") -or
  ($installerName -match '[/\\:]') -or
  (-not $installerName.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase))
) {
  Stop-Installation $invalidArgumentCode "成果物ファイル名が不正です。"
}

$manifestDirectory = $manifestFile.DirectoryName
if ([string]::IsNullOrWhiteSpace($PackagePath)) {
  $PackagePath = Join-Path $manifestDirectory $packageName
}
if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
  $InstallerPath = Join-Path $manifestDirectory $installerName
}
$packagePath = Get-VerifiedFilePath $PackagePath "NSISパッケージ" $packageSize $packageHash
$installerPath = Get-VerifiedFilePath $InstallerPath "インストーラー" $installerSize $installerHash

if ($Scope -eq "User") {
  $installScopeArgument = "/currentuser"
} else {
  $installScopeArgument = "/allusers"
}
$installerArguments = @(
  "/S",
  $installScopeArgument,
  ('--package-file="' + $packagePath + '"')
)
if (-not [string]::IsNullOrWhiteSpace($InstallDirectory)) {
  $installerArguments += "/D=$InstallDirectory"
}

try {
  $installerProcess = Start-Process `
    -FilePath $installerPath `
    -ArgumentList $installerArguments `
    -Wait `
    -PassThru `
    -ErrorAction Stop
} catch {
  Write-Error -ErrorRecord $_ -ErrorAction Continue
  exit $installerCode
}
if ($installerProcess -eq $null) {
  Stop-Installation $installerCode "インストーラーが終了しませんでした。"
}
if ($installerProcess.ExitCode -ne 0) {
  Stop-Installation $installerCode "インストーラーが失敗しました。終了コード: $($installerProcess.ExitCode)"
}

$voicevoxAppRegistryGuid = "92713bbc-5c5b-5df6-b6d1-5b09e302bf58"
if ($Scope -eq "User") {
  $registryRoot = "HKCU:"
} else {
  $registryRoot = "HKLM:"
}
$installRegistryPath = Join-Path $registryRoot "Software\$voicevoxAppRegistryGuid"
$installLocation = Get-RegistryString $installRegistryPath "InstallLocation"
if (-not [System.IO.Path]::IsPathRooted($installLocation)) {
  Stop-Installation $postconditionCode "インストール先が絶対パスではありません。パス: $installLocation"
}
if (-not [string]::IsNullOrWhiteSpace($InstallDirectory)) {
  try {
    $requestedInstallPath = [System.IO.Path]::GetFullPath($InstallDirectory)
    $installedPath = [System.IO.Path]::GetFullPath($installLocation)
  } catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit $postconditionCode
  }
  if (
    $requestedInstallPath.TrimEnd([char[]]@("\", "/")) -ine
    $installedPath.TrimEnd([char[]]@("\", "/"))
  ) {
    Stop-Installation $postconditionCode "インストール先が指定値と一致しません。パス: $installLocation"
  }
}

$executablePath = Join-Path $installLocation "VOICEVOX.exe"
if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
  Stop-Installation $postconditionCode "VOICEVOX.exeが見つかりません。ファイル: $executablePath"
}
$installedEngineManifestPath = Join-Path $installLocation "vv-engine\engine_manifest.json"
if (-not (Test-Path -LiteralPath $installedEngineManifestPath -PathType Leaf)) {
  Stop-Installation $postconditionCode "エンジンのmanifestファイルが見つかりません。ファイル: $installedEngineManifestPath"
}
$installedEngineManifest = Read-JsonFile $installedEngineManifestPath $postconditionCode
$installedEngineUuid = Get-RequiredProperty $installedEngineManifest "uuid" $postconditionCode
$installedEngineVersion = Get-RequiredProperty $installedEngineManifest "version" $postconditionCode
if (
  ($installedEngineUuid -isnot [string]) -or
  [string]::IsNullOrWhiteSpace($installedEngineUuid) -or
  ($installedEngineVersion -isnot [string]) -or
  [string]::IsNullOrWhiteSpace($installedEngineVersion)
) {
  Stop-Installation $postconditionCode "インストール済みエンジンのmanifestが不正です。"
}
if ($installedEngineUuid -ine $engineUuid) {
  Stop-Installation $postconditionCode "エンジンUUIDが一致しません。"
}
if ($installedEngineVersion -cne $engineVersion) {
  Stop-Installation $postconditionCode "エンジンバージョンが一致しません。"
}

try {
  $expectedExecutablePath = [System.IO.Path]::GetFullPath($executablePath).ToLowerInvariant()
} catch {
  Write-Error -ErrorRecord $_ -ErrorAction Continue
  exit $postconditionCode
}
$classesRoot = Join-Path $registryRoot "Software\Classes"
foreach ($extension in @(".vvproj", ".vvpp", ".vvppp")) {
  $extensionKeyPath = Join-Path $classesRoot $extension
  $className = Get-RegistryString $extensionKeyPath ""
  if ($className -match '[/\\:]') {
    Stop-Installation $postconditionCode "ファイル関連付けのクラス名が不正です。拡張子: $extension"
  }
  $commandKeyPath = Join-Path $classesRoot "$className\shell\open\command"
  $commandExecutablePath = Get-QuotedCommandExecutablePath (Get-RegistryString $commandKeyPath "")
  try {
    $actualExecutablePath = [System.IO.Path]::GetFullPath($commandExecutablePath).ToLowerInvariant()
  } catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    exit $postconditionCode
  }
  if ($actualExecutablePath -cne $expectedExecutablePath) {
    Stop-Installation $postconditionCode "ファイル関連付けの実行ファイルが一致しません。拡張子: $extension"
  }
}

exit $successCode
