#Requires -Version 7.0
# Run explicitly: pwsh -NoProfile -File ./tests/ci-cd.test.ps1
# Each case uses a disposable Git repository; nothing is released from the real checkout.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$suiteParent = Join-Path $repositoryRoot '.ci-cd-tests'
$suiteRoot = [System.IO.Path]::GetFullPath((Join-Path $suiteParent ([guid]::NewGuid().ToString('N'))))
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$releaseScriptContent = [System.IO.File]::ReadAllText((Join-Path $repositoryRoot 'CI-CD.ps1'), $utf8)
$popupTemplate = [System.IO.File]::ReadAllText((Join-Path $repositoryRoot 'popup.html'), $utf8)
$manifestTemplate = [System.IO.File]::ReadAllText((Join-Path $repositoryRoot 'manifest.json'), $utf8)
$sourceVersion = (ConvertFrom-Json $manifestTemplate).version
$ignoreTemplate = [System.IO.File]::ReadAllText((Join-Path $repositoryRoot '.gitignore'), $utf8)
$pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
$results = [System.Collections.Generic.List[object]]::new()
New-Item -ItemType Directory -Path $suiteRoot -Force | Out-Null

function Assert-ReleaseTest {
    param ([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Write-FixtureText {
    param ([string]$Path, [string]$Content)
    New-Item -ItemType Directory -Path (Split-Path $Path -Parent) -Force | Out-Null
    [System.IO.File]::WriteAllText($Path, $Content.Replace("`r`n", "`n"), $utf8)
}

function Invoke-TestGit {
    param ([string]$Root, [string[]]$Arguments)
    $output = @(& git -C $Root @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' '): $($output -join "`n")" }
    return $output
}

function New-ReleaseFixture {
    param ([string]$Name, [string]$InitialVersion = '0.0.8.3', [switch]$RealPayload)
    $fixture = Join-Path (Join-Path $suiteRoot $Name) 'repo'
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    if ($RealPayload) {
        $payloadFiles = (Invoke-TestGit $repositoryRoot @('ls-files', '--cached', '--others', '--exclude-standard', '-z')) -join "`n"
        foreach ($relativePath in ($payloadFiles -split "`0" | Sort-Object -Unique)) {
            if ([string]::IsNullOrEmpty($relativePath) -or $relativePath -match '^(Promo|tests|node_modules|coverage|\.)[/\\]' -or $relativePath -match '^\.') {
                continue
            }
            $copyPath = Join-Path $fixture $relativePath
            New-Item -ItemType Directory -Path (Split-Path $copyPath -Parent) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $repositoryRoot $relativePath) -Destination $copyPath
        }
        Write-FixtureText (Join-Path $fixture 'manifest.json') $manifestTemplate
    }
    else {
        Write-FixtureText (Join-Path $fixture 'manifest.json') (@{
            manifest_version = 3; name = 'CI-CD test fixture'; version = $InitialVersion
        } | ConvertTo-Json)
    }
    Write-FixtureText (Join-Path $fixture 'CI-CD.ps1') $releaseScriptContent
    $fixtureVersion = if ($RealPayload) { $sourceVersion } else { $InitialVersion }
    Write-FixtureText (Join-Path $fixture 'popup.html') $popupTemplate.Replace($sourceVersion, $fixtureVersion)
    Write-FixtureText (Join-Path $fixture '.gitignore') ($ignoreTemplate + "`n*.skip`n!keep.skip`n")
    foreach ($relativePath in @('agents.md', 'code-notes.md', 'package.json', 'package-lock.json', 'node_modules/dev.txt', 'tests/dev.txt', 'coverage/dev.txt', 'Promo/human.txt', '.private/secret.txt')) {
        Write-FixtureText (Join-Path $fixture $relativePath) 'Excluded fixture content'
    }
    Write-FixtureText (Join-Path $fixture 'payload.js') 'globalThis.releaseFixture = true;'
    Write-FixtureText (Join-Path $fixture 'assets/extra [1] α.txt') "Привет 🙂`n"
    Invoke-TestGit $fixture @('init', '--quiet', '-b', 'release-tests') | Out-Null
    Invoke-TestGit $fixture @('config', 'user.name', 'CI-CD Tests') | Out-Null
    Invoke-TestGit $fixture @('config', 'user.email', 'release-tests@example.invalid') | Out-Null
    Invoke-TestGit $fixture @('config', 'commit.gpgSign', 'false') | Out-Null
    Invoke-TestGit $fixture @('config', 'core.autocrlf', 'false') | Out-Null
    Invoke-TestGit $fixture @('config', 'core.hooksPath', '.git/hooks') | Out-Null
    Invoke-TestGit $fixture @('add', '--force', '--', '.') | Out-Null
    Invoke-TestGit $fixture @('commit', '--quiet', '-m', 'CI-CD fixture baseline') | Out-Null
    return $fixture
}

function Invoke-FixtureRelease {
    param ([string]$Root, [string[]]$Arguments = @(), [switch]$HumanOutput)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new($pwshPath)
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.StandardOutputEncoding = $utf8
    $startInfo.StandardErrorEncoding = $utf8
    $startInfo.WorkingDirectory = $suiteRoot # Deliberately different from the script's directory.
    foreach ($argument in @('-NoProfile', '-NonInteractive', '-File', (Join-Path $Root 'CI-CD.ps1')) + $Arguments) {
        $startInfo.ArgumentList.Add($argument)
    }
    if (-not $HumanOutput) { $startInfo.ArgumentList.Add('-Json') }
    $process = [System.Diagnostics.Process]::Start($startInfo)
    try {
        $process.StandardInput.Close()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(20000)) {
            $process.Kill($true)
            throw 'Release command timed out instead of completing without interaction.'
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
        $stderr = $stderrTask.GetAwaiter().GetResult().Trim()
        $summary = if ($HumanOutput) { $null } else { ConvertFrom-Json -InputObject $stdout }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Summary = $summary; Stdout = $stdout; Stderr = $stderr }
    }
    finally { $process.Dispose() }
}

function Assert-ReleaseSuccess {
    param ($Run)
    Assert-ReleaseTest ($Run.ExitCode -eq 0 -and $Run.Summary.success) "Release failed: $($Run.Stdout) $($Run.Stderr)"
    Assert-ReleaseTest ([string]::IsNullOrEmpty($Run.Stderr)) "Unexpected stderr: $($Run.Stderr)"
}

function Assert-ReleaseFailure {
    param ($Run, [string]$MessagePattern)
    Assert-ReleaseTest ($Run.ExitCode -eq 1 -and -not $Run.Summary.success) "Expected failure, got: $($Run.Stdout)"
    Assert-ReleaseTest ($Run.Summary.error -match $MessagePattern) "Unexpected error: $($Run.Summary.error)"
}

function Get-FixtureVersion {
    param ([string]$Root)
    return (ConvertFrom-Json ([System.IO.File]::ReadAllText((Join-Path $Root 'manifest.json'), $utf8))).version
}

function Get-FixtureHead {
    param ([string]$Root)
    return (Invoke-TestGit $Root @('rev-parse', 'HEAD')) -join ''
}

function Read-ZipEntry {
    param ($Entry)
    $reader = [System.IO.StreamReader]::new($Entry.Open(), $utf8)
    try { return $reader.ReadToEnd() }
    finally { $reader.Dispose() }
}

function Assert-ReleaseArchive {
    param ($Summary, [string]$ExpectedVersion, [switch]$RealPayload)
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Summary.zipPath)
    try {
        $entryNames = @($archive.Entries.FullName)
        Assert-ReleaseTest ($entryNames -contains 'manifest.json' -and $entryNames -contains 'popup.html') 'ZIP has an extra root folder or is missing required files.'
        Assert-ReleaseTest ($entryNames.Count -eq $Summary.fileCount) 'Reported file count differs from the ZIP.'
        foreach ($name in $entryNames) {
            Assert-ReleaseTest ($name -notmatch '(^|/)(Promo|node_modules|tests|coverage|\.[^/]*)(/|$)' -and $name -notmatch '(^|/)(CI-CD\.ps1|agents\.md|code-notes\.md|package(?:-lock)?\.json)$') "Excluded file leaked into ZIP: $name"
        }
        $manifest = ConvertFrom-Json (Read-ZipEntry ($archive.GetEntry('manifest.json')))
        Assert-ReleaseTest ($manifest.version -eq $ExpectedVersion) 'ZIP manifest has the wrong version.'
        $popup = Read-ZipEntry ($archive.GetEntry('popup.html'))
        Assert-ReleaseTest ($popup -eq $popupTemplate.Replace($sourceVersion, $ExpectedVersion).Replace("`r`n", "`n")) 'Popup content or its encoding changed beyond the version.'
        Assert-ReleaseTest ((Read-ZipEntry ($archive.GetEntry('assets/extra [1] α.txt'))) -eq "Привет 🙂`n") 'Unicode content or a filename containing spaces/brackets was corrupted.'
        if ($RealPayload) {
            $references = @($manifest.background.service_worker, $manifest.action.default_popup, $manifest.options_page)
            $references += @($manifest.icons.PSObject.Properties.Value)
            foreach ($contentScript in $manifest.content_scripts) { $references += @($contentScript.js) + @($contentScript.css) }
            foreach ($resourceGroup in $manifest.web_accessible_resources) { $references += @($resourceGroup.resources) }
            foreach ($reference in $references) {
                Assert-ReleaseTest ($entryNames -contains $reference.TrimStart('/')) "Manifest resource missing from the real payload ZIP: $reference"
            }
        }
    }
    finally { $archive.Dispose() }
}

function Test-ReleaseCase {
    param ([string]$Name, [scriptblock]$Body)
    try {
        & $Body
        $results.Add([pscustomobject]@{ Name = $Name; Passed = $true })
        Write-Host "PASS $Name"
    }
    catch {
        $results.Add([pscustomobject]@{ Name = $Name; Passed = $false })
        Write-Host "FAIL $Name — $($_.Exception.Message)"
    }
}

try {
    Test-ReleaseCase 'PowerShell syntax' {
        $tokens = $null; $parseErrors = $null
        [System.Management.Automation.Language.Parser]::ParseInput($releaseScriptContent, [ref]$tokens, [ref]$parseErrors) | Out-Null
        Assert-ReleaseTest ($parseErrors.Count -eq 0) ($parseErrors -join "`n")
    }
    Test-ReleaseCase 'Build real payload from another working directory' {
        $root = New-ReleaseFixture 'real-payload' -RealPayload
        $head = Get-FixtureHead $root
        $popupBefore = (Get-FileHash -LiteralPath (Join-Path $root 'popup.html')).Hash
        $run = Invoke-FixtureRelease $root @('-Mode', 'Build', '-OutputDirectory', '.release')
        Assert-ReleaseSuccess $run
        Assert-ReleaseArchive $run.Summary $sourceVersion -RealPayload
        Assert-ReleaseTest (-not $run.Summary.versionChanged -and -not $run.Summary.committed) 'Build reported version/Git changes.'
        Assert-ReleaseTest ((Get-FixtureHead $root) -eq $head -and (Get-FixtureVersion $root) -eq $sourceVersion) 'Build changed source history/version.'
        Assert-ReleaseTest ((Get-FileHash -LiteralPath (Join-Path $root 'popup.html')).Hash -eq $popupBefore) 'Build rewrote the source popup.'
        Assert-ReleaseTest ($run.Summary.zipPath.StartsWith((Join-Path $root '.release'))) 'Relative output directory was resolved against the wrong working directory.'
    }
    Test-ReleaseCase 'Release increments and commits exactly the two version files' {
        $root = New-ReleaseFixture 'release'
        $run = Invoke-FixtureRelease $root @('-Mode', 'Release', '-OutputDirectory', '.release')
        Assert-ReleaseSuccess $run
        Assert-ReleaseArchive $run.Summary '0.0.8.4'
        Assert-ReleaseTest ($run.Summary.committed -and $run.Summary.versionChanged) 'Release did not commit/bump.'
        $changedFiles = @(Invoke-TestGit $root @('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'))
        Assert-ReleaseTest (($changedFiles -join ',') -eq 'manifest.json,popup.html') "Unexpected commit files: $changedFiles"
        Assert-ReleaseTest (((Invoke-TestGit $root @('log', '-1', '--format=%s')) -join '') -eq 'Version 0.0.8.4') 'Wrong release commit message.'
        Assert-ReleaseTest ($run.Summary.commitMessage -eq 'Version 0.0.8.4' -and $run.Summary.commitHash -eq ((Invoke-TestGit $root @('rev-parse', '--short', 'HEAD')) -join '')) 'JSON commit identity is wrong.'
        Assert-ReleaseTest ((Get-FixtureVersion $root) -eq '0.0.8.4' -and @(Invoke-TestGit $root @('status', '--porcelain')).Count -eq 0) 'Release did not leave a clean fixture.'
    }
    Test-ReleaseCase 'Explicit version release' {
        $root = New-ReleaseFixture 'explicit'
        $run = Invoke-FixtureRelease $root @('-Mode', 'Release', '-Version', '0.1.0.0', '-OutputDirectory', '.release')
        Assert-ReleaseSuccess $run
        Assert-ReleaseArchive $run.Summary '0.1.0.0'
        Assert-ReleaseTest ((Get-FixtureVersion $root) -eq '0.1.0.0') 'Explicit version was not applied.'
    }
    Test-ReleaseCase 'Bump builds without a Git commit' {
        $root = New-ReleaseFixture 'bump'; $head = Get-FixtureHead $root
        $run = Invoke-FixtureRelease $root @('-Mode', 'Bump', '-OutputDirectory', '.release')
        Assert-ReleaseSuccess $run
        Assert-ReleaseArchive $run.Summary '0.0.8.4'
        Assert-ReleaseTest (-not $run.Summary.committed -and $run.Summary.versionChanged -and (Get-FixtureHead $root) -eq $head) 'Bump committed or did not update versions.'
        $bytes = [System.IO.File]::ReadAllBytes((Join-Path $root 'popup.html'))
        Assert-ReleaseTest (-not ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) -and $bytes -notcontains 13) 'Version write introduced a BOM or CRLF.'
    }
    Test-ReleaseCase 'Decimal carry across one and multiple components' {
        foreach ($pair in @(@('0.0.8.9', '0.0.9.0'), @('0.0.9.9', '0.1.0.0'))) {
            $root = New-ReleaseFixture "carry-$($pair[0])" -InitialVersion $pair[0]
            $run = Invoke-FixtureRelease $root @('-Mode', 'Bump', '-OutputDirectory', '.release')
            Assert-ReleaseSuccess $run
            Assert-ReleaseArchive $run.Summary $pair[1]
        }
    }
    Test-ReleaseCase 'Rebuild replaces stale output without packaging itself' {
        $root = New-ReleaseFixture 'rebuild'
        $first = Invoke-FixtureRelease $root @('-Mode', 'Build', '-OutputDirectory', '.release'); Assert-ReleaseSuccess $first
        Write-FixtureText (Join-Path $first.Summary.releaseDirectory 'obsolete.txt') 'Stale output'
        $second = Invoke-FixtureRelease $root @('-Mode', 'Build', '-OutputDirectory', '.release'); Assert-ReleaseSuccess $second
        Assert-ReleaseArchive $second.Summary '0.0.8.3'
        Assert-ReleaseTest (-not (Test-Path -LiteralPath (Join-Path $second.Summary.releaseDirectory 'obsolete.txt'))) 'Stale output survived the rebuild.'
    }
    Test-ReleaseCase 'Gitignore negations and untracked runtime assets' {
        $root = New-ReleaseFixture 'gitignore'
        Write-FixtureText (Join-Path $root 'ignored.skip') 'Ignored'
        Write-FixtureText (Join-Path $root 'keep.skip') 'Included by negation'
        Write-FixtureText (Join-Path $root 'new-runtime.js') 'New untracked runtime'
        $run = Invoke-FixtureRelease $root @('-Mode', 'Build', '-OutputDirectory', '.release'); Assert-ReleaseSuccess $run
        $archive = [System.IO.Compression.ZipFile]::OpenRead($run.Summary.zipPath)
        try { Assert-ReleaseTest ($null -eq $archive.GetEntry('ignored.skip') -and $null -ne $archive.GetEntry('keep.skip') -and $null -ne $archive.GetEntry('new-runtime.js')) 'Gitignore/untracked inclusion was not respected.' }
        finally { $archive.Dispose() }
    }
    Test-ReleaseCase 'Legacy default output location' {
        $root = New-ReleaseFixture 'default-output'
        $run = Invoke-FixtureRelease $root @('-Mode', 'Build'); Assert-ReleaseSuccess $run
        Assert-ReleaseTest ($run.Summary.zipPath -eq (Join-Path (Split-Path $root -Parent) 'OneClickPrompts Release.zip')) 'Default output location changed.'
    }
    Test-ReleaseCase 'Output directory containing spaces and brackets' {
        $root = New-ReleaseFixture 'bracket-output'
        $run = Invoke-FixtureRelease $root @('-Mode', 'Build', '-OutputDirectory', '.release/out [v1]'); Assert-ReleaseSuccess $run
        Assert-ReleaseArchive $run.Summary '0.0.8.3'
    }
    Test-ReleaseCase 'Source directory containing spaces and brackets' {
        $root = New-ReleaseFixture 'source [v2]'
        $run = Invoke-FixtureRelease $root @('-Mode', 'Release', '-OutputDirectory', '.release'); Assert-ReleaseSuccess $run
        Assert-ReleaseArchive $run.Summary '0.0.8.4'
    }
    Test-ReleaseCase 'Human-readable non-interactive build' {
        $root = New-ReleaseFixture 'human-output'
        $run = Invoke-FixtureRelease $root @('-Mode', 'Build', '-OutputDirectory', '.release') -HumanOutput
        Assert-ReleaseTest ($run.ExitCode -eq 0 -and $run.Stdout.Contains('Process completed.') -and $run.Stdout.Contains('ZIP:')) 'Human build output failed.'
    }
    Test-ReleaseCase 'Missing mode fails immediately without a prompt' {
        $root = New-ReleaseFixture 'missing-mode'
        Assert-ReleaseFailure (Invoke-FixtureRelease $root) 'Specify -Mode'
    }
    Test-ReleaseCase 'Dirty/staged work is preserved and blocks Release' {
        foreach ($staged in @($false, $true)) {
            $root = New-ReleaseFixture "dirty-$staged"; $head = Get-FixtureHead $root
            Write-FixtureText (Join-Path $root 'payload.js') 'Unrelated work'
            if ($staged) { Invoke-TestGit $root @('add', '--', 'payload.js') | Out-Null }
            $statusBefore = (Invoke-TestGit $root @('status', '--porcelain')) -join "`n"
            $run = Invoke-FixtureRelease $root @('-Mode', 'Release', '-OutputDirectory', '.release')
            Assert-ReleaseFailure $run 'clean working tree'
            Assert-ReleaseTest ((Get-FixtureHead $root) -eq $head -and (Get-FixtureVersion $root) -eq '0.0.8.3' -and ((Invoke-TestGit $root @('status', '--porcelain')) -join "`n") -eq $statusBefore) 'Dirty or staged work was altered.'
        }
    }
    Test-ReleaseCase 'Detached HEAD blocks Release' {
        $root = New-ReleaseFixture 'detached'
        Invoke-TestGit $root @('checkout', '--quiet', '--detach', 'HEAD') | Out-Null
        Assert-ReleaseFailure (Invoke-FixtureRelease $root @('-Mode', 'Release', '-OutputDirectory', '.release')) 'detached'
    }
    Test-ReleaseCase 'Invalid, equal, lower, and overflowing versions are rejected' {
        $root = New-ReleaseFixture 'invalid-versions'
        foreach ($version in @('0.0.8.3', '0.0.8.2', 'banana', '0.1.0', '0.01.0.0', '0.0.65536.0')) {
            $run = Invoke-FixtureRelease $root @('-Mode', 'Bump', '-Version', $version, '-OutputDirectory', '.release')
            Assert-ReleaseFailure $run 'four integer|greater than'
            Assert-ReleaseTest ((Get-FixtureVersion $root) -eq '0.0.8.3' -and -not $run.Summary.versionChanged) 'Invalid version changed the source.'
        }
        Assert-ReleaseFailure (Invoke-FixtureRelease $root @('-Mode', 'Build', '-Version', '0.0.8.4')) 'cannot be combined'
    }
    Test-ReleaseCase 'Version mismatch and missing popup label fail before writes' {
        $popupCase = 0
        foreach ($replacement in @('Version<br>0.0.8.2', 'Version label removed')) {
            $root = New-ReleaseFixture "bad-popup-$popupCase"
            $popupCase++
            Write-FixtureText (Join-Path $root 'popup.html') $popupTemplate.Replace($sourceVersion, '0.0.8.3').Replace('Version<br>0.0.8.3', $replacement)
            $before = (Get-FileHash -LiteralPath (Join-Path $root 'popup.html')).Hash
            $run = Invoke-FixtureRelease $root @('-Mode', 'Bump', '-OutputDirectory', '.release')
            Assert-ReleaseFailure $run 'Version mismatch|unique version label'
            Assert-ReleaseTest ((Get-FixtureVersion $root) -eq '0.0.8.3' -and (Get-FileHash -LiteralPath (Join-Path $root 'popup.html')).Hash -eq $before) 'Invalid popup caused partial version writes.'
        }
    }
    Test-ReleaseCase 'Missing payload fails without bumping the source' {
        $root = New-ReleaseFixture 'missing-payload'
        Remove-Item -LiteralPath (Join-Path $root 'payload.js')
        $run = Invoke-FixtureRelease $root @('-Mode', 'Bump', '-OutputDirectory', '.release')
        Assert-ReleaseFailure $run 'missing or is not a regular file'
        Assert-ReleaseTest ((Get-FixtureVersion $root) -eq '0.0.8.3' -and -not $run.Summary.versionChanged) 'Packaging failure bumped the source.'
    }
    Test-ReleaseCase 'Unsafe ancestor output is refused' {
        $root = New-ReleaseFixture 'unsafe/OneClickPrompts Release'
        $outputRoot = Split-Path (Split-Path $root -Parent) -Parent
        $run = Invoke-FixtureRelease $root @('-Mode', 'Bump', '-OutputDirectory', $outputRoot)
        Assert-ReleaseFailure $run 'ancestor'
        Assert-ReleaseTest ((Test-Path -LiteralPath (Join-Path $root 'CI-CD.ps1')) -and (Get-FixtureVersion $root) -eq '0.0.8.3') 'Unsafe output damaged source files.'
    }
    Test-ReleaseCase 'Commit failure reports built artifacts and changed versions honestly' {
        $root = New-ReleaseFixture 'commit-failure'; $head = Get-FixtureHead $root
        Write-FixtureText (Join-Path $root '.git/hooks/pre-commit') "#!/bin/sh`nexit 1`n"
        $run = Invoke-FixtureRelease $root @('-Mode', 'Release', '-OutputDirectory', '.release')
        Assert-ReleaseFailure $run 'git commit.*failed'
        Assert-ReleaseTest ($run.Summary.versionChanged -and -not $run.Summary.committed -and (Get-FixtureHead $root) -eq $head -and (Get-FixtureVersion $root) -eq '0.0.8.4' -and (Test-Path -LiteralPath $run.Summary.zipPath)) 'Commit failure hid its partial side effects.'
    }
}
finally {
    # Verify the exact owned GUID directory before recursively deleting disposable repositories.
    $resolvedSuiteRoot = [System.IO.Path]::GetFullPath($suiteRoot)
    $allowedPrefix = [System.IO.Path]::GetFullPath($suiteParent).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedSuiteRoot.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolvedSuiteRoot -Leaf) -notmatch '^[a-f0-9]{32}$') {
        throw "Unsafe test cleanup path: $resolvedSuiteRoot"
    }
    Remove-Item -LiteralPath $resolvedSuiteRoot -Recurse -Force
}

$failed = @($results | Where-Object { -not $_.Passed })
Write-Host "`n$($results.Count - $failed.Count)/$($results.Count) release test cases passed."
if ($failed.Count -gt 0) { exit 1 }
