<#
.SYNOPSIS
  Developer install of the topview-3d-cli command from this checkout (Windows). Safe to re-run.
  Users without a checkout install the wheel instead: `pipx install topview-3d-cli`.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [-Dev] [-InstallUv] [-SkipNode] [-SkipBrowser]

  -Dev          install the whole editor workspace (test tooling included) and pytest.
                The default install already includes Studio (Next.js) and the renderer.
  -InstallUv    if no Python >= 3.11 is found, install uv (https://astral.sh/uv) and use it
  -SkipNode     skip the Node/pnpm/builder steps
  -SkipBrowser  skip the Playwright Chromium download
#>
[CmdletBinding()]
param(
  [switch]$Dev,
  [switch]$InstallUv,
  [switch]$SkipNode,
  [switch]$SkipBrowser
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$Root = Split-Path -Parent $PSScriptRoot
$Agent = Join-Path $Root 'agent'
$Editor = Join-Path $Root 'editor'
$Venv = Join-Path $Agent '.venv'
$VenvPython = Join-Path $Venv 'Scripts\python.exe'
$Cli = Join-Path $Venv 'Scripts\topview-3d-cli.exe'

function Write-Step([string]$Message) { Write-Host "`n==> $Message" }
function Stop-Install([string]$Message) { Write-Host "error: $Message" -ForegroundColor Red; exit 1 }

# Native commands do not throw on non-zero exit codes in Windows PowerShell 5.1.
function Invoke-Native {
  param([Parameter(Mandatory)][string]$File, [string[]]$Arguments = @())
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { Stop-Install "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

# With ErrorActionPreference=Stop, Windows PowerShell 5.1 turns redirected stderr of a
# native command into a terminating error; probe commands with Continue instead.
function Test-Native {
  param([Parameter(Mandatory)][string]$File, [string[]]$Arguments = @())
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $File @Arguments *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Test-Python([string[]]$Command) {
  $rest = @()
  if ($Command.Length -gt 1) { $rest = $Command[1..($Command.Length - 1)] }
  return (Test-Native $Command[0] ($rest + @('-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)')))
}

function Find-Python {
  foreach ($candidate in @(@('py', '-3.13'), @('py', '-3.12'), @('py', '-3.11'), @('python3'), @('python'))) {
    if ((Get-Command $candidate[0] -ErrorAction SilentlyContinue) -and (Test-Python $candidate)) { return ,$candidate }
  }
  return $null
}

function Find-Uv {
  $command = Get-Command uv -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in @((Join-Path $HOME '.local\bin\uv.exe'), (Join-Path $HOME '.cargo\bin\uv.exe'))) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

if (-not (Test-Path (Join-Path $Agent 'pyproject.toml')) -or -not (Test-Path (Join-Path $Editor 'packages\director-cli'))) {
  Stop-Install 'run this script from a full scene3d-open-source checkout'
}

$extras = @()
if ($Dev) { $extras += 'test' }
$spec = $Agent
if ($extras.Count -gt 0) { $spec = "$Agent[$($extras -join ',')]" }

Write-Step "Python environment ($Venv)"
if ((Test-Path $VenvPython) -and -not (Test-Python @($VenvPython))) {
  Write-Host 'existing venv uses Python < 3.11; recreating it'
  Remove-Item -Recurse -Force $Venv
}
$uv = Find-Uv
$python = Find-Python
if (-not $uv -and -not $python -and -not (Test-Path $VenvPython)) {
  if ($InstallUv) {
    Write-Step 'Installing uv'
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $uv = Find-Uv
    if (-not $uv) { Stop-Install 'uv installed but not found; open a new terminal and re-run' }
  } else {
    Write-Host @'
error: Python 3.11 or newer was not found.
  Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH")
  or with `winget install Python.Python.3.12`,
  or re-run with -InstallUv to let uv (https://astral.sh/uv) provide Python.
'@ -ForegroundColor Red
    exit 1
  }
}
if ($uv) {
  Write-Host "using uv: $uv"
  if (-not (Test-Path $VenvPython)) { Invoke-Native $uv @('venv', '--python', '>=3.11', $Venv) }
  Invoke-Native $uv @('pip', 'install', '--python', $VenvPython, '-e', $spec)
} else {
  if (-not (Test-Path $VenvPython)) {
    Write-Host "using $($python -join ' ')"
    $rest = @()
    if ($python.Length -gt 1) { $rest = $python[1..($python.Length - 1)] }
    Invoke-Native $python[0] ($rest + @('-m', 'venv', $Venv))
  }
  if (-not (Test-Native $VenvPython @('-m', 'pip', '--version'))) { Invoke-Native $VenvPython @('-m', 'ensurepip', '--upgrade') }
  Invoke-Native $VenvPython @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-e', $spec)
}

if (-not $SkipNode) {
  Write-Step 'Node.js and pnpm'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Stop-Install 'Node.js 20.6+ is required: https://nodejs.org/' }
  $nodeVersion = (& node --version).Trim()
  if ([version]($nodeVersion.TrimStart('v')) -lt [version]'20.6.0') {
    Stop-Install "Node.js $nodeVersion is too old; install 20.6 or newer"
  }
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $pnpm = @('pnpm')
  } elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
    Write-Host 'pnpm not found; using it through corepack'
    $pnpm = @('corepack', 'pnpm')
  } else {
    Stop-Install 'pnpm is required: run `npm install -g pnpm` or enable corepack'
  }
  $pnpmArgs = @()
  if ($pnpm.Length -gt 1) { $pnpmArgs = $pnpm[1..($pnpm.Length - 1)] }
  Write-Host "node $nodeVersion, pnpm $(& $pnpm[0] @($pnpmArgs + '--version'))"

  Write-Step 'Editor dependencies'
  if ($Dev) {
    Invoke-Native $pnpm[0] ($pnpmArgs + @('-C', $Editor, 'install', '--frozen-lockfile'))
  } else {
    Invoke-Native $pnpm[0] ($pnpmArgs + @('-C', $Editor, 'install', '--frozen-lockfile', '--filter', '@topview/3d-director-cli...', '--filter', '@topview/3d-studio...'))
  }

  Write-Step 'Building @topview/3d-builder'
  Invoke-Native $pnpm[0] ($pnpmArgs + @('-C', $Editor, '--filter', '@topview/3d-builder', 'build'))

  if (-not $SkipBrowser) {
    Write-Step 'Playwright Chromium'
    Invoke-Native $Cli @('browser', 'ensure') | Out-Null
  }
}

Write-Step 'topview-3d-cli doctor'
$ErrorActionPreference = 'Continue'
$report = & $Cli doctor 2>&1
$status = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($status -eq 0) { Write-Host 'all checks passed' } else { $report | Write-Host }

Write-Host ''
Write-Host "topview-3d-cli is installed at $Cli"
Write-Host "Add it to PATH for this session with:  `$env:Path = `"$Venv\Scripts;`$env:Path`""
if ($status -ne 0 -and ($SkipNode -or $SkipBrowser)) { Write-Host '(doctor failures are expected for skipped steps)' }
exit $status
