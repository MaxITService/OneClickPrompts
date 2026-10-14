#Requires -Version 7.0
<#
.SYNOPSIS
    Build a release ZIP, optionally bump the version and create a local Git commit.
.DESCRIPTION
    Without -Mode, show the existing interactive menu. Agents must specify Release,
    Bump, or Build to avoid prompts. Release requires a clean working tree and commits
    only manifest.json and popup.html. No mode pushes or publishes to a store.
    Relative output paths are resolved against this script's directory.
.EXAMPLE
    pwsh -NoProfile -File ./CI-CD.ps1 -Mode Release -OutputDirectory .release -Json
.EXAMPLE
    pwsh -NoProfile -File ./CI-CD.ps1 -Mode Release -Version 0.0.8.4 -OutputDirectory .release -Json
.EXAMPLE
    pwsh -NoProfile -File ./CI-CD.ps1 -Mode Build -OutputDirectory .release -Json
#>
[CmdletBinding()]
param (
    [ValidateSet('Interactive', 'Release', 'Bump', 'Build')]
    [string]$Mode = 'Interactive',
    [string]$Version,
    [string]$OutputDirectory,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$source = [System.IO.Path]::GetFullPath($PSScriptRoot)
$excludedDirs = @('Promo', 'node_modules', 'tests', 'coverage')
$excludedFiles = @(
    '.gitignore', 'CI-CD.ps1', 'agents.md', 'code-notes.md',
    '.aider.chat.history.md', '.aider.input.history', 'notes.txt', 'instructions.txt',
    'Full_logo.png', 'prompt-update.md', 'package.json', 'package-lock.json'
)
$encoding = [System.Text.UTF8Encoding]::new($false)
$currentVersion = $null
$newVersion = $null
$versionWritten = $false
$committed = $false
$commitHash = $null
$commitMessage = $null
$destination = $null
$zipPath = $null

function Write-ReleaseStatus {
    param ([string]$Message)
    if (-not $Json) {
        Write-Host $Message
    }
}

function Invoke-ReleaseGit {
    param ([string[]]$Arguments)
    $output = @(& git -C $source @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed (exit $LASTEXITCODE): $($output -join "`n")"
    }
    return $output
}

function Test-ShouldExclude {
    param ([string]$RelativePath)
    $parts = $RelativePath -split '[/\\]'
    foreach ($part in $parts) {
        if ($part.StartsWith('.') -or $excludedDirs -contains $part) {
            return $true
        }
    }
    return $excludedFiles -contains $parts[-1]
}

try {
    if ($Mode -eq 'Interactive') {
        if ($Json -or [Console]::IsInputRedirected) {
            throw 'Specify -Mode Release, Bump, or Build for non-interactive execution.'
        }
        Write-Host 'Select mode:'
        Write-Host ' [ENTER]  Automatic Version Increase + Git Commit'
        Write-Host ' [c]      Increase Version ONLY (No Commit)'
        Write-Host ' [v]      Proceed with NO changes (Build only)'
        do {
            $choice = Read-Host 'Choice'
            switch ($choice.Trim()) {
                '' { $Mode = 'Release' }
                'c' { $Mode = 'Bump' }
                'v' { $Mode = 'Build' }
                default { Write-Host 'Use ENTER, c, or v.' }
            }
        } while ($Mode -eq 'Interactive')
    }

    if ($Mode -eq 'Build' -and $PSBoundParameters.ContainsKey('Version')) {
        throw '-Version cannot be combined with -Mode Build; use Bump or Release.'
    }
    $doVersionIncrease = $Mode -ne 'Build'
    $doCommit = $Mode -eq 'Release'

    Get-Command git -ErrorAction Stop | Out-Null
    $gitRoot = (Invoke-ReleaseGit -Arguments @('rev-parse', '--show-toplevel')) -join ''
    if ([System.IO.Path]::GetFullPath($gitRoot) -ne $source) {
        throw 'CI-CD.ps1 must be located at the Git repository root.'
    }
    if ($doCommit) {
        $branch = (Invoke-ReleaseGit -Arguments @('rev-parse', '--abbrev-ref', 'HEAD')) -join ''
        if ($branch -eq 'HEAD') {
            throw 'Release requires a checked-out Git branch; HEAD is detached.'
        }
        $gitStatus = @(Invoke-ReleaseGit -Arguments @('status', '--porcelain=v1', '--untracked-files=normal'))
        if ($gitStatus.Count -gt 0) {
            throw "Release requires a clean working tree. Commit the intended changes first; do not stage unrelated files. Use -Mode Bump to build without a commit.`n$($gitStatus -join "`n")"
        }
    }

    # Validate both version locations before writing either of them.
    $manifestPath = Join-Path $source 'manifest.json'
    $popupPath = Join-Path $source 'popup.html'
    $manifestContent = [System.IO.File]::ReadAllText($manifestPath, $encoding)
    $popupContent = [System.IO.File]::ReadAllText($popupPath, $encoding)
    $manifest = ConvertFrom-Json -InputObject $manifestContent
    $currentVersion = [string]$manifest.version
    $versionPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
    if ($currentVersion -notmatch $versionPattern) {
        throw "Expected a four-part version in manifest.json; found '$currentVersion'."
    }
    $currentParts = @($currentVersion.Split('.') | ForEach-Object { [int]$_ })
    if (@($currentParts | Where-Object { $_ -gt 65535 }).Count -gt 0 -or $currentVersion -eq '0.0.0.0') {
        throw "Invalid extension version '$currentVersion'. Components must be 0..65535, with at least one non-zero component."
    }
    $manifestRegex = [regex]::new('("version"\s*:\s*")(\d+\.\d+\.\d+\.\d+)(")')
    $popupRegex = [regex]::new('(<div\b[^>]*\bid=(["''])version\2[^>]*>\s*Version\s*(?:<br\s*/?>|\s+)\s*)(\d+\.\d+\.\d+\.\d+)(\s*</div>)')
    $manifestMatches = $manifestRegex.Matches($manifestContent)
    $popupMatches = $popupRegex.Matches($popupContent)
    if ($manifestMatches.Count -ne 1 -or $manifestMatches[0].Groups[2].Value -ne $currentVersion) {
        throw 'Could not identify a unique manifest.json version to update.'
    }
    if ($popupMatches.Count -ne 1) {
        throw 'Could not identify a unique version label in popup.html.'
    }
    if ($popupMatches[0].Groups[3].Value -ne $currentVersion) {
        throw "Version mismatch: manifest.json is $currentVersion, popup.html is $($popupMatches[0].Groups[3].Value). Sync them before building."
    }

    $newVersion = $currentVersion
    if ($doVersionIncrease) {
        if ($PSBoundParameters.ContainsKey('Version')) {
            if ($Version -notmatch $versionPattern) {
                throw '-Version must contain four integer components, for example 0.0.8.4.'
            }
            $newVersion = $Version
        }
        else {
            # Preserve the project's decimal carry convention: 0.0.8.9 -> 0.0.9.0.
            $parts = [int[]]$currentParts.Clone()
            $parts[3]++
            for ($i = 3; $i -gt 0; $i--) {
                if ($parts[$i] -gt 9) {
                    $parts[$i] = 0
                    $parts[$i - 1]++
                }
            }
            $newVersion = $parts -join '.'
        }
        $newParts = @($newVersion.Split('.') | ForEach-Object { [int]$_ })
        if (@($newParts | Where-Object { $_ -gt 65535 }).Count -gt 0 -or [version]$newVersion -le [version]$currentVersion) {
            throw "The new version '$newVersion' must be greater than $currentVersion and have components in 0..65535."
        }
    }

    $releaseManifest = $manifestContent
    $releasePopup = $popupContent
    if ($doVersionIncrease) {
        $releaseManifest = $manifestRegex.Replace($manifestContent, [System.Text.RegularExpressions.MatchEvaluator] {
            param($match)
            return "$($match.Groups[1].Value)$newVersion$($match.Groups[3].Value)"
        }, 1).Replace("`r`n", "`n")
        $releasePopup = $popupRegex.Replace($popupContent, [System.Text.RegularExpressions.MatchEvaluator] {
            param($match)
            return "$($match.Groups[1].Value)$newVersion$($match.Groups[4].Value)"
        }, 1).Replace("`r`n", "`n")
    }

    $outputRoot = if ($PSBoundParameters.ContainsKey('OutputDirectory')) {
        if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
            throw '-OutputDirectory cannot be empty.'
        }
        [System.IO.Path]::GetFullPath($OutputDirectory, $source)
    }
    else {
        Split-Path $source -Parent
    }
    $targetFolderName = 'OneClickPrompts Release'
    $destination = [System.IO.Path]::GetFullPath((Join-Path $outputRoot $targetFolderName))
    $zipPath = [System.IO.Path]::GetFullPath((Join-Path $outputRoot "$targetFolderName.zip"))
    $destinationPrefix = $destination.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if ($source -eq $destination -or $source.StartsWith($destinationPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'The release destination cannot be the source directory or an ancestor of it.'
    }

    # Git applies .gitignore correctly, including negations, without scanning excluded folders ourselves.
    $fileList = (Invoke-ReleaseGit -Arguments @('ls-files', '--cached', '--others', '--exclude-standard', '-z')) -join "`n"
    $relativeFiles = @($fileList -split "`0" | Where-Object {
        -not [string]::IsNullOrEmpty($_) -and -not (Test-ShouldExclude -RelativePath $_)
    } | Sort-Object -Unique)
    $filesToCopy = @(
        foreach ($relativePath in $relativeFiles) {
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $source $relativePath))
            if ($fullPath -eq $zipPath -or $fullPath.StartsWith($destinationPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                continue
            }
            if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
                throw "Release file is missing or is not a regular file: $relativePath"
            }
            $relativePath
        }
    )
    if ($filesToCopy -notcontains 'manifest.json' -or $filesToCopy -notcontains 'popup.html') {
        throw 'The release file list must include manifest.json and popup.html.'
    }

    # Only replace the named release artifacts, after checking the absolute destination.
    if (Test-Path -LiteralPath $destination) {
        $existingDestination = Get-Item -LiteralPath $destination -Force
        if (-not $existingDestination.PSIsContainer -or ($existingDestination.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing to replace a non-directory or linked release destination: $destination"
        }
        Remove-Item -LiteralPath $destination -Recurse -Force
    }
    if (Test-Path -LiteralPath $zipPath) {
        $existingZip = Get-Item -LiteralPath $zipPath -Force
        if ($existingZip.PSIsContainer -or ($existingZip.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing to replace a directory or linked ZIP path: $zipPath"
        }
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Write-ReleaseStatus "Building version $newVersion from $source ($($filesToCopy.Count) files)..."
    foreach ($relativePath in $filesToCopy) {
        $destinationPath = Join-Path $destination $relativePath
        New-Item -ItemType Directory -Path (Split-Path $destinationPath -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $source $relativePath) -Destination $destinationPath -Force
    }
    [System.IO.File]::WriteAllText((Join-Path $destination 'manifest.json'), $releaseManifest, $encoding)
    [System.IO.File]::WriteAllText((Join-Path $destination 'popup.html'), $releasePopup, $encoding)
    # Use literal filesystem paths; wildcard-based archiving breaks on names like "out [v1]".
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $destination, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false
    )

    # Do not bump source files unless the ZIP was built successfully.
    if ($doVersionIncrease) {
        # Keep the failure summary conservative if a write or rollback fails midway.
        $versionWritten = $true
        try {
            [System.IO.File]::WriteAllText($manifestPath, $releaseManifest, $encoding)
            [System.IO.File]::WriteAllText($popupPath, $releasePopup, $encoding)
        }
        catch {
            [System.IO.File]::WriteAllText($manifestPath, $manifestContent, $encoding)
            [System.IO.File]::WriteAllText($popupPath, $popupContent, $encoding)
            $versionWritten = $false
            throw
        }
    }
    if ($doCommit) {
        $commitMessage = "Version $newVersion"
        Invoke-ReleaseGit -Arguments @('add', '--', 'manifest.json', 'popup.html') | Out-Null
        Invoke-ReleaseGit -Arguments @('commit', '-m', $commitMessage, '--', 'manifest.json', 'popup.html') | Out-Null
        $committed = $true
        $commitHash = (Invoke-ReleaseGit -Arguments @('rev-parse', '--short', 'HEAD')) -join ''
    }

    $summary = [ordered]@{
        success = $true
        mode = $Mode
        previousVersion = $currentVersion
        version = $newVersion
        versionChanged = $versionWritten
        committed = $committed
        commitHash = $commitHash
        commitMessage = $commitMessage
        releaseDirectory = $destination
        zipPath = $zipPath
        fileCount = $filesToCopy.Count
    }
    if ($Json) {
        $summary | ConvertTo-Json -Compress
    }
    else {
        Write-ReleaseStatus "Release folder: $destination"
        Write-ReleaseStatus "ZIP: $zipPath"
        if ($committed) {
            Write-ReleaseStatus "Commit: $commitHash — $commitMessage"
        }
        Write-ReleaseStatus 'Process completed.'
    }
}
catch {
    if ($Json) {
        [ordered]@{
            success = $false
            mode = $Mode
            error = $_.Exception.Message
            previousVersion = $currentVersion
            version = $newVersion
            versionChanged = $versionWritten
            committed = $committed
            commitHash = $commitHash
            commitMessage = $commitMessage
            releaseDirectory = $destination
            zipPath = $zipPath
        } | ConvertTo-Json -Compress
    }
    else {
        Write-Error "Release failed: $($_.Exception.Message)" -ErrorAction Continue
    }
    exit 1
}
