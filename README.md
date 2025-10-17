# Image Sorting App

A powerful Electron-based desktop application for efficiently organizing and managing large collections of images. Perfect for photographers, digital artists, and anyone who needs to sort through hundreds or thousands of images quickly.

## Features

### Core Functionality
- **Dual-Panel Interface**: View source images on the left and destination folders on the right
- **Batch Operations**: Select and move multiple images at once
- **Smart Navigation**: Keyboard shortcuts for rapid workflow (Enter to move, F5 to refresh)
- **Visual Feedback**: Moved and deleted images are clearly marked to prevent confusion

### Image Management
- **Lazy Loading**: Efficiently handles large image collections with batched loading
- **Duplicate Detection**: Automatically identifies duplicate images using MD5 hashing
- **Multiple Sort Options**: Sort by name, date, or file size (ascending/descending)
- **Trash Management**: Safe deletion with configurable trash folder

### Advanced Features
- **Image Comparison**: 
  - Ctrl+Click to select two images for side-by-side comparison
  - Zoom and pan functionality
  - Overlay mode to highlight differences
  - Delete directly from comparison view

- **Favorites System**: 
  - Save frequently-used source and destination folders
  - Quick access via favorites modal
  - Separate tabs for image sources and destinations

- **Image Metadata Viewer**:
  - View dimensions, creation date, and file details
  - Extract and display AI image generation prompts (Stable Diffusion, etc.)
  - Parse key-value metadata from PNG/JPEG files
  - Full-screen modal for detailed inspection

- **Grid View Controls**:
  - Zoom in/out on thumbnail grid
  - Adjustable thumbnail sizes
  - Smooth scrolling with infinite load

### User Interface
- **Dark Theme**: Easy on the eyes during long sorting sessions
- **Bootstrap-Based**: Clean, modern, and responsive design
- **Context Menus**: Right-click for quick actions
  - **On Images**: Mark for comparison or delete
  - **On Folders**: Create folders, shortcuts, or symbolic links
- **Visual Selection**: Check-boxes and color-coded highlights
- **Keyboard Shortcuts**: 
  - `Enter` - Move selected images
  - `F5` - Refresh image list
  - `Ctrl+Click` - Mark for comparison
  - `Double-Click` - View image details

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/rob49152/image-sorting.git
   cd image-sorting
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the application**
   ```bash
   npm start
   ```

### Building for Distribution

**For automated builds with installers:**

```bash
npm run build
```

**Note for Windows users:** Building locally requires either:
- **Developer Mode enabled** (Settings ? Update & Security ? For developers), or
- **Running terminal as Administrator**

Alternatively, use the simpler packager:
```bash
npm run pack
```

Or use **GitHub Actions** to build automatically (see below).

This will create platform-specific builds in the `dist/` folder.

### Automated Releases via GitHub Actions

This project includes automated build workflows. To create a release:

```bash
# Update version and create tag
npm version patch  # or minor, or major
git push origin main --tags
```

GitHub Actions will automatically build installers for Windows, macOS, and Linux!

See [.github/WORKFLOWS.md](.github/WORKFLOWS.md) for details.

## Usage

### Getting Started

1. **Select Source Folder**: Click "Select Image Folder" to choose the folder containing images you want to sort
2. **Select Destination Folder**: Click "Select Destination Folder" to choose where sorted images will be organized
3. **Select Images**: Click on images to select them (checkbox appears when selected)
4. **Choose Subfolder**: Select a destination subfolder from the right panel
5. **Move Images**: Click "Move Selected" or press `Enter` to move images

### Comparison Workflow

1. **Ctrl+Click** on two images you want to compare
2. Blue highlight indicates images marked for comparison
3. Click the **Compare** button that appears
4. In comparison view:
   - Drag to pan
   - Mouse wheel to zoom
   - Click "Overlay" to see differences
   - Delete left or right image if desired

### Managing Favorites

1. Click the **heart icon** next to folder buttons to favorite current folder
2. Click **Favorites** button to view and manage saved folders
3. Click any favorite to instantly load that folder
4. Click the **X** to remove a favorite

### Folder Management

Right-click on any folder in the destination panel to:

1. **Create New Folder Here** - Quickly create a new subfolder
2. **Create Shortcut to Folder** - Create a Windows shortcut (.lnk) to any folder
   - Works without admin rights
   - Perfect for organizing frequently-used directories
3. **Create Symbolic Link** - Create a symbolic link to another folder
   - **Note**: On Windows, this requires either:
     - Administrator privileges (right-click app ? "Run as administrator")
     - Developer Mode enabled (Settings ? Update & Security ? For developers)
   - **Tip**: Use shortcuts instead if you don't have admin access!

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Move selected images to chosen destination |
| `F5` | Refresh current image list |
| `Ctrl+Click` | Mark image for comparison (max 2) |
| `Double-Click` | Open image detail modal |
| `Right-Click` | Open context menu |

## Configuration

The app stores configuration in your user data directory:
- **Windows**: `%APPDATA%\image-sorting\config.json`
- **macOS**: `~/Library/Application Support/image-sorting/config.json`
- **Linux**: `~/.config/image-sorting/config.json`

### Configurable Settings
- Last used image and destination folders
- Trash folder location
- Sort preferences (by name/date/size, asc/desc)
- Favorite folders lists

## Features in Detail

### Duplicate Detection
Images are hashed using MD5 as they load. Duplicates are highlighted with an orange border, making it easy to identify and remove redundant files.

### Safe Deletion
Deleted images aren't permanently removed—they're moved to a configurable trash folder. Set your trash folder in **Help ? Preferences**.

### Metadata Support
The app can extract and display:
- Image dimensions and creation date
- Stable Diffusion prompts (positive and negative)
- Key-value metadata pairs
- EXIF data from JPEG files
- Custom metadata from PNG tEXt chunks

### Shortcut/Symlink Support
On Windows, the app recognizes `.lnk` shortcut files in destination folders, automatically resolving them to their target directories.

## Technologies Used

- **Electron**: Cross-platform desktop framework
- **Bootstrap 5**: UI components and styling
- **Bootstrap Icons**: Icon set
- **Node.js**: Backend runtime
- **image-size**: Fast image dimension detection
- **exif-parser**: JPEG metadata extraction

## Troubleshooting

### Images not loading?
- Verify folder permissions
- Check that images are in supported formats (JPG, PNG, GIF, BMP)
- Press `F5` or click "Refresh list" to reload

### Can't move images?
- Ensure a destination folder is selected (radio button checked)
- Verify you have write permissions to the destination
- Check that destination folder still exists

### Comparison not working?
- Use `Ctrl+Click` (not regular click) to mark images
- Exactly 2 images must be marked before Compare button activates
- Check that images still exist (not moved/deleted)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is available for personal and commercial use. See LICENSE file for details.

## Acknowledgments

Built with ?? for anyone who's ever had to sort through thousands of AI-generated images or photo collections.

---

**Version**: 1.0  
**Author**: rob49152  
**Repository**: https://github.com/rob49152/image-sorting
