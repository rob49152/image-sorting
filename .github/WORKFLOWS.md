# GitHub Actions Workflows

This repository uses GitHub Actions for automated builds and releases.

## Build Workflow

**File**: `.github/workflows/build.yml`

### What it does
- Automatically builds the Electron app for Windows, macOS, and Linux
- Creates installers and portable versions
- Uploads build artifacts for download
- Creates GitHub releases with all installers attached

### When it runs
1. **Automatic**: When you push a version tag (e.g., `v1.0.0`, `v1.2.3`)
2. **Manual**: You can trigger it from the GitHub Actions tab

### How to create a new release

#### Option 1: Using Git Tags (Recommended)

```bash
# 1. Update version in package.json
npm version patch  # or minor, or major

# 2. Push the tag
git push origin main --tags

# 3. GitHub Actions will automatically:
#    - Build for all platforms
#    - Create a GitHub Release
#    - Upload installers
```

#### Option 2: Manual Trigger

1. Go to https://github.com/rob49152/image-sorting/actions
2. Click "Build and Release" workflow
3. Click "Run workflow"
4. Select branch and click "Run"

### What gets built

#### Windows
- `Image-Sorting-App-Setup-*.exe` - NSIS installer (with wizard)
- `Image-Sorting-App-*.exe` - Portable executable (no install needed)

#### macOS
- `Image-Sorting-App-*.dmg` - Disk image (drag-and-drop install)
- `Image-Sorting-App-mac.zip` - ZIP archive

#### Linux
- `Image-Sorting-App-*.AppImage` - Universal Linux package
- `image-sorting-app_*.deb` - Debian/Ubuntu package
- `image-sorting-app-*.rpm` - RedHat/Fedora/CentOS package

### Build artifacts

Even without creating a release, you can download build artifacts:
1. Go to https://github.com/rob49152/image-sorting/actions
2. Click on a completed workflow run
3. Scroll down to "Artifacts" section
4. Download the builds you need (available for 30 days)

### Environment variables

The workflow uses these secrets (automatically provided by GitHub):
- `GITHUB_TOKEN` - For creating releases and uploading assets

### Troubleshooting

**Build fails on macOS**
- macOS builds require code signing for notarization
- For unsigned builds, users need to right-click ? Open on first launch

**Build fails with "permission denied"**
- Check that `package.json` has valid version format (semantic versioning)
- Ensure repository has Actions enabled in Settings ? Actions

**Release not created**
- Make sure you pushed a tag starting with `v` (e.g., `v1.0.0`)
- Check workflow logs in the Actions tab

### Local testing

Before pushing a tag, test the build locally:

```bash
# Install electron-builder
npm install

# Build for your platform
npm run build

# Or build for all platforms
npm run build-all
```

## Version Management

We use semantic versioning (SemVer): `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (v2.0.0)
- **MINOR**: New features, backwards compatible (v1.1.0)
- **PATCH**: Bug fixes, backwards compatible (v1.0.1)

### Quick version bump commands

```bash
# Patch release (1.0.0 ? 1.0.1)
npm version patch -m "Bump version to %s"

# Minor release (1.0.0 ? 1.1.0)
npm version minor -m "Bump version to %s"

# Major release (1.0.0 ? 2.0.0)
npm version major -m "Bump version to %s"

# Then push
git push origin main --tags
```

## GitHub Release Features

Each release includes:
- ? All installers for Windows, macOS, and Linux
- ? Auto-generated release notes from commits
- ? Installation instructions
- ? File descriptions
- ? Source code (automatically included by GitHub)

## CI/CD Pipeline Overview

```
Push tag (v1.0.0)
    ?
GitHub Actions triggered
    ?
Build Job (parallel):
  ??? Windows runner ? builds .exe files
  ??? macOS runner   ? builds .dmg files
  ??? Linux runner   ? builds .AppImage, .deb, .rpm
    ?
Upload artifacts
    ?
Release Job:
  - Downloads all artifacts
  - Creates GitHub Release
  - Uploads all installers
  - Generates release notes
    ?
? Release published!
```

## Performance Notes

- **Build time**: ~10-15 minutes for all platforms
- **Parallel builds**: All platforms build simultaneously
- **Caching**: Node modules are cached for faster builds
- **Cost**: Free for public repositories (2000 minutes/month)

## Advanced Configuration

### Custom build options

Edit `package.json` ? `build` section to customize:
- App icons
- Installer behavior
- File associations
- Auto-update settings
- Code signing

### Adding code signing

For production apps, add these secrets in repository Settings ? Secrets:

**Windows**
- `CSC_LINK` - Path to .p12/.pfx certificate
- `CSC_KEY_PASSWORD` - Certificate password

**macOS**
- `CSC_LINK` - Path to Developer ID certificate
- `CSC_KEY_PASSWORD` - Certificate password
- `APPLE_ID` - Apple ID for notarization
- `APPLE_ID_PASSWORD` - App-specific password

Then update workflow to include:
```yaml
env:
  CSC_LINK: ${{ secrets.CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
```

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [electron-builder Documentation](https://www.electron.build/)
- [Semantic Versioning](https://semver.org/)
