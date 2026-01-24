<#
.SYNOPSIS
  Creates a Git worktree for a new feature, creates a branch, and CD's into the new folder.

.DESCRIPTION
  - Prompts the user for a feature name (e.g., "update my database")
  - Converts that to a URL/branch-safe slug (e.g., "update-my-database")
  - Creates a branch (default prefix: "feature/")
  - Creates a Git worktree under: <root>/worktrees/<truncated-slug>
      Where <root> is inferred from this script location:
        root/scripts/worktrees.ps1  -> worktrees go to root/worktrees
  - Truncates the folder name if it exceeds a maximum length
  - Changes directory (Set-Location) into the newly created worktree
  - Prints step-by-step status so the user knows what is happening
  - Includes exception handling and validation

.REQUIREMENTS
  - Git must be installed and available on PATH
  - Must be executed from within a Git repository working tree

.NOTES
  Save this as: root/scripts/worktrees.ps1
  Worktrees will be created in: root/worktrees
#>

[CmdletBinding()]
param(
  # Prefix for your feature branches
  [string]$BranchPrefix = "feature/",

  # Worktrees root. If not provided, defaults to "<root>/worktrees" based on script location.
  [string]$WorktreesRoot = "",

  # Maximum length for the worktree folder name (branch name can be longer)
  [int]$MaxFolderNameLength = 40,

  # If set, also truncates the branch slug itself (not usually necessary)
  [switch]$TruncateBranchName,

  # If set, do NOT cd into the created folder (useful for automation)
  [switch]$NoCd
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Info { param([string]$Message) Write-Host "    $Message" -ForegroundColor Gray }
function Write-Warn { param([string]$Message) Write-Host "WARNING: $Message" -ForegroundColor Yellow }
function Write-Fail { param([string]$Message) Write-Host "ERROR: $Message" -ForegroundColor Red }

function Test-Command {
  param([Parameter(Mandatory)][string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Git {
  <#
    .SYNOPSIS
      Runs git with arguments, echoes the command, and throws if it fails.
  #>
  param(
    [Parameter(Mandatory)][string[]]$Args,
    [string]$WorkingDirectory = ""
  )

  $pretty = "git " + ($Args -join " ")
  Write-Info $pretty

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "git"
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  if ($WorkingDirectory -and (Test-Path $WorkingDirectory)) { $psi.WorkingDirectory = $WorkingDirectory }
  foreach ($a in $Args) { [void]$psi.ArgumentList.Add($a) }

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi

  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()

  if ($stdout) { Write-Host $stdout.TrimEnd() }
  if ($p.ExitCode -ne 0) {
    if ($stderr) { Write-Host $stderr.TrimEnd() -ForegroundColor DarkRed }
    throw "Git command failed (exit code $($p.ExitCode)): $pretty"
  }

  return $stdout
}

function Get-RepoRoot {
  $out = Invoke-Git -Args @("rev-parse","--show-toplevel")
  $root = $out.Trim()
  if (-not (Test-Path $root)) { throw "Repo root not found or not accessible: $root" }
  return $root
}

function Convert-ToSlug {
  param([Parameter(Mandatory)][string]$Text)

  $t = $Text.Trim().ToLowerInvariant()
  $t = [regex]::Replace($t, "[^a-z0-9]+", "-")
  $t = [regex]::Replace($t, "-{2,}", "-")
  $t = $t.Trim("-")
  return $t
}

function Truncate-Name {
  param(
    [Parameter(Mandatory)][string]$Text,
    [Parameter(Mandatory)][int]$MaxLength
  )

  if ($Text.Length -le $MaxLength) { return $Text }

  $hash = [Math]::Abs($Text.GetHashCode()).ToString()
  $suffix = "-" + $hash.Substring(0, [Math]::Min(6, $hash.Length))

  $keep = $MaxLength - $suffix.Length
  if ($keep -lt 5) { return $Text.Substring(0, $MaxLength) }

  return ($Text.Substring(0, $keep) + $suffix)
}

function Ensure-CleanOrWarn {
  param([Parameter(Mandatory)][string]$RepoRootPath)

  $status = Invoke-Git -Args @("status","--porcelain") -WorkingDirectory $RepoRootPath
  if (-not [string]::IsNullOrWhiteSpace($status)) {
    Write-Warn "You have uncommitted changes in the current working tree. Worktrees are fine, but be mindful."
  }
}

try {
  Write-Step "Validating environment"

  if (-not (Test-Command "git")) { throw "Git is not installed or not on PATH." }

  # Must be run inside a git work tree
  $null = Invoke-Git -Args @("rev-parse","--is-inside-work-tree") | Out-Null

  $repoRoot = Get-RepoRoot
  Write-Info "Repo root: $repoRoot"

  Ensure-CleanOrWarn -RepoRootPath $repoRoot

  # ------------------------------------------------------------
  # Determine the "root" folder based on script path:
  #   root/scripts/worktrees.ps1  => RootDir = root
  # ------------------------------------------------------------
  $scriptPath = $PSCommandPath
  if (-not $scriptPath) { throw "Unable to determine script path (PSCommandPath is empty)." }

  $scriptsDir = Split-Path -Parent $scriptPath
  $rootDir    = Split-Path -Parent $scriptsDir

  Write-Info "Script path: $scriptPath"
  Write-Info "Root dir:    $rootDir"

  # Default WorktreesRoot to <root>/worktrees if not supplied
  if ([string]::IsNullOrWhiteSpace($WorktreesRoot)) {
    $WorktreesRoot = Join-Path $rootDir "worktrees"
  }

  Write-Info "Worktrees root: $WorktreesRoot"

  if (-not (Test-Path $WorktreesRoot)) {
    Write-Step "Creating worktrees root folder"
    Write-Info "mkdir $WorktreesRoot"
    New-Item -ItemType Directory -Path $WorktreesRoot | Out-Null
  }

  Write-Step "Gathering feature information"
  $featureRaw = Read-Host "Enter feature name (e.g., 'update my database')"
  if ([string]::IsNullOrWhiteSpace($featureRaw)) { throw "Feature name cannot be empty." }

  $slug = Convert-ToSlug -Text $featureRaw
  if ([string]::IsNullOrWhiteSpace($slug)) {
    throw "Feature name became empty after sanitizing. Please use letters/numbers."
  }

  if ($TruncateBranchName) {
    $slug = Truncate-Name -Text $slug -MaxLength $MaxFolderNameLength
  }

  $branchName = "$BranchPrefix$slug"

  # Folder name is slug, truncated for path friendliness
  $folderName  = Truncate-Name -Text $slug -MaxLength $MaxFolderNameLength
  $worktreePath = Join-Path $WorktreesRoot $folderName

  Write-Step "Plan"
  Write-Info "Feature name:   $featureRaw"
  Write-Info "Slug:           $slug"
  Write-Info "Branch:         $branchName"
  Write-Info "Worktree path:  $worktreePath"

  if (Test-Path $worktreePath) { throw "Worktree folder already exists: $worktreePath" }

  Write-Step "Checking branch existence"
  $branchExists = $false
  try {
    Invoke-Git -Args @("show-ref","--verify","--quiet","refs/heads/$branchName") -WorkingDirectory $repoRoot | Out-Null
    $branchExists = $true
  } catch {
    # Not found is expected; ignore
  }
  if ($branchExists) { throw "Branch already exists locally: $branchName" }

  Write-Step "Creating worktree and branch"
  # Creates the folder and sets up the new branch in that folder
  Invoke-Git -Args @("worktree","add","-b",$branchName,$worktreePath) -WorkingDirectory $repoRoot | Out-Null

  Write-Step "Worktree created successfully"
  Write-Info "New worktree: $worktreePath"
  Write-Info "Branch:       $branchName"

  Write-Step "Current worktrees"
  Invoke-Git -Args @("worktree","list") -WorkingDirectory $repoRoot | Out-Null

  if (-not $NoCd) {
    Write-Step "Changing directory to new worktree"
    Set-Location -Path $worktreePath
    Write-Info "Now in: $(Get-Location)"
  } else {
    Write-Info "NoCd specified; staying in current directory."
  }

  Write-Step "Done"
}
catch {
  Write-Fail $_.Exception.Message
  Write-Info "Tip: run this from inside the repo you want to create a worktree for."
  exit 1
}