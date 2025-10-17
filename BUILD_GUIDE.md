# Quick Reference: GitHub Actions & Building

## Current Status ?

Your repository is now set up with:
- ? GitHub Actions workflow for automated builds
- ? electron-builder configured
- ? All code pushed to GitHub
- ? Documentation updated

## The Windows Build Issue

**Problem**: `electron-builder` needs permission to create symbolic links on Windows.

**Error**: `Cannot create symbolic link : A required privilege is not held by the client`

### Solutions (Pick One):

#### 1. Enable Developer Mode (Recommended)
- Open Settings (`Win + I`)
- Go to **Update & Security** ? **For developers**
- Enable **Developer Mode**
- Restart terminal and try again

#### 2. Run as Admin
- Right-click terminal ? **Run as Administrator**
- Then run `npm run build:win`

#### 3. Use Simple Packager
```bash
npm run pack
```
Creates a portable .exe without installers (works without admin)

#### 4. Use GitHub Actions Only
Don't build locally - just push tags and let GitHub build for you!

## How to Make a Release

### Method 1: Automatic (Recommended)

```bash
# Bump version (choose one):
npm version patch   # 1.0.0 ? 1.0.1 (bug fixes)
npm version minor   # 1.0.0 ? 1.1.0 (new features)
npm version major   # 1.0.0 ? 2.0.0 (breaking changes)

# Push everything
git push origin main --tags
```

**What happens:**
1. GitHub Actions detects the new tag
2. Builds Windows, macOS, and Linux versions (in parallel)
3. Creates a GitHub Release
4. Uploads all installers automatically
5. Generates release notes from your commits

**Time**: ~10-15 minutes

### Method 2: Manual

1. Go to https://github.com/rob49152/image-sorting/actions
2. Click "Build and Release"
3. Click "Run workflow"
4. Select branch and run

## Checking Build Status

### View Workflow Runs
https://github.com/rob49152/image-sorting/actions

### Download Artifacts (Test Builds)
Even without creating a release, you can download test builds:
1. Go to Actions tab
2. Click any completed workflow
3. Scroll to "Artifacts" section
4. Download builds (available for 30 days)

## What Gets Built

### Windows
- `Image-Sorting-App-Setup-*.exe` - NSIS installer (setup wizard)
- `Image-Sorting-App-*.exe` - Portable (no install)

### macOS
- `Image-Sorting-App-*.dmg` - Disk image (recommended)
- `Image-Sorting-App-mac.zip` - ZIP archive

### Linux
- `Image-Sorting-App-*.AppImage` - Universal (works everywhere)
- `image-sorting-app_*.deb` - Debian/Ubuntu
- `image-sorting-app-*.rpm` - RedHat/Fedora

## Testing Before Release

### Local Test (if you enabled Developer Mode):
```bash
npm run build:win
```

### Quick Test (always works):
```bash
npm run pack
```

### Full Test (all platforms):
```bash
npm run build-all
```
Note: Can only build for your current platform locally. Use GitHub Actions for cross-platform builds.

## Troubleshooting

### "Build failed on GitHub Actions"

**Check the logs:**
1. Go to Actions tab
2. Click the failed workflow
3. Click the failed job
4. Expand error sections

**Common causes:**
- Invalid `package.json` version format
- Missing dependencies
- Code signing issues (can be ignored for testing)

### "Release not created"

**Make sure:**
- Tag starts with `v` (e.g., `v1.0.0`)
- You pushed the tag: `git push origin --tags`
- Workflow completed successfully

### "Can't download artifacts"

**Artifacts expire after 30 days.** Create a proper release instead:
```bash
npm version patch
git push origin main --tags
```

## Next Steps

### For Testing
1. Enable Developer Mode (if you want to build locally)
2. Run `npm run build:win` to test
3. Find output in `dist/` folder

### For Your First Release
1. Make sure all features are working
2. Run: `npm version 1.0.0` (or your desired version)
3. Run: `git push origin main --tags`
4. Wait ~15 minutes
5. Check https://github.com/rob49152/image-sorting/releases

## Quick Commands

```bash
# Run app
npm start

# Build locally (needs Developer Mode on Windows)
npm run build

# Build portable version (always works)
npm run pack

# Create release (automatic GitHub build)
npm version patch && git push origin main --tags

# Check build status
# Visit: https://github.com/rob49152/image-sorting/actions
```

## Files You Can Customize

### Change app icon:
Place in `build/` folder:
- `build/icon.ico` (Windows)
- `build/icon.icns` (macOS)
- `build/icon.png` (Linux)

### Customize installer:
Edit `package.json` ? `build` section

### Modify workflow:
Edit `.github/workflows/build.yml`

## Documentation

- Full workflow guide: [.github/WORKFLOWS.md](.github/WORKFLOWS.md)
- GitHub Actions docs: https://docs.github.com/en/actions
- electron-builder docs: https://www.electron.build/

---

**Your repository is ready! ??**

Just enable Developer Mode (or use GitHub Actions) and you're all set to build and release!
