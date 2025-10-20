# Electron Image Sorting App

Electron + Bootstrap (dark theme) app for sorting images quickly between folders with compare, prompts, and handy modals.

## Setup
1. Install dependencies: `npm install`
2. Run the app: `npm start`

## Key Features
- Image grid (left) with selection and batch move to a destination (right)
- Duplicate highlighting via MD5 hash
- Pan/Zoom image info modal (double-click an image)
  - Mouse wheel to zoom, drag to pan
  - Image fits the preview area by default and aligns the top edge
  - Middle-click closes any modal
- Compare images (select 2 with Ctrl+Click, then click Compare)
  - Side-by-side and Overlay modes
  - Shared pan/zoom controls
  - Right-click actions: Delete both images, or Send both to Image Editor
- Image info modal right-click actions
  - Delete this image (moves to Trash)
  - Send this image to Image Editor (launches configured editor with the file)
- Favorites for source and destination folders (with modal list)
- Sorting controls (date/size/name, asc/desc)
- Footer grid zoom controls

## Context Menus
- Grid item (right-click):
  - Mark/Unmark for compare
  - Delete Image (moves to Trash)
- Image info modal (right-click on preview):
  - Delete this image
  - Send this image to Image Editor
- Compare modal (right-click):
  - Delete both images
  - Send both images to Image Editor

## Preferences
- Default Trash Folder: where deleted images are moved
- Preferred Image Editor: choose an executable to open images with
  - Set via Preferences -> Select Program

## Sorting
- Click footer `Sort order` to choose sort by name/date/size and asc/desc
- Sort is persisted in config

## Favorites
- Heart buttons indicate if current source/destination is favorited
- Favorites modal lists, loads, and removes favorites

## Shortcuts
- Enter: Move selected images (when destination chosen)
- F5: Reload current image folder (keeps sort)
- Ctrl+Click grid tile: Mark for compare (max 2)
- Middle-click: Close the topmost open modal

## Backup Script (Windows)
- `backup.bat` at repo root creates a timestamped zip one directory above the project
- Excludes: `node_modules`, `dist`, `image_sorting_01`, and any dot-prefixed folders (e.g., `.git`, `.vs`, `.vscode`)
- Shows completion message and waits for key press
- The script is ignored by Git via `.gitignore`

## Other Notes
- Delete confirmation dialog now shows the current selected count accurately
- Deleted or moved grid items are visually marked and disabled

