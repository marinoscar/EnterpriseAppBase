<#
.SYNOPSIS
  Creates a Git worktree for a new feature using an OpenAI LLM to generate an optimal branch slug and folder name.

.DESCRIPTION
  - Prompts the user for a natural language description (e.g., "update my database schema for new users table")
  - Uses OpenAI (model: gpt-5-nano) to return STRICT JSON:
      { "branch_slug": "...", "folder_name": "..." }
  - Validates that output is filesystem & git-safe (a-z, 0-9, hyphen only)
  - Creates a branch (default prefix: "feature/")
  - Creates a Git worktree under: <root>/worktrees/<folder_name>
      Where <root> is inferred from this script location:
        root/scripts/worktrees.ps1  -> worktrees go to root/worktrees
  - CD's into the new folder (unless -NoCd)
  - Echoes each step, includes exception handling

.REQUIREMENTS
  - Git installed and on PATH
  - Must be run from inside a Git repo work tree
  - OpenAI API key must be available via OPENAI_API_KEY or provided interactively

.NOTES
  Save this file as: root/scripts/worktrees.ps1
#>

[CmdletBinding()]
param(
  # Prefix for your feature branches (e.g. feature/, bugfix/, chore/)
  [string]$BranchPrefix = "feature/",

  # Worktrees root. If not provided, defaults to "<root>/worktrees" based on script location.
  [string]$WorktreesRoot = "",

  # Max length for folder name (LLM is asked to keep it short; we enforce it too)
  [int]$MaxFolderNameLength = 40,

  # If set, do NOT cd into the created folder
  [switch]$NoCd
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ----------------------------
# Config
# ----------------------------
$OpenAiModel = "gpt-5-nano"
$OpenAiEndpoint = "https://api.openai.com/v1/responses"

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

function Ensure-CleanOrWarn {
  param([Parameter(Mandatory)][string]$RepoRootPath)

  $status = Invoke-Git -Args @("status","--porcelain") -WorkingDirectory $RepoRootPath
  if (-not [string]::IsNullOrWhiteSpace($status)) {
    Write-Warn "You have uncommitted changes in the current working tree. Worktrees are fine, but be mindful."
  }
}

function ConvertTo-PlainTextFromSecureString {
  param([Parameter(Mandatory)][Security.SecureString]$Secure)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-OpenAiApiKey {
  <#
    .SYNOPSIS
      Ensures we have an OpenAI API key. Reads OPENAI_API_KEY; if missing, prompts the user.
    .OUTPUTS
      string API key
  #>
  $apiKey = $env:OPENAI_API_KEY
  if (-not [string]::IsNullOrWhiteSpace($apiKey)) {
    return $apiKey
  }

  Write-Warn "OPENAI_API_KEY is not set."
  Write-Info "You can paste it now (it will be hidden)."

  $secure = Read-Host "Enter OpenAI API Key" -AsSecureString
  $apiKey = ConvertTo-PlainTextFromSecureString -Secure $secure

  if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "No API key provided. Cannot continue because LLM naming is required."
  }

  # Set for current session so we can use it immediately
  $env:OPENAI_API_KEY = $apiKey

  $persist = Read-Host "Persist OPENAI_API_KEY for future sessions? (y/N)"
  if ($persist -match '^(y|yes)$') {
    Write-Info "Persisting OPENAI_API_KEY in user environment variables..."
    # User-level persistence
    [Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $apiKey, "User")
    Write-Info "Done. You may need a new terminal session for it to be available everywhere."
  } else {
    Write-Info "API key will be used for this session only."
  }

  return $apiKey
}

function Assert-SafeName {
  <#
    .SYNOPSIS
      Validates name contains only: a-z, 0-9, hyphen, and is not empty.
  #>
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$FieldName
  )

  if ([string]::IsNullOrWhiteSpace($Name)) {
    throw "$FieldName is empty."
  }

  # start/end must be alnum; internal hyphens allowed
  if ($Name -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
    throw "$FieldName contains invalid characters: '$Name' (allowed: a-z, 0-9, hyphen; cannot start/end with hyphen)."
  }
}

function Truncate-Name {
  <#
    .SYNOPSIS
      Truncates a string to a max length with a small hash suffix for uniqueness.
  #>
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

function Get-LlmWorktreeSuggestion {
  <#
    .SYNOPSIS
      Calls OpenAI to generate branch_slug and folder_name from natural language.

    .OUTPUTS
      PSCustomObject:
        - BranchSlug
        - FolderName
  #>
  param(
    [Parameter(Mandatory)][string]$NaturalLanguage,
    [Parameter(Mandatory)][string]$ApiKey,
    [Parameter(Mandatory)][string]$Model
  )

  # Strong prompt: strict JSON, safe characters only
  $prompt = @"
You generate git/worktree naming.

Return STRICT JSON ONLY with:
{
  "branch_slug": "lowercase-hyphen-slug",
  "folder_name": "short-lowercase-hyphen-name"
}

Rules:
- Use ONLY a-z, 0-9, and hyphen.
- branch_slug: descriptive but concise (<= 60 chars).
- folder_name: shorter (<= 30 chars), still meaningful.
- Do not include customer names, secrets, ticket numbers, or personal data.
- No markdown, no extra text, JSON only.

User request: "$NaturalLanguage"
"@

  $bodyObj = @{
    model = $Model
    input = @(
      @{
        role = "user"
        content = @(
          @{ type = "input_text"; text = $prompt }
        )
      }
    )
    # Ask for a JSON object. Still validate.
    text = @{
      format = @{ type = "json_object" }
    }
  }

  $body = $bodyObj | ConvertTo-Json -Depth 10

  Write-Step "Calling OpenAI for naming (model: $Model)"
  Write-Info "Endpoint: $OpenAiEndpoint"

  try {
    $resp = Invoke-RestMethod -Method Post -Uri $OpenAiEndpoint -Headers @{
      Authorization = "Bearer $ApiKey"
      "Content-Type" = "application/json"
    } -Body $body
  }
  catch {
    throw "OpenAI call failed: $($_.Exception.Message)"
  }

  # Extract output text from Responses API
  $text = $null
  if ($resp -and $resp.output) {
    foreach ($o in $resp.output) {
      if ($o.content) {
        foreach ($c in $o.content) {
          if ($c.type -eq "output_text" -and $c.text) { $text = $c.text }
        }
      }
    }
  }

  if ([string]::IsNullOrWhiteSpace($text)) {
    throw "OpenAI returned no usable output text."
  }

  # Parse JSON
  try {
    $json = $text | ConvertFrom-Json
  }
  catch {
    throw "Failed to parse OpenAI output as JSON. Raw output: $text"
  }

  $branchSlug = [string]$json.branch_slug
  $folderName = [string]$json.folder_name

  # Validate
  Assert-SafeName -Name $branchSlug -FieldName "branch_slug"
  Assert-SafeName -Name $folderName -FieldName "folder_name"

  return [PSCustomObject]@{
    BranchSlug = $branchSlug
    FolderName = $folderName
  }
}

try {
  Write-Step "Validating environment"

  if (-not (Test-Command "git")) { throw "Git is not installed or not on PATH." }

  # Must be run inside a git repo work tree
  $null = Invoke-Git -Args @("rev-parse","--is-inside-work-tree") | Out-Null

  $repoRoot = Get-RepoRoot
  Write-Info "Repo root: $repoRoot"

  Ensure-CleanOrWarn -RepoRootPath $repoRoot

  # Determine root folder based on script path:
  #   root/scripts/worktrees.ps1 => RootDir = root
  $scriptPath = $PSCommandPath
  if (-not $scriptPath) { throw "Unable to determine script path (PSCommandPath is empty)." }

  $scriptsDir = Split-Path -Parent $scriptPath
  $rootDir    = Split-Path -Parent $scriptsDir

  Write-Info "Script path: $scriptPath"
  Write-Info "Root dir:    $rootDir"

  # WorktreesRoot defaults to <root>/worktrees
  if ([string]::IsNullOrWhiteSpace($WorktreesRoot)) {
    $WorktreesRoot = Join-Path $rootDir "worktrees"
  }
  Write-Info "Worktrees root: $WorktreesRoot"

  if (-not (Test-Path $WorktreesRoot)) {
    Write-Step "Creating worktrees root folder"
    Write-Info "mkdir $WorktreesRoot"
    New-Item -ItemType Directory -Path $WorktreesRoot | Out-Null
  }

  # Ensure we have an API key (LLM is required)
  $apiKey = Get-OpenAiApiKey

  Write-Step "Gathering feature intent (natural language)"
  $featureRaw = Read-Host "Describe the feature (natural language)"
  if ([string]::IsNullOrWhiteSpace($featureRaw)) { throw "Input cannot be empty." }

  # Ask LLM for naming
  $suggestion = Get-LlmWorktreeSuggestion -NaturalLanguage $featureRaw -ApiKey $apiKey -Model $OpenAiModel

  # Enforce folder length even if model gives longer
  $folderName = Truncate-Name -Text $suggestion.FolderName -MaxLength $MaxFolderNameLength
  # Branch slug can remain full; still safe. (If you want to enforce length, truncate similarly.)
  $slug = $suggestion.BranchSlug

  $branchName = "$BranchPrefix$slug"
  $worktreePath = Join-Path $WorktreesRoot $folderName

  Write-Step "Plan (from LLM)"
  Write-Info "Request:       $featureRaw"
  Write-Info "Model:         $OpenAiModel"
  Write-Info "Branch:        $branchName"
  Write-Info "Folder:        $folderName"
  Write-Info "Worktree path: $worktreePath"

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