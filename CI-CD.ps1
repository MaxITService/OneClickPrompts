# --------------------------- Configuration --------------------------- #

# Define exclusions
$excludedDirs = @('.vscode', '.git', '.archive', 'Promo')     # Added '.Promo' to exclude this folder
$excludedFiles = @('.gitignore', 'CI-CD.ps1')                # Files to exclude

# Define the source directory as the current working directory
$source = Get-Location

# Define the parent directory (one level up from the current directory)
$parent = Split-Path $source -Parent

# Define the target directory path
$targetFolderName = "ChatGPT Quick Buttons For Your Text Release"
$destination = Join-Path $parent $targetFolderName

# Define the ZIP file path
$zipFileName = "$targetFolderName.zip"
$zipPath = Join-Path $parent $zipFileName

# Initialize an array to track files that failed to copy
$failedCopies = @()

# --------------------------- Functions --------------------------- #

<#
.SYNOPSIS
    Determines whether a given file or directory should be excluded based on predefined exclusion lists.

.DESCRIPTION
    The Test-ShouldExclude function checks if the provided FileSystemInfo object matches any of the excluded directories or files.
    It performs case-insensitive comparisons and ensures that excluded directories and their subdirectories are appropriately handled.

.PARAMETER Item
    The FileSystemInfo object representing the file or directory to be evaluated.

.EXAMPLE
    Test-ShouldExclude -Item (Get-Item "C:\Projects\MyApp\.git")

    Returns $true if the item is an excluded directory or file; otherwise, returns $false.
#>
function Test-ShouldExclude {
    param (
        [System.IO.FileSystemInfo]$Item
    )

    # Normalize paths for case-insensitive comparison
    $itemPathLower = $Item.FullName.ToLower()
    $sourcePathLower = $source.Path.ToLower()

    # Check if the item is within any of the excluded directories
    foreach ($exDir in $excludedDirs) {
        $exDirLower = $exDir.ToLower()


        if ($Item.PSIsContainer) {
            # If the item is a directory, check for exact match or if it's a subdirectory
            $excludedDirFullPath = (Join-Path $sourcePathLower $exDirLower).ToLower()
            if ($itemPathLower -eq $excludedDirFullPath -or
                $itemPathLower -like "*\$exDirLower\*") {
                Write-Verbose "Excluding directory: $($Item.FullName)"
                return $true
            }
        }
        else {
            # If the item is a file, check if its parent directory is excluded
            $parentDirLower = $Item.DirectoryName.ToLower()
            $excludedDirFullPath = (Join-Path $sourcePathLower $exDirLower).ToLower()
            if ($parentDirLower -eq $excludedDirFullPath -or
                $parentDirLower -like "*\$exDirLower\*") {
                Write-Verbose "Excluding file within excluded directory: $($Item.FullName)"
                return $true
            }
        }
    }

    # Check if the item is an excluded file
    if (-not $Item.PSIsContainer -and $excludedFiles -contains $Item.Name) {
        Write-Verbose "Excluding file: $($Item.FullName)"
        return $true
    }

    return $false
}

# --------------------------- Main Script --------------------------- #

try {
    # ------------------- Purge Existing Destination ------------------- #
    if (Test-Path -Path $destination) {
        Write-Host "Purging existing destination directory: $destination"
        try {
            Remove-Item -Path $destination -Recurse -Force -ErrorAction Stop
            Write-Host "Successfully purged the destination directory."
        }
        catch {
            Write-Error "Failed to purge the destination directory: $destination"
            throw $_  # Exit the script if purge fails
        }
    }

    # Create the destination directory
    Write-Host "Creating destination directory: $destination"
    New-Item -ItemType Directory -Path $destination -Force | Out-Null

    # Retrieve all items from the source, excluding specified folders and files
    Write-Host "Retrieving items to copy..."
    $itemsToCopy = Get-ChildItem -Path $source -Recurse -Force | Where-Object {
        -not (Test-ShouldExclude -Item $_)
    }

    # Optional: Output the items to be copied for verification
    Write-Host "Items to be copied:"
    foreach ($item in $itemsToCopy) {
        Write-Host " - $($item.FullName)"
    }

    # Copy each item to the destination
    Write-Host "Starting copy process..."
    foreach ($item in $itemsToCopy) {
        # Determine the destination path
        $relativePath = $item.FullName.Substring($source.Path.Length).TrimStart("\")
        $destPath = Join-Path $destination $relativePath

        if ($item.PSIsContainer) {
            # It's a directory; ensure it exists
            if (-not (Test-Path -Path $destPath)) {
                try {
                    New-Item -ItemType Directory -Path $destPath -Force | Out-Null
                    Write-Verbose "Created directory: $destPath"
                }
                catch {
                    Write-Warning "Failed to create directory: $destPath"
                    $failedCopies += $destPath
                }
            }
        }
        else {
            # It's a file; copy and overwrite if necessary
            $destDir = Split-Path $destPath
            if (-not (Test-Path -Path $destDir)) {
                try {
                    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                    Write-Verbose "Created directory for file: $destDir"
                }
                catch {
                    Write-Warning "Failed to create directory for file: $destDir"
                    $failedCopies += $destDir
                    continue
                }
            }

            try {
                Copy-Item -Path $item.FullName -Destination $destPath -Force -ErrorAction Stop
                Write-Verbose "Copied file: $($item.FullName) to $destPath"
            }
            catch {
                Write-Warning "Failed to copy file: $($item.FullName) to $destPath"
                $failedCopies += $item.FullName
            }
        }
    }

    # Report any failed copy operations
    if ($failedCopies.Count -gt 0) {
        Write-Host "`nCopy Process Completed with Errors."
        Write-Host "The following items were not copied successfully:"
        $failedCopies | ForEach-Object { Write-Host " - $_" }
    }
    else {
        Write-Host "`nAll files copied successfully."
    }

    # Compress the target directory into a ZIP file
    Write-Host "`nCreating ZIP archive..."
    Compress-Archive -Path "$destination\*" -DestinationPath $zipPath -Force

    Write-Host "ZIP archive created at: $zipPath"

}
catch {
    Write-Error "An unexpected error occurred: $_"
    exit 1  # Exit the script with an error code
}

# --------------------------- Exit Prompt --------------------------- #

Write-Host "`nProcess completed. Press any key to exit."

# Exiting in 5 seconds:
Write-Host "Exiting in 5 seconds..."
Start-Sleep -Seconds 5
