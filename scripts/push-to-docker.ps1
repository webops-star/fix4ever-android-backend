<#
Simple helper script to build, tag and push the backend Docker image to Docker Hub.

Usage:
  # Run from Backend/ directory
  .\scripts\push-to-docker.ps1

This script will prompt for your Docker Hub username, image name and tag.
It assumes you have Docker installed and are already logged in via `docker login`.
#>

[CmdletBinding()]
param()

# Read values
$dockerHubUser = Read-Host "Docker Hub username (e.g. your-username)"
if ([string]::IsNullOrWhiteSpace($dockerHubUser)) {
  Write-Error "Docker Hub username is required."
  exit 1
}

$imageName = Read-Host "Image name (default: fix4ever-backend)"
if ([string]::IsNullOrWhiteSpace($imageName)) { $imageName = 'fix4ever-backend' }

$tag = Read-Host "Tag (default: latest)"
if ([string]::IsNullOrWhiteSpace($tag)) { $tag = 'latest' }

$localImage = "$imageName:$tag"
$remoteImage = "$dockerHubUser/$imageName:$tag"

Write-Host "Building local image $localImage..."
docker build -t $localImage .
if ($LASTEXITCODE -ne 0) { Write-Error "Docker build failed."; exit 1 }

Write-Host "Tagging image as $remoteImage..."
docker tag $localImage $remoteImage
if ($LASTEXITCODE -ne 0) { Write-Error "Docker tag failed."; exit 1 }

Write-Host "Make sure you're logged in to Docker Hub. If not, run: docker login"

Write-Host "Pushing $remoteImage to Docker Hub (this may take a while)..."
docker push $remoteImage
if ($LASTEXITCODE -ne 0) { Write-Error "Docker push failed."; exit 1 }

Write-Host "✅ Push complete. Image available as: $remoteImage"
Write-Host "You can view it in Docker Desktop (Images) or on https://hub.docker.com/r/$dockerHubUser/$imageName"
