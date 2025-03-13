# --------------------------- Configuration --------------------------- #

# Define exclusions
$excludedDirs = @('Promo')   # Additional directories to exclude
$excludedFiles = @('.gitignore', 'CI-CD.ps1', '.aider.chat.history.md', '.aider.input.history', 'notes.txt', 'instructions.txt')  # Files to exclude

# Define the source directory as the current working directory
$source = Get-Location

# Define the parent directory (one level up from the source)
$parent = Split-Path $source -Parent

# Define the target directory path
$targetFolderName = "OneClickPrompts Release"
$destination = Join-Path $parent $targetFolderName

# Define the ZIP file path
$zipFileName = "$targetFolderName.zip"
$zipPath = Join-Path $parent $zipFileName

# Initialize an array to track items that failed to copy
$failedCopies = @()

# --------------------------- Functions --------------------------- #

<#
.SYNOPSIS
    Determines whether a given file or directory should be excluded.

.DESCRIPTION
    The Test-ShouldExclude function calculates the relative path of the given FileSystemInfo object
    from the source directory and splits it into parts. If any part of the path (i.e., a directory name)
    starts with a dot or matches an entry in $excludedDirs, the item is excluded.
    Additionally, for files, it checks if the filename is in the $excludedFiles list.
#>
function Test-ShouldExclude {
    param (
        [System.IO.FileSystemInfo]$Item
    )

    # Get the relative path from the source directory
    $relativePath = $Item.FullName.Substring($source.Path.Length).TrimStart('\')
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
        return $false
    }

    # Split the path into parts
    $pathParts = $relativePath -split '\\'

    foreach ($part in $pathParts) {
        # Exclude if any part (directory) starts with a dot
        if ($part.StartsWith('.')) {
            Write-Verbose "Excluding due to dot-starting folder: $($Item.FullName)"
            return $true
        }
        # Exclude if the directory name matches one of the excluded directories
        if ($excludedDirs -contains $part) {
            Write-Verbose "Excluding due to matched excluded directory: $($Item.FullName)"
            return $true
        }
    }

    # If the item is a file and its name is in the list of excluded files, exclude it
    if (-not $Item.PSIsContainer -and $excludedFiles -contains $Item.Name) {
        Write-Verbose "Excluding file: $($Item.FullName)"
        return $true
    }

    return $false
}

# --------------------------- Main Script --------------------------- #

try {
    Write-Host "Starting the copy and archive process..."

    # ------------------- Purge Existing Destination Directory ------------------- #
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

    # ------------------- Gather Items to Copy ------------------- #
    Write-Host "Retrieving items to copy..."
    $itemsToCopy = Get-ChildItem -Path $source -Recurse -Force | Where-Object {
        -not (Test-ShouldExclude -Item $_)
    }

    # Report the found items to copy
    Write-Host "Found $($itemsToCopy.Count) items to copy:"
    foreach ($item in $itemsToCopy) {
        Write-Host " - $($item.FullName)"
    }

    # ------------------- Copy Items ------------------- #
    Write-Host "Starting copy process..."
    foreach ($item in $itemsToCopy) {
        # Determine the relative path and destination path for the current item
        $relativePath = $item.FullName.Substring($source.Path.Length).TrimStart("\")
        $destPath = Join-Path $destination $relativePath

        if ($item.PSIsContainer) {
            # For directories, ensure the destination directory exists
            if (-not (Test-Path -Path $destPath)) {
                try {
                    New-Item -ItemType Directory -Path $destPath -Force | Out-Null
                    Write-Host "Created directory: $destPath"
                }
                catch {
                    Write-Warning "Failed to create directory: $destPath"
                    $failedCopies += $destPath
                }
            }
        }
        else {
            # For files, ensure the destination directory exists and copy the file
            $destDir = Split-Path $destPath
            if (-not (Test-Path -Path $destDir)) {
                try {
                    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                    Write-Host "Created directory for file: $destDir"
                }
                catch {
                    Write-Warning "Failed to create directory for file: $destDir"
                    $failedCopies += $destDir
                    continue
                }
            }

            try {
                Copy-Item -Path $item.FullName -Destination $destPath -Force -ErrorAction Stop
                Write-Host "Copied file: $($item.FullName) -> $destPath"
            }
            catch {
                Write-Warning "Failed to copy file: $($item.FullName) -> $destPath"
                $failedCopies += $item.FullName
            }
        }
    }

    # ------------------- Copy Errors Report ------------------- #
    if ($failedCopies.Count -gt 0) {
        Write-Host "`nCopy process completed with errors."
        Write-Host "The following items were not copied successfully:"
        foreach ($failed in $failedCopies) {
            Write-Host " - $failed"
        }
    }
    else {
        Write-Host "`nAll items copied successfully."
    }

    # ------------------- Create ZIP Archive ------------------- #
    Write-Host "`nCreating ZIP archive..."
    Compress-Archive -Path "$destination\*" -DestinationPath $zipPath -Force
    Write-Host "ZIP archive created at: $zipPath"
}
catch {
    Write-Error "An unexpected error occurred: $_"
    exit 1  # Exit the script with an error code
}

# ------------------- Final Report and Exit ------------------- #
Write-Host "`nProcess completed. Press any key to exit."
Write-Host "Exiting in 5 seconds..."
Start-Sleep -Seconds 5
