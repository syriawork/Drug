param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$ElectronPath = ''
)

$ErrorActionPreference = 'Stop'
$runtimeSource = Join-Path $PSScriptRoot 'main.cjs'
$resultsDirectory = Join-Path $PSScriptRoot 'results'
$tempRoot = Join-Path $env:TEMP ('stage36a70r-run-' + [guid]::NewGuid().ToString('N'))
$appDirectory = Join-Path $tempRoot 'electron-test-app'
$userDataDirectory = Join-Path $tempRoot 'user-data'
$outputDirectory = Join-Path $tempRoot 'output'
$qualificationBefore = $env:STAGE36A70R_QUALIFY
$outputBefore = $env:STAGE36A70R_OUTPUT
$userDataBefore = $env:STAGE36A70R_USER_DATA
$exitStatus = 0

try {
  if ([string]::IsNullOrWhiteSpace($ElectronPath)) {
    $ElectronPath = Join-Path $RepositoryRoot 'node_modules\electron\dist\electron.exe'
  }
  if (-not (Test-Path -LiteralPath $ElectronPath -PathType Leaf)) {
    throw "Installed Electron executable not found: $ElectronPath"
  }

  New-Item -ItemType Directory -Path $appDirectory,$userDataDirectory,$outputDirectory,$resultsDirectory -Force | Out-Null
  Copy-Item -LiteralPath $runtimeSource -Destination (Join-Path $appDirectory 'main.cjs')

  $manifest = @{
    name = 'stage36a70r-runtime-qualification'
    version = '1.0.0'
    main = 'main.cjs'
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText(
    (Join-Path $appDirectory 'package.json'),
    $manifest,
    (New-Object System.Text.UTF8Encoding($false))
  )

  $env:STAGE36A70R_QUALIFY = '1'
  $env:STAGE36A70R_USER_DATA = $userDataDirectory
  $installedOutput = Join-Path $outputDirectory 'installed.json'
  $env:STAGE36A70R_OUTPUT = $installedOutput
  $installedArguments = '--no-sandbox "' + $appDirectory + '"'
  $installedProcess = Start-Process -FilePath $ElectronPath -ArgumentList $installedArguments -PassThru
  if (-not $installedProcess.WaitForExit(60000)) {
    Stop-Process -Id $installedProcess.Id -Force
    throw 'Installed Electron qualification timed out after 60 seconds.'
  }
  if (-not (Test-Path -LiteralPath $installedOutput -PathType Leaf)) {
    throw "Installed Electron did not produce output JSON (exit=$($installedProcess.ExitCode))."
  }
  $installedResult = Get-Content -LiteralPath $installedOutput -Raw | ConvertFrom-Json
  $installedSaved = Join-Path $resultsDirectory 'installed-runtime-output.json'
  Copy-Item -LiteralPath $installedOutput -Destination $installedSaved -Force
  Write-Output '--- INSTALLED ELECTRON RESULT ---'
  Get-Content -LiteralPath $installedOutput -Raw
  if ($installedProcess.ExitCode -ne 0 -or $installedResult.status -ne 'PASS') {
    $exitStatus = 1
  }
} finally {
  if ($null -eq $qualificationBefore) {
    Remove-Item Env:STAGE36A70R_QUALIFY -ErrorAction SilentlyContinue
  } else {
    $env:STAGE36A70R_QUALIFY = $qualificationBefore
  }
  if ($null -eq $outputBefore) {
    Remove-Item Env:STAGE36A70R_OUTPUT -ErrorAction SilentlyContinue
  } else {
    $env:STAGE36A70R_OUTPUT = $outputBefore
  }
  if ($null -eq $userDataBefore) {
    Remove-Item Env:STAGE36A70R_USER_DATA -ErrorAction SilentlyContinue
  } else {
    $env:STAGE36A70R_USER_DATA = $userDataBefore
  }
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

exit $exitStatus
