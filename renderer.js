// --- Key-Value Info Display (from test.js) ---
function parseKeyValueHTML(str) {
  if (!str || typeof str !== 'string') return '';
  const pairs = str.split(',');
  const clipSkipIdx = pairs.findIndex(pair => pair.trim().toLowerCase().startsWith('clip skip'));
  const displayPairs = clipSkipIdx >= 0 ? pairs.slice(0, clipSkipIdx + 1) : pairs;
  let html = '<div style="display: flex; flex-wrap: wrap; gap: 1em;">';
  for (let i = 0; i < displayPairs.length; i += 2) {
    html += '<div style="flex: 1 1 45%; min-width: 250px; display: flex; flex-direction: column; gap: 0.5em;">';
    for (let j = i; j < i + 2 && j < displayPairs.length; j++) {
      const [key, ...rest] = displayPairs[j].split(':');
      if (!key) continue;
      const value = rest.join(':').trim();
      html += `<div><strong>${key.trim()}:</strong> <span><input type="text" value="${value}" /></span></div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}
const { ipcRenderer } = require('electron');
const crypto = require('crypto');
let imageFolder = '';
let dirFolder = '';
let selectedImages = new Set();
let selectedDir = '';
let trashFolder = '';
let images = [];
let loadedCount = 0;
const LOAD_BATCH = 35;
let sortBy = 'name';
let sortOrder = 'asc';
let imageHashes = {};
let duplicateHashes = new Set();
// Compare selection set (max 2)
let compareSelected = new Set();
// Config must be declared before any helper uses it
let config = {};
// Zoom level for grid controls
let zoomLevel = 1;

// Forward declare to avoid ReferenceError before full implementation is defined later
function openCompareModal() { /* initialized later */ }

// Inject minimal style for compare selection highlight
(function ensureCompareStyle(){
  const styleId = 'compare-select-style';
  if (!document.getElementById(styleId)){
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = '.image-item.compare-selected{background-color:#0d6efd55;border-radius:6px;}';
    document.head.appendChild(s);
  }
})();

// Close any visible modal on middle mouse click without affecting other logic
(function enableMiddleClickClose(){
  if (document._midClickCloseBound) return;
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return; // only middle mouse button
    const modalEl = e.target && (e.target.closest ? e.target.closest('.modal.show') : null);
    if (!modalEl) return;
    try {
      const m = bootstrap.Modal.getOrCreateInstance(modalEl);
      m.hide();
      e.preventDefault();
      e.stopPropagation();
    } catch {}
  }, true); // capture to ensure it runs before other handlers
  document._midClickCloseBound = true;
})();

// Inject minimal style for deleted items background
(function ensureDeletedStyle(){
  const styleId = 'deleted-item-style';
  if (!document.getElementById(styleId)){
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = '.image-item.deleted{background-color:#8B0000 !important;}';
    document.head.appendChild(s);
  }
})();

// Inject minimal style for moved items background (dark green)
(function ensureMovedStyle(){
  const styleId = 'moved-item-style';
  if (!document.getElementById(styleId)){
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = '.image-item.moved{background-color:#006400 !important;}';
    document.head.appendChild(s);
  }
})();

function getCompareBtn(){
  return document.getElementById('compare-btn');
}
function updateCompareButton(){
  const btn = getCompareBtn();
  if (!btn) return;
  const ok = compareSelected.size === 2;
  btn.disabled = !ok;
  btn.className = ok ? 'btn btn-primary me-2' : 'btn btn-secondary me-2';
}
function toggleCompareSelection(item, img){
  if (compareSelected.has(img)){
    compareSelected.delete(img);
    item.classList.remove('compare-selected');
  } else {
    if (compareSelected.size >= 2) {
      // Max 2, ignore additional selections
      return;
    }
    compareSelected.add(img);
    item.classList.add('compare-selected');
  }
  updateCompareButton();
}

// Clear all compare selections and UI highlights
function clearCompareSelection() {
  for (const img of compareSelected) {
    const el = document.querySelector(`.image-item[data-img='${img}']`);
    if (el) el.classList.remove('compare-selected');
  }
  compareSelected.clear();
  updateCompareButton();
}

function sortImagesList() {
  if (!images || images.length === 0) return;
  if (sortBy === 'name') {
    images.sort((a, b) => sortOrder === 'asc' ? a.localeCompare(b) : b.localeCompare(a));
  } else if (sortBy === 'date' || sortBy === 'size') {
    images.sort((a, b) => {
      const aPath = require('path').join(imageFolder, a);
      const bPath = require('path').join(imageFolder, b);
      const aStat = window.fsStatSync ? window.fsStatSync(aPath) : require('fs').statSync(aPath);
      const bStat = window.fsStatSync ? window.fsStatSync(bPath) : require('fs').statSync(bPath);
      let valA = sortBy === 'date' ? aStat.birthtimeMs : aStat.size;
      let valB = sortBy === 'date' ? bStat.birthtimeMs : bStat.size;
      return sortOrder === 'asc' ? valA - valB : valB - valA;
    });
  }
}

ipcRenderer.on('sort-images', async (event, { by, order }) => {
  sortBy = by;
  sortOrder = order;
  config.sortBy = sortBy;
  config.sortOrder = sortOrder;
  await ipcRenderer.invoke('set-config', config);
  sortImagesList();
  loadedCount = 0;
  imageList.innerHTML = '';
  loadImagesBatch();
});

// Select image folder
// Reload image list on F5, keeping preferred sort order
// Move images on Enter key
window.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (selectedImages.size > 0) {
      if (selectedDir) {
        await moveSelectedBtn.onclick();
      } else {
        // Show warning modal
        let modal = document.getElementById('warnModal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'warnModal';
          modal.className = 'modal fade';
          modal.tabIndex = -1;
          modal.innerHTML = `
            <div class="modal-dialog">
              <div class="modal-content bg-dark text-light">
                <div class="modal-header">
                  <h5 class="modal-title">Warning</h5>
                  <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                  <p>Please select a destination folder before moving images.</p>
                </div>
              </div>
            </div>
          `;
          document.body.appendChild(modal);
        }
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
      }
    }
  }
});
window.addEventListener('keydown', async (e) => {
  if (e.key === 'F5') {
    e.preventDefault();
    if (config.lastImageFolder) {
      imageFolder = config.lastImageFolder;
      images = await ipcRenderer.invoke('list-images', imageFolder);
      loadedCount = 0;
      imageList.innerHTML = '';
      imageHashes = {};
      duplicateHashes.clear();
      if (config.sortBy) sortBy = config.sortBy;
      if (config.sortOrder) sortOrder = config.sortOrder;
      sortImagesList();
      loadImagesBatch();
      updateFooterCount();
    }
  }
});
const selectImageFolderBtn = document.getElementById('select-image-folder');
const folderList = document.getElementById('folder-list');
const selectDirFolderBtn = document.getElementById('select-dir-folder');
const moveSelectedBtn = document.getElementById('move-selected');
const deleteSelectedBtn = document.getElementById('delete-selected');
const imageList = document.getElementById('image-list');
const footerImageCount = document.getElementById('footer-image-count');
if (footerImageCount) {
  let total = Array.isArray(images) ? images.length : 0;
  footerImageCount.textContent = `Selected (0 out of ${total}) images`;
}
function updateFooterCount() {
  if (footerImageCount) {
    footerImageCount.textContent = `Selected (${selectedImages.size} out of ${images.length}) images`;
  }
  // Reflect selection in action buttons
  syncActionButtons();
}

// Toggle Move/Delete styles + disabled state based on selection
function syncActionButtons() {
  const hasSel = selectedImages.size > 0;
  if (moveSelectedBtn) {
    moveSelectedBtn.disabled = !hasSel;
    moveSelectedBtn.className = hasSel ? 'btn btn-success me-2' : 'btn btn-secondary me-2';
  }
  if (deleteSelectedBtn) {
    deleteSelectedBtn.className = hasSel ? 'btn btn-danger me-2' : 'btn btn-secondary me-2';
  }
}

// Insert/Style top button bar (3 columns) per spec
(function setupTopButtonBar() {
  try {
    // Style existing buttons: all grey on load; disable Move
    if (selectImageFolderBtn) selectImageFolderBtn.className = 'btn btn-secondary me-2';
    if (selectDirFolderBtn) selectDirFolderBtn.className = 'btn btn-secondary me-2';
    if (moveSelectedBtn) {
      moveSelectedBtn.className = 'btn btn-secondary me-2';
      moveSelectedBtn.disabled = true;
    }
    if (deleteSelectedBtn) deleteSelectedBtn.className = 'btn btn-secondary me-2';

    // Create Compare button (disabled by default, grey)
    let compareBtn = document.getElementById('compare-btn');
    if (!compareBtn) {
      compareBtn = document.createElement('button');
      compareBtn.id = 'compare-btn';
      compareBtn.type = 'button';
      compareBtn.textContent = 'Compare';
    }
    compareBtn.className = 'btn btn-secondary me-2';
    compareBtn.disabled = true;
    // Ensure click is bound directly as well
    if (!compareBtn._cmpDirectBound){
      compareBtn.addEventListener('click', (e)=>{
        // Only act when enabled and we have exactly two
        if (compareBtn.disabled) return;
        if (compareSelected.size !== 2) return;
        openCompareModal();
      });
      compareBtn._cmpDirectBound = true;
    }

    // Create Favorites + Heart icon buttons for left and right groups
    const mkFavBtn = (id) => {
      let b = document.getElementById(id);
      if (!b) {
        b = document.createElement('button');
        b.id = id;
        b.type = 'button';
        b.textContent = 'Favorites';
      }
      b.className = 'btn btn-secondary me-2';
      return b;
    };
    const mkHeartBtn = (id) => {
      let b = document.getElementById(id);
      if (!b) {
        b = document.createElement('button');
        b.id = id;
        b.type = 'button';
        b.setAttribute('aria-label', 'Favorite');
        b.title = 'Favorite';
        b.innerHTML = '<i class="bi bi-heart"></i>';
      }
      b.className = 'btn btn-secondary';
      return b;
    };

    const favLeftBtn = mkFavBtn('left-favorites');
    const heartLeftBtn = mkHeartBtn('left-heart');
    const favRightBtn = mkFavBtn('right-favorites');
    const heartRightBtn = mkHeartBtn('right-heart');

    // Build the 3-column table and place buttons
    let bar = document.getElementById('top-button-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'top-button-bar';
      bar.className = 'container-fluid py-2';

      const table = document.createElement('table');
      table.style.width = '100%';

      const tr = document.createElement('tr');
      const tdL = document.createElement('td');
      const tdC = document.createElement('td');
      const tdR = document.createElement('td');

      // Add class names for CSS styling
      tdL.className = 'btn-row-left';
      tdC.className = 'btn-row-center';
      tdR.className = 'btn-row-right';

      if (selectImageFolderBtn) tdL.append(selectImageFolderBtn);
      tdL.append(favLeftBtn, heartLeftBtn);

      tdC.append(compareBtn);
      if (moveSelectedBtn) tdC.append(moveSelectedBtn);
      if (deleteSelectedBtn) tdC.append(deleteSelectedBtn);

      if (selectDirFolderBtn) tdR.append(selectDirFolderBtn);
      tdR.append(favRightBtn, heartRightBtn);

      tr.append(tdL, tdC, tdR);
      table.appendChild(tr);
      bar.appendChild(table);

      // Insert at the very top of body
      document.body.prepend(bar);

      // Ensure initial zero-selection state is reflected
      syncActionButtons();
    }
  } catch (e) {
    console.error('setupTopButtonBar error:', e);
  }
})();


// After top button bar setup, wire heart buttons
(function wireHeartButtons(){
  const leftHeart = document.getElementById('left-heart');
  const rightHeart = document.getElementById('right-heart');
  if (leftHeart && !leftHeart._favBound){
    leftHeart.addEventListener('click', async ()=>{ await addFavorite('image'); });
    leftHeart._favBound = true;
  }
  if (rightHeart && !rightHeart._favBound){
    rightHeart.addEventListener('click', async ()=>{ await addFavorite('dest'); });
    rightHeart._favBound = true;
  }
  updateHeartStates();
})();

// Keep hearts updated when folders or selection change
(function bindFavStateUpdates(){
  // After selecting image folder
  const _selImg = selectImageFolderBtn.onclick;
  selectImageFolderBtn.onclick = async (...args) => {
    if (typeof _selImg === 'function') await _selImg.apply(selectImageFolderBtn, args);
    updateHeartStates();
  };
  // After selecting dir root folder
  const _selDir = selectDirFolderBtn.onclick;
  selectDirFolderBtn.onclick = async (...args) => {
    if (typeof _selDir === 'function') await _selDir.apply(selectDirFolderBtn, args);
    updateHeartStates();
  };
  // When radio selection changes in right panel
  const origLoadFolders = loadFolders;
  window.loadFolders = function(){
    origLoadFolders();
    // Defer binding until DOM updated
    setTimeout(()=>{

      document.querySelectorAll('#folder-list input[type=radio]').forEach(r=>{
        if (!r._favWatch){
          r.addEventListener('change', ()=>{ updateHeartStates(); });
          r._favWatch = true;
        }
      });
      updateHeartStates();
    }, 0);
  };
})();

// Ensure Compare click works even if the button gets recreated
if (!document._compareDelegatedBound){
  document.addEventListener('click', (e) => {
    const btn = e.target && (e.target.id === 'compare-btn' ? e.target : e.target.closest && e.target.closest('#compare-btn'));
    if (!btn) return;
    openCompareModal();
  });
  document._compareDelegatedBound = true;
}

// Ensure buttons reflect current selection on first render too
updateFooterCount();
updateCompareButton();

selectImageFolderBtn.onclick = async () => {
  imageFolder = await ipcRenderer.invoke('select-folder');
  config.lastImageFolder = imageFolder;
  await ipcRenderer.invoke('set-config', config);
  images = await ipcRenderer.invoke('list-images', imageFolder);
  loadedCount = 0;
  imageList.innerHTML = '';
  loadImagesBatch();
  updateHeartStates();
};


selectDirFolderBtn.onclick = async () => {
  dirFolder = await ipcRenderer.invoke('select-folder');
  config.lastDestFolder = dirFolder;
  await ipcRenderer.invoke('set-config', config);
  loadFolders();
  updateHeartStates();
};

deleteSelectedBtn.onclick = async () => {
  if (selectedImages.size === 0) {
    // Show warning modal for no images selected
    let modal = document.getElementById('warnModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'warnModal';
      modal.className = 'modal fade';
      modal.tabIndex = -1;
      modal.innerHTML = `
        <div class="modal-dialog">
          <div class="modal-content bg-dark text-light">
            <div class="modal-header">
              <h5 class="modal-title">Warning</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <p>Please select one or more images before deleting.</p>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    return;
  }
  if (selectedImages.size > 1) {
    // Show confirmation modal for multiple images
    let confirmModal = document.getElementById('confirmDeleteModal');
    if (!confirmModal) {
      confirmModal = document.createElement('div');
      confirmModal.id = 'confirmDeleteModal';
      confirmModal.className = 'modal fade';
      confirmModal.tabIndex = -1;
      confirmModal.innerHTML = `
        <div class="modal-dialog">
          <div class="modal-content bg-dark text-light">
            <div class="modal-header">
              <h5 class="modal-title">Confirm Deletion</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <p>Are you sure you want to delete <span id="confirmDeleteCount">${selectedImages.size}</span> images?</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-danger" id="confirmDeleteBtn">Delete</button>
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(confirmModal);
    }
    // Always update the displayed count before showing the modal
    try {
      const cnt = confirmModal.querySelector('#confirmDeleteCount');
      if (cnt) {
        cnt.textContent = String(selectedImages.size);
      } else {
        const p = confirmModal.querySelector('.modal-body p');
        if (p) p.textContent = `Are you sure you want to delete ${selectedImages.size} images?`;
      }
    } catch {}
    const bsConfirmModal = new bootstrap.Modal(confirmModal);
    bsConfirmModal.show();
    // Attach handler for confirm
    document.getElementById('confirmDeleteBtn').onclick = async () => {
      bsConfirmModal.hide();
      let trash = config.trashFolder;
      if (!trash) {
        trash = await ipcRenderer.invoke('select-folder');
        config.trashFolder = trash;
        await ipcRenderer.invoke('set-config', config);
      }
      for (const img of selectedImages) {
        const src = require('path').join(imageFolder, img);
        const dest = require('path').join(trash, img);
        await ipcRenderer.invoke('move-image', src, dest);
        // Mark the image-item as deleted and clear checkbox
        const item = document.querySelector(`.image-item[data-img='${img}']`);
        if (item) {
          item.classList.add('deleted');
          item.style.opacity = '0.5';
          item.style.pointerEvents = 'none';
          const imgEl = item.querySelector('img');
          if (imgEl) {
            imgEl.style.filter = 'grayscale(100%) brightness(66%)';
          }
          const iconCheck = item.querySelector('.image-checkbox i');
          if (iconCheck) {
            iconCheck.classList.remove('bi-check-square-fill');
            iconCheck.classList.add('bi-square');
          }
          // Also clear compare selection if present
          if (compareSelected.has(img)) {
            compareSelected.delete(img);
            item.classList.remove('compare-selected');
          }
        }
      }
      selectedImages.clear();
      updateFooterCount();
      updateCompareButton();
    };
    return;
  }
  // TODO: Add actual delete logic for single image here
}
function isSystemFile(filename) {
  return filename.startsWith('.') || filename === 'Thumbs.db' || filename === 'desktop.ini';
}

let isLoading = false;
async function computeImageHash(imgPath = '') {
  if (!imgPath) return null;
  try {
    const fs = require('fs');
    const data = await fs.promises.readFile(imgPath);
    return crypto.createHash('md5').update(data).digest('hex');
  } catch {
    return null;
  }
}

async function loadImagesBatch() {
  if (isLoading) return;
  isLoading = true;
  let batchSize = LOAD_BATCH;
  if (loadedCount === 0 && images.length < LOAD_BATCH + 1) {
    batchSize = images.length;
  }
  const batch = images.slice(loadedCount, loadedCount + batchSize).filter(img => !isSystemFile(img));
  // Compute hashes for batch
  let hashPromises = batch.map((img) => computeImageHash(require('path').join(imageFolder, img)));
  let hashes = await Promise.all(hashPromises);
  // Track hashes and duplicates
  batch.forEach((img, idx) => {
    const hash = hashes[idx];
    imageHashes[img] = hash;
  });
  // Find duplicate hashes
  duplicateHashes.clear();
  const hashCount = {};
  Object.values(imageHashes).forEach(h => {
    if (!h) return;
    hashCount[h] = (hashCount[h] || 0) + 1;
  });
  Object.entries(imageHashes).forEach(([img, h]) => {
    if (h && hashCount[h] > 1) duplicateHashes.add(h);
  });
  // Render image items
  batch.forEach((img, idx) => {
    const safeId = `icon-check-${loadedCount + idx}`;
    const hash = hashes[idx];
    const item = document.createElement('div');
    item.className = 'image-item';
    item.setAttribute('data-img', img);
    if (duplicateHashes.has(hash)) {
      item.style.border = '2px solid #ff6f00'; // thin colored border for duplicates
    }
    // Re-apply compare selected style if needed
    if (compareSelected.has(img)) {
      item.classList.add('compare-selected');
    }
    item.innerHTML = `
      <img src="${require('path').join(imageFolder, img)}" alt="" title="${img}\nHash: ${hash}" style="transition:transform 0.2s;">
      <div class="d-flex justify-content-center mt-2">
        <span class="image-checkbox" style="cursor:pointer"><i class="bi bi-square" id="${safeId}"></i></span>
      </div>
    `;

    // Intercept Ctrl+Left-Click earlier on mousedown (capture) so base selection never toggles
    item.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      // Toggle compare selection once here
      toggleCompareSelection(item, img);
      // Mark this event so the subsequent click is ignored
      item.dataset.ctrlClickBlock = '1';
    }, true);

    // Block click in capture if it originated from a Ctrl+Click
    item.addEventListener('click', (e) => {
      if (e.ctrlKey || item.dataset.ctrlClickBlock === '1') {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        delete item.dataset.ctrlClickBlock;
      }
    }, true);

    imageList.appendChild(item);
    // Checkbox icon toggle (existing behavior)
    let checked = false;
    const iconCheck = item.querySelector(`#${safeId}`);
    // Toggle checkbox when clicking anywhere on image-item
    item.onclick = (e) => {
      // Ignore ctrl-modified clicks (handled above)
      if (e.ctrlKey || item.dataset.ctrlClickBlock === '1') {
        delete item.dataset.ctrlClickBlock;
        return;
      }
      // Prevent double-click from opening modal and toggling checkbox
      if (e.detail === 2) return;
      checked = !checked;
      if (checked) {
        iconCheck.classList.remove('bi-square');
        iconCheck.classList.add('bi-check-square-fill');
        selectedImages.add(img);
        item.classList.add('selected');
      } else {
        iconCheck.classList.remove('bi-check-square-fill');
        iconCheck.classList.add('bi-square');
        selectedImages.delete(img);
        item.classList.remove('selected');
      }
      updateFooterCount();
    };

    // Double click for modal
    item.querySelector('img').ondblclick = async (e) => {
      const modalEl = document.getElementById('imgModal');
      const modal = new bootstrap.Modal(modalEl);
      const modalImg = document.getElementById('modal-img-preview');
      const modalMeta = document.getElementById('modal-img-meta');
      modalImg.src = require('path').join(imageFolder, img);
      modalImg.style.display = 'block';
      modalImg.style.margin = 'auto';
      // Set up pan/zoom viewport around the image (once)
      const bodyEl = modalEl.querySelector('.modal-body');
      let viewport = document.getElementById('imgZoomViewport');
      if (!viewport && bodyEl && modalImg && modalImg.parentElement === bodyEl) {
        viewport = document.createElement('div');
        viewport.id = 'imgZoomViewport';
        viewport.style.position = 'relative';
        viewport.style.width = '100%';
        viewport.style.overflow = 'hidden';
        viewport.style.background = 'transparent';
        // Insert viewport before image and move image inside
        bodyEl.insertBefore(viewport, modalImg);
        viewport.appendChild(modalImg);
      }
      // Size viewport to fill available screen height beneath header
      const headerEl = modalEl.querySelector('.modal-header');
      function updateViewportHeight(){
        try {
          const headerH = headerEl ? headerEl.offsetHeight : 56; // fallback
          const vpad = 24; // approximate body paddings/margins
          const avail = Math.max(200, window.innerHeight - headerH - vpad);
          if (viewport) viewport.style.height = avail + 'px';
          if (bodyEl) bodyEl.style.maxHeight = avail + 'px';
        } catch {}
      }
      updateViewportHeight();
      // Configure image for absolute centering and transform-based pan/zoom
      if (modalImg) {
        modalImg.style.position = 'absolute';
        modalImg.style.top = '50%';
        modalImg.style.left = '50%';
        modalImg.style.maxWidth = 'none';
        modalImg.style.maxHeight = 'none';
        modalImg.style.width = 'auto';
        modalImg.style.height = 'auto';
        modalImg.style.objectFit = 'contain';
        modalImg.style.cursor = 'grab';
      }
      // Wire pan/zoom like compare modal (wire once per modal)
      if (!modalEl._imgPZ) {
        const state = { zoom: 1, panX: 0, panY: 0, dragging: false, lastX: 0, lastY: 0 };
        function applyTransforms() {
          if (!modalImg) return;
          modalImg.style.transform = `translate(-50%, -50%) translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
        }
        function resetView() {
          state.zoom = 1; state.panX = 0; state.panY = 0; state.dragging = false;
          applyTransforms();
        }
        // Compute a default fit (contain) and align the image top to the top of the viewport
        function fitAndTopAlign() {
          try {
            const vp = document.getElementById('imgZoomViewport') || bodyEl;
            if (!vp || !modalImg) return;
            const rect = vp.getBoundingClientRect();
            const iW = modalImg.naturalWidth || 1;
            const iH = modalImg.naturalHeight || 1;
            const zoom = Math.max(0.1, Math.min(rect.width / iW, rect.height / iH));
            state.zoom = isFinite(zoom) ? zoom : 1;
            state.panX = 0;
            // Align top: panY = (scaledH - viewportH) / 2
            const scaledH = iH * state.zoom;
            state.panY = (scaledH - rect.height) / 2;
            applyTransforms();
          } catch {}
        }
        function onWheel(ev) {
          ev.preventDefault();
          const delta = -ev.deltaY;
          const factor = 1 + (delta * 0.001);
          state.zoom = Math.min(8, Math.max(0.1, state.zoom * factor));
          applyTransforms();
        }
        function onMouseDown(ev) {
          ev.preventDefault();
          ev.stopPropagation(); // prevent modal click-to-close
          state.dragging = true;
          state.lastX = ev.clientX; state.lastY = ev.clientY;
          if (modalImg) modalImg.style.cursor = 'grabbing';
        }
        function onMouseMove(ev) {
          if (!state.dragging) return;
          const dx = ev.clientX - state.lastX; const dy = ev.clientY - state.lastY;
          state.lastX = ev.clientX; state.lastY = ev.clientY;
          state.panX += dx; state.panY += dy;
          applyTransforms();
        }
        function onMouseUp() {
          state.dragging = false;
          if (modalImg) modalImg.style.cursor = 'grab';
        }
        // Attach to viewport if present; else attach to bodyEl
        const vp = document.getElementById('imgZoomViewport') || bodyEl;
        if (vp) {
          vp.addEventListener('wheel', onWheel, { passive: false });
          vp.addEventListener('mousedown', onMouseDown);
          vp.addEventListener('click', (ev)=> ev.stopPropagation()); // prevent modal close on click over image
        }
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        // Keep viewport sized on window resize while modal is open
        const onResize = () => updateViewportHeight();
        window.addEventListener('resize', onResize);
        // Reset view when modal hides and clean up dragging
        modalEl.addEventListener('hidden.bs.modal', () => {
          state.dragging = false;
          if (modalImg) modalImg.style.cursor = 'grab';
          resetView();
          window.removeEventListener('resize', onResize);
        });
        modalEl._imgPZ = { state, applyTransforms, resetView, fitAndTopAlign };
        // Initialize default view after image loads
        const initFit = () => { fitAndTopAlign(); };
        if (modalImg && modalImg.complete) {
          initFit();
        } else if (modalImg) {
          modalImg.addEventListener('load', initFit, { once: true });
        }
      } else {
        // Ensure transform is applied for new image
        if (modalEl._imgPZ.applyTransforms) modalEl._imgPZ.applyTransforms();
        updateViewportHeight();
        // Apply default top-aligned fit for the newly opened image
        if (modalEl._imgPZ.fitAndTopAlign) {
          const doFit = () => modalEl._imgPZ.fitAndTopAlign();
          if (modalImg && modalImg.complete) doFit();
          else if (modalImg) modalImg.addEventListener('load', doFit, { once: true });
        }
      }
      // Get image info
      const imgPath = require('path').join(imageFolder, img);
      const info = await ipcRenderer.invoke('get-image-info', imgPath);
      // Fallbacks if backend could not provide dimensions or created date
      let width = info && info.width ? info.width : 0;
      let height = info && info.height ? info.height : 0;
      let createdVal = info && info.created ? info.created : '';
      try {
        if (!createdVal) {
          const fs = require('fs');
          const stats = fs.statSync(imgPath);
          createdVal = stats.birthtime || stats.ctime || stats.mtime || '';
        }
      } catch {}
      let dimHtml = `<b>Dimensions:</b> <span id="modal-dimensions">${width || 'N/A'} x ${height || 'N/A'} px</span>`;
      let dateHtml = `<b>Created:</b> <span id="modal-created">${createdVal ? createdVal : 'N/A'}</span>`;
      // Get the key-value string from info.params (same as Other Metadata)
      let keyValueString = '';
      if (info && typeof info.params === 'string' && info.params.trim()) {
        keyValueString = info.params;
      }
      modalMeta.innerHTML = `
        <b>Name:</b> ${img}<br>${dimHtml}<br>${dateHtml}<br>
        <div id="positive-box" class="prompt-box">
            <h3>Positive Prompt</h3>
            <textarea id="positive-prompt" rows="4" style="width: 100%;"></textarea>
        </div>

        <div id="negative-box" class="prompt-box">
          <h3>Negative Prompt</h3>
          <textarea id="negative-prompt" rows="4" style="width: 100%;"></textarea>
        </div>

        <div id="keyvalue-info-debug" style="color: #ffb347; font-size: 0.9em; margin-bottom: 0.5em;"></div>
        <div id="keyvalue-info-box">
          <h3>Key: Value Info</h3>
          <div id="keyvalue-info-content"></div>
        </div>

        <div id="metadata-box">
          <h3>Other Metadata</h3>
          <textarea id="param-list" rows="6" style="height: 225px; width: 100%;"></textarea>
        </div>
      `;

      // DEBUG: Check if paramList and info.params exist right after modalMeta.innerHTML is set
      setTimeout(() => {
        const paramList = document.getElementById('param-list');
        const debugBox = document.getElementById('keyvalue-info-debug');
        if (debugBox) debugBox.textContent += `\n[KeyValueBox][timeout] paramList: ${!!paramList}, info.params: '${info && typeof info.params === 'string' ? info.params : '[none]'}'`;
      }, 100);

      // Set the Other Metadata textarea value as before
      const paramList = document.getElementById('param-list');
      const debugBox = document.getElementById('keyvalue-info-debug');
      if (debugBox) debugBox.textContent = `[KeyValueBox] info.params: '${info && typeof info.params === 'string' ? info.params : '[none]'}'`;
      setTimeout(() => {
        const paramList = document.getElementById('param-list');
        const debugBox = document.getElementById('keyvalue-info-debug');
        if (debugBox) debugBox.textContent += `\n[KeyValueBox][timeout] paramList: ${!!paramList}, info.params: '${info && typeof info.params === 'string' ? info.params : '[none]'}'`;
        if (paramList && info && typeof info.params === 'string' && info.params.trim()) {
          if (debugBox) debugBox.textContent += '\n[KeyValueBox][timeout] About to set paramList.value';
          paramList.value = info.params;
          if (debugBox) debugBox.textContent += `\n[KeyValueBox][timeout] paramList.value set to: '${paramList.value}'`;
        } else {
          if (debugBox) debugBox.textContent += '\n[KeyValueBox][timeout] paramList assignment code path NOT reached.';
        }
        if (typeof updateKeyValueBoxFromParamList === 'function') updateKeyValueBoxFromParamList();
      }, 300);
      // Unified Key: Value Info rendering logic
      const keyValueBox = document.getElementById('keyvalue-info-content');
      function updateKeyValueBoxFromParamList() {
        let metaString = paramList ? paramList.value : '';
        const debugBox = document.getElementById('keyvalue-info-debug');
        if (debugBox) {
          debugBox.textContent = `[KeyValueBox] paramList.value: '${paramList ? paramList.value : '[null]'}', metaString: '${metaString}'`;
        }
        if (metaString && typeof metaString === 'string') {
          const pairs = metaString.split(',');
          const clipSkipIdx = pairs.findIndex(pair => pair.trim().toLowerCase().startsWith('clip skip'));
          const displayPairs = clipSkipIdx >= 0 ? pairs.slice(0, clipSkipIdx + 1) : pairs;
          metaString = displayPairs.join(',');
        }
        if (keyValueBox && metaString) {
          const html = parseKeyValueHTML(metaString);
          if (debugBox) debugBox.textContent += `\n[KeyValueBox] HTML: ${html}`;
          keyValueBox.innerHTML = html;
        } else if (keyValueBox) {
          if (debugBox) debugBox.textContent += '\n[KeyValueBox] No data';
          keyValueBox.innerHTML = '<span class="text-muted">No data</span>';
        }
      }
      updateKeyValueBoxFromParamList();
      // Listen for changes to the Other Metadata textarea (live update)
      if (paramList && !paramList._kvObserver) {
        paramList.addEventListener('input', updateKeyValueBoxFromParamList);
        paramList._kvObserver = true;
      }
      // Ensure dimensions update when the image finishes loading
      const dimSpan = document.getElementById('modal-dimensions');
      if ((!width || !height) && modalImg) {
        const tryUpdateDims = () => {
          if (modalImg.naturalWidth && modalImg.naturalHeight && dimSpan) {
            dimSpan.textContent = `${modalImg.naturalWidth} x ${modalImg.naturalHeight} px`;
          }
        };
        // If already loaded, update immediately; else wait for load
        if (modalImg.complete) {
          tryUpdateDims();
        } else {
          modalImg.addEventListener('load', tryUpdateDims, { once: true });
        }
      }
      if (!createdVal) {
        try {
          const fs = require('fs');
          const stats = fs.statSync(imgPath);
          createdVal = stats.birthtime || stats.ctime || stats.mtime || '';
        } catch {}
      }
      let dateHtml2 = `<b>Created:</b> ${createdVal ? createdVal : 'N/A'}`;
      modalMeta.innerHTML += `<br>${dateHtml2}`;
      // Make modal fill the app view area
      const modalDialog = document.querySelector('#imgModal .modal-dialog');
      modalDialog.classList.remove('modal-lg');
      modalDialog.classList.add('modal-fullscreen');
      modal.show();
      // Right-click actions modal for image preview (Delete / Send to editor)
      function ensurePreviewActionsModal(){
        if (document.getElementById('imgPreviewActionsModal')) return;
        const html = `
        <div class="modal fade" id="imgPreviewActionsModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-sm modal-dialog-centered">
            <div class="modal-content bg-dark text-light">
              <div class="modal-body">
                <button type="button" id="previewDeleteBtn" class="btn btn-danger w-100 mb-2">Delete this image</button>
                <div style="height:1px;background:#444;margin:6px 0;"></div>
                <button type="button" id="previewOpenEditorBtn" class="btn btn-secondary w-100">Send this image to image editor</button>
              </div>
            </div>
          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        // Wire once: handlers use data set on the modal element
        const mEl = document.getElementById('imgPreviewActionsModal');
        const delBtn = mEl.querySelector('#previewDeleteBtn');
        const openBtn = mEl.querySelector('#previewOpenEditorBtn');
        if (delBtn && !delBtn._bound){
          delBtn.addEventListener('click', async ()=>{
            const tPath = mEl.dataset.imgPath || '';
            const tName = mEl.dataset.imgName || '';
            if (!tPath || !tName) return;
            // Ensure trash configured
            let trash = config.trashFolder;
            if (!trash) {
              trash = await ipcRenderer.invoke('select-folder');
              if (!trash) return;
              config.trashFolder = trash;
              try { await ipcRenderer.invoke('set-config', config); } catch {}
            }
            const path = require('path');
            const dest = path.join(trash, tName);
            await ipcRenderer.invoke('move-image', tPath, dest);
            // Mark the grid item as deleted if present
            const itemRef = document.querySelector(`.image-item[data-img='${CSS.escape(tName)}']`);
            if (itemRef) {
              itemRef.classList.add('deleted');
              itemRef.style.opacity = '0.5';
              itemRef.style.pointerEvents = 'none';
              const iconCheckRef = itemRef.querySelector('.image-checkbox i');
              if (iconCheckRef) {
                iconCheckRef.classList.remove('bi-check-square-fill');
                iconCheckRef.classList.add('bi-square');
              }
              if (compareSelected.has(tName)) {
                compareSelected.delete(tName);
                itemRef.classList.remove('compare-selected');
                updateCompareButton();
              }
            }
            // Close both modals
            try { bootstrap.Modal.getOrCreateInstance(mEl).hide(); } catch {}
            try { bootstrap.Modal.getOrCreateInstance(modalEl).hide(); } catch {}
          });
          delBtn._bound = true;
        }
        if (openBtn && !openBtn._bound){
          openBtn.addEventListener('click', async ()=>{
            const tPath = mEl.dataset.imgPath || '';
            if (!tPath) return;
            // If no editor configured, open Preferences for user to set it
            if (!config.imageEditorPath) {
              try { prefModal.show(); } catch {}
            }
            try { await ipcRenderer.invoke('open-in-editor', tPath); } catch {}
            try { bootstrap.Modal.getOrCreateInstance(mEl).hide(); } catch {}
          });
          openBtn._bound = true;
        }
      }
      ensurePreviewActionsModal();
      // Bind context menu on viewport to open actions modal
      try {
        const vpForMenu = document.getElementById('imgZoomViewport') || modalEl.querySelector('.modal-body');
        if (vpForMenu && !vpForMenu._previewCtxBound){
          vpForMenu.addEventListener('contextmenu', (ev)=>{
            ev.preventDefault();
            const mEl = document.getElementById('imgPreviewActionsModal');
            if (!mEl) return;
            // Set target metadata
            const p = require('path');
            const full = p.join(imageFolder, img);
            mEl.dataset.imgPath = full;
            mEl.dataset.imgName = img;
            bootstrap.Modal.getOrCreateInstance(mEl).show();
          });
          vpForMenu._previewCtxBound = true;
        }
      } catch {}
      // After modal is visible, recalc viewport and fit image to top
      const onShown = () => {
        try {
          updateViewportHeight();
          if (modalEl._imgPZ && typeof modalEl._imgPZ.fitAndTopAlign === 'function') {
            modalEl._imgPZ.fitAndTopAlign();
          }
        } catch {}
      };
      modalEl.addEventListener('shown.bs.modal', onShown, { once: true });
      // Close modal on click anywhere
      const closeHandler = () => {
        modal.hide();
        modalEl.removeEventListener('click', closeHandler);
      };
      // Do not close when interacting with the image viewport
      modalEl.addEventListener('click', closeHandler);
    };
    // Add right-click context menu for compare/delete
    item.oncontextmenu = async (e) => {
      e.preventDefault();
      // Remove any open menu first
      let existing = document.getElementById('img-context-menu');
      if (existing) existing.remove();

      const menu = document.createElement('div');
      menu.id = 'img-context-menu';
      menu.style.position = 'fixed';
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      menu.style.zIndex = 9999;
      menu.style.background = '#222';
      menu.style.color = '#fff';
      menu.style.border = '1px solid #555';
      menu.style.padding = '6px 0';
      menu.style.borderRadius = '6px';
      menu.style.boxShadow = '0 2px 8px #000a';
      menu.style.minWidth = '180px';

      const isMarked = compareSelected.has(img);
      const atLimit = !isMarked && compareSelected.size >= 2;
      const compareText = isMarked ? 'Unmark from compare (ctrl-left_click)' : 'Mark to compare (ctrl-left_click)';

      menu.innerHTML = `
        <div class="ctx-item" data-action="compare" style="padding:8px 16px; cursor:${atLimit ? 'not-allowed' : 'pointer'}; ${atLimit ? 'opacity:0.5;' : ''}">${compareText}</div>
        <div class="ctx-sep" style="height:1px;background:#444;margin:4px 0;"></div>
        <div class="ctx-item" data-action="delete" style="padding:8px 16px; cursor:pointer; color:#ff6b6b;">Delete Image</div>
      `;

      document.body.appendChild(menu);

      menu.addEventListener('click', async (ev) => {
        const itemEl = ev.target.closest('.ctx-item');
        if (!itemEl) return;
        const action = itemEl.getAttribute('data-action');
        if (action === 'compare') {
          if (isMarked) {
            toggleCompareSelection(item, img);
          } else if (!atLimit) {
            toggleCompareSelection(item, img);
          }
          menu.remove();
          return;
        }
        if (action === 'delete') {
          // Move image to trash folder
          let trash = config.trashFolder;
          if (!trash) {
            trash = await ipcRenderer.invoke('select-folder');
            config.trashFolder = trash;
            await ipcRenderer.invoke('set-config', config);
          }
          const src = require('path').join(imageFolder, img);
          const dest = require('path').join(trash, img);
          await ipcRenderer.invoke('move-image', src, dest);
          // Mark the image-item as deleted and clear checkbox
          const itemRef = document.querySelector(`.image-item[data-img='${img}']`);
          if (itemRef) {
            itemRef.classList.add('deleted');
            itemRef.style.opacity = '0.5';
            itemRef.style.pointerEvents = 'none';
            const iconCheckRef = itemRef.querySelector('.image-checkbox i');
            if (iconCheckRef) {
              iconCheckRef.classList.remove('bi-check-square-fill');
              iconCheckRef.classList.add('bi-square');
            }
            if (compareSelected.has(img)) {
              compareSelected.delete(img);
              itemRef.classList.remove('compare-selected');
              updateCompareButton();
            }
          }
          menu.remove();
          return;
        }
      });

      // Remove menu on click elsewhere
      const closeHandler = function() {
        if (menu) menu.remove();
        document.removeEventListener('click', closeHandler);
        document.removeEventListener('contextmenu', closeHandler);
      };
      setTimeout(() => {
        document.addEventListener('click', closeHandler);
        document.addEventListener('contextmenu', closeHandler);
      }, 0);
    };

  });
  loadedCount += batch.length;
  isLoading = false;
}

imageList.onscroll = function() {
  if (imageList.scrollTop + imageList.clientHeight >= imageList.scrollHeight - 10) {
    if (loadedCount < images.length && !isLoading) {
      loadImagesBatch();
    }
  }
};

function loadFolders() {
  if (!dirFolder) return;
  ipcRenderer.invoke('list-directories', dirFolder).then(folders => {
    folderList.innerHTML = '';
    folders.forEach(folder => {
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.innerHTML = `
        <input type="radio" name="folderRadio" value="${folder}" id="radio-${folder}">
        <label for="radio-${folder}" class="ms-2">${folder}</label>
      `;
      folderList.appendChild(item);
      item.querySelector('input[type=radio]').onchange = (e) => {
        if (e.target.checked) selectedDir = folder;
        updateHeartStates();
      };
    });
  });
}

async function moveSelectedImages() {
  let destFolder = selectedDir;
  // If selectedDir is just a folder name, prepend dirFolder to get the full path
  if (destFolder && dirFolder && !require('path').isAbsolute(destFolder)) {
    destFolder = require('path').join(dirFolder, destFolder);
  }
  if (!destFolder) {
    destFolder = await ipcRenderer.invoke('select-folder');
    selectedDir = destFolder;
    config.lastDestFolder = destFolder;
    await ipcRenderer.invoke('set-config', config);
  }
  for (const img of selectedImages) {
    const src = require('path').join(imageFolder, img);
    const dest = require('path').join(destFolder, img);
    await ipcRenderer.invoke('move-image', src, dest);
    // Mark the image-item as moved and clear checkbox
    const item = document.querySelector(`.image-item[data-img='${img}']`);
    if (item) {
      item.classList.add('moved');
      item.style.opacity = '0.5';
      item.style.pointerEvents = 'none';
      const imgEl = item.querySelector('img');
      if (imgEl) {
        imgEl.style.filter = 'grayscale(100%) brightness(66%)';
      }
      const iconCheck = item.querySelector('.image-checkbox i');
      if (iconCheck) {
        iconCheck.classList.remove('bi-check-square-fill');
        iconCheck.classList.add('bi-square');
      }
      // Also clear compare selection if present
      if (compareSelected.has(img)) {
        compareSelected.delete(img);
        item.classList.remove('compare-selected');
      }
    }
  }
  selectedImages.clear();
  updateFooterCount();
  updateCompareButton();
}

moveSelectedBtn.onclick = async () => {
  if (selectedImages.size === 0) {
    // Show warning modal for no images selected
    let modal = document.getElementById('warnModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'warnModal';
      modal.className = 'modal fade';
      modal.tabIndex = -1;
      modal.innerHTML = `
        <div class="modal-dialog">
          <div class="modal-content bg-dark text-light">
            <div class="modal-header">
              <h5 class="modal-title">Warning</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <p>Please select one or more images before moving.</p>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    return;
  }
  if (!selectedDir) {
    // Show warning modal for no destination folder
    let modal = document.getElementById('warnModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'warnModal';
      modal.className = 'modal fade';
      modal.tabIndex = -1;
      modal.innerHTML = `
        <div class="modal-dialog">
          <div class="modal-content bg-dark text-light">
            <div class="modal-header">
              <h5 class="modal-title">Warning</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <p>Please select a destination folder before moving images.</p>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    return;
  }
  await moveSelectedImages();
};

document.getElementById('zoom-in').onclick = () => {
  zoomLevel = Math.min(zoomLevel + 0.1, 2);
  updateZoom();
};
document.getElementById('zoom-out').onclick = () => {
  zoomLevel = Math.max(zoomLevel - 0.1, 0.5);
  updateZoom();
};
document.getElementById('zoom-reset').onclick = () => {
  zoomLevel = 1;
  updateZoom();
};
function updateZoom() {
  document.querySelector('.light-table').style.setProperty('--zoom', zoomLevel);
}

// Preference modal HTML
const prefModalHtml = `
  <div class="modal fade" id="prefModal" tabindex="-1" aria-labelledby="prefModalLabel" aria-hidden="true">
    <div class="modal-dialog">
      <div class="modal-content bg-dark text-light">
        <div class="modal-header">
          <h5 class="modal-title" id="prefModalLabel">Preferences</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label for="trashFolderInput" class="form-label">Default Trash Folder</label>
            <input type="text" class="form-control" id="trashFolderInput" readonly>
            <button id="selectTrashFolder" class="btn btn-secondary btn-sm mt-2">Select Folder</button>
          </div>
          <div class="mb-3">
            <label for="imageEditorInput" class="form-label">Preferred Image Editor</label>
            <input type="text" class="form-control" id="imageEditorInput" readonly>
            <button id="selectImageEditor" class="btn btn-secondary btn-sm mt-2">Select Program</button>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-primary" id="savePrefs">Save</button>
        </div>
      </div>
    </div>
  </div>
`;
document.body.insertAdjacentHTML('beforeend', prefModalHtml);

// Re-add original preferences/config wiring (unchanged behavior)
const prefModal = new bootstrap.Modal(document.getElementById('prefModal'));
const trashFolderInput = document.getElementById('trashFolderInput');
const selectTrashFolderBtn = document.getElementById('selectTrashFolder');
const savePrefsBtn = document.getElementById('savePrefs');
const imageEditorInput = document.getElementById('imageEditorInput');
const selectImageEditorBtn = document.getElementById('selectImageEditor');

async function loadConfigUI() {
  config = await ipcRenderer.invoke('get-config');
  trashFolderInput.value = config.trashFolder || '';
  if (imageEditorInput) imageEditorInput.value = config.imageEditorPath || '';
}

selectTrashFolderBtn.onclick = async () => {
  const folder = await ipcRenderer.invoke('select-folder');
  if (folder) trashFolderInput.value = folder;
};

if (selectImageEditorBtn) {
  selectImageEditorBtn.onclick = async () => {
    const file = await ipcRenderer.invoke('select-file');
    if (file) imageEditorInput.value = file;
  };
}

savePrefsBtn.onclick = async () => {

  config.trashFolder = trashFolderInput.value;
  config.imageEditorPath = imageEditorInput ? imageEditorInput.value : config.imageEditorPath;
  await ipcRenderer.invoke('set-config', config);
  prefModal.hide();
};

// When Preferences modal opens, refresh and show current trash folder path
const prefModalEl = document.getElementById('prefModal');
if (prefModalEl && !prefModalEl._showBound){
  prefModalEl.addEventListener('show.bs.modal', async () => {
    try {
      const saved = await ipcRenderer.invoke('get-config');
      if (saved && typeof saved === 'object') {
        config = { ...config, ...saved };
      }
    } catch {}
    trashFolderInput.value = config.trashFolder || '';
    if (imageEditorInput) imageEditorInput.value = config.imageEditorPath || '';
  });
  prefModalEl._showBound = true;
}

// ----- App startup: load saved config and restore state -----
(async () => {
  try {
    // Fetch persisted config from main process
    const saved = await ipcRenderer.invoke('get-config');
    if (saved && typeof saved === 'object') {
      config = { ...saved };
    }

    // Restore sort prefs
    if (config.sortBy) sortBy = config.sortBy;
    if (config.sortOrder) sortOrder = config.sortOrder;

    // Restore last image folder
    if (config.lastImageFolder) {
      imageFolder = config.lastImageFolder;
      try {
        images = await ipcRenderer.invoke('list-images', imageFolder);
      } catch { images = []; }
      loadedCount = 0;
      if (imageList) imageList.innerHTML = '';
      if (typeof sortImagesList === 'function') sortImagesList();
      loadImagesBatch();
    }

    // Restore last destination folder and populate right panel
    if (config.lastDestFolder) {
      dirFolder = config.lastDestFolder;
      loadFolders();
    }

    // Ensure footer reflects restored state
    updateFooterCount();
    updateCompareButton();
    // Also ensure heart icons reflect current active folders and favorites
    updateHeartStates();
  } catch (e) {
    console.error('Failed to load config on startup:', e);
  }
})();


// --- Favorites (image/destination) helpers ---
function ensureFavConfig() {
  if (!config) config = {};
  if (!Array.isArray(config.favImageFolders)) config.favImageFolders = [];
  if (!Array.isArray(config.favDestFolders)) config.favDestFolders = [];
}
function normPath(p) {
  try {
    const path = require('path');
    return path.normalize(p).toLowerCase();
  } catch { return (p || '').toLowerCase(); }
}
function getCurrentDestFullPath() {
  const path = require('path');
  if (selectedDir) {
    if (path.isAbsolute(selectedDir)) return selectedDir;
    if (dirFolder) return path.join(dirFolder, selectedDir);
    return selectedDir;
  }
  return dirFolder || '';
}
function isFavorited(list, folder) {
  if (!folder) return false;
  const f = normPath(folder);
  return list.some(x => normPath(x) === f);
}
function updateHeartStates() {
  ensureFavConfig();
  const leftBtn = document.getElementById('left-heart');
  const rightBtn = document.getElementById('right-heart');
  const leftPath = imageFolder || '';
  const rightPath = getCurrentDestFullPath() || '';
  const leftFav = isFavorited(config.favImageFolders, leftPath);
  const rightFav = isFavorited(config.favDestFolders, rightPath);
  if (leftBtn) {
    leftBtn.disabled = !leftPath || leftFav;
    leftBtn.innerHTML = leftFav ? '<i class="bi bi-heart-fill"></i>' : '<i class="bi bi-heart"></i>';
  }
  if (rightBtn) {
    // Disable if there's no current destination path; else disable only when already favorited
    rightBtn.disabled = !rightPath || rightFav;
    rightBtn.innerHTML = rightFav ? '<i class="bi bi-heart-fill"></i>' : '<i class="bi bi-heart"></i>';
  }
}
async function addFavorite(type) {
  ensureFavConfig();
  if (type === 'image') {
    if (!imageFolder) return;
    if (!isFavorited(config.favImageFolders, imageFolder)) {
      config.favImageFolders.push(imageFolder);
      await ipcRenderer.invoke('set-config', config);
    }
  } else if (type === 'dest') {
    const dest = getCurrentDestFullPath();
    if (!dest) return;
    if (!isFavorited(config.favDestFolders, dest)) {
      config.favDestFolders.push(dest);
      await ipcRenderer.invoke('set-config', config);
    }
  }
  updateHeartStates();
}

// ----- Favorites Modal (tabs for Image/Destination) -----
(function setupFavoritesModal(){
  function ensureModal(){
    if (document.getElementById('favoritesModal')) return;
    const html = `
    <div class="modal fade" id="favoritesModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header">
            <h5 class="modal-title">Favorites</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <ul class="nav nav-tabs" id="favTabs" role="tablist">
              <li class="nav-item" role="presentation">
                <button class="nav-link active" id="fav-img-tab" data-bs-toggle="tab" data-bs-target="#fav-img" type="button" role="tab" aria-controls="fav-img" aria-selected="true">Image sources</button>
              </li>
              <li class="nav-item" role="presentation">
                <button class="nav-link" id="fav-dest-tab" data-bs-toggle="tab" data-bs-target="#fav-dest" type="button" role="tab" aria-controls="fav-dest" aria-selected="false">Destination folders</button>
              </li>
            </ul>
            <div class="tab-content pt-3">
              <div class="tab-pane fade show active" id="fav-img" role="tabpanel" aria-labelledby="fav-img-tab">
                <div id="favImageList" class="list-group"></div>
              </div>
              <div class="tab-pane fade" id="fav-dest" role="tabpanel" aria-labelledby="fav-dest-tab">
                <div id="favDestList" class="list-group"></div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  function renderFavList(container, items, type){
    container.innerHTML = '';
    if (!items || items.length === 0){
      const empty = document.createElement('div');
      empty.className = 'text-muted';
      empty.textContent = 'No favorites yet';
      container.appendChild(empty);
      return;
    }
    items.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center bg-dark text-light';
      row.setAttribute('data-path', p);
      row.innerHTML = `
        <span class="text-truncate" style="max-width: 85%">${p}</span>
        <button type="button" class="btn btn-sm btn-outline-danger fav-remove" title="Remove"><i class="bi bi-x-lg"></i></button>
      `;
      // click to select this favorite
      row.addEventListener('click', async (e) => {
        if (e.target.closest('.fav-remove')) return; // handled separately
        if (type === 'image') {
          await loadImageFolderFromPath(p);
        } else {
          await loadDestFolderFromPath(p);
        }
        const modalEl = document.getElementById('favoritesModal');
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      });
      // remove button
      row.querySelector('.fav-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeFavorite(type, p);
        // Re-render after removal
        ensureFavConfig();
        const data = type === 'image' ? config.favImageFolders : config.favDestFolders;
        renderFavList(container, data, type);
        updateHeartStates();
      });
      container.appendChild(row);
    });
  }

  async function removeFavorite(type, pathVal){
    ensureFavConfig();
    if (type === 'image') {
      config.favImageFolders = config.favImageFolders.filter(f => normPath(f) !== normPath(pathVal));
      await ipcRenderer.invoke('set-config', config);
    } else {
      config.favDestFolders = config.favDestFolders.filter(f => normPath(f) !== normPath(pathVal));
      await ipcRenderer.invoke('set-config', config);
    }
  }

  async function loadImageFolderFromPath(pathVal){
    imageFolder = pathVal;
    config.lastImageFolder = imageFolder;
    await ipcRenderer.invoke('set-config', config);
    try { images = await ipcRenderer.invoke('list-images', imageFolder); } catch { images = []; }
    loadedCount = 0;
    if (imageList) imageList.innerHTML = '';
    imageHashes = {}; duplicateHashes.clear();
    if (typeof sortImagesList === 'function') sortImagesList();
    loadImagesBatch();
    updateFooterCount();
    updateHeartStates();
  }

  async function loadDestFolderFromPath(pathVal){
    dirFolder = pathVal;
    config.lastDestFolder = dirFolder;
    await ipcRenderer.invoke('set-config', config);
    loadFolders();
    updateHeartStates();
  }

  function openFavoritesModal(defaultTab){
    ensureFavConfig();
    ensureModal();
    const modalEl = document.getElementById('favoritesModal');
    const imgListEl = document.getElementById('favImageList');
    const destListEl = document.getElementById('favDestList');
    renderFavList(imgListEl, config.favImageFolders, 'image');
    renderFavList(destListEl, config.favDestFolders, 'dest');
    const m = bootstrap.Modal.getOrCreateInstance(modalEl);
    m.show();
    // activate requested tab
    if (defaultTab === 'dest') {
      const tabBtn = document.querySelector('#fav-dest-tab');
      if (tabBtn) new bootstrap.Tab(tabBtn).show();
    } else {
      const tabBtn = document.querySelector('#fav-img-tab');
      if (tabBtn) new bootstrap.Tab(tabBtn).show();
    }
  }

  // Wire buttons
  const leftFavBtn = document.getElementById('left-favorites');
  if (leftFavBtn && !leftFavBtn._favoritesBound){
    leftFavBtn.addEventListener('click', () => openFavoritesModal('image'));
    leftFavBtn._favoritesBound = true;
  }
  const rightFavBtn = document.getElementById('right-favorites');
  if (rightFavBtn && !rightFavBtn._favoritesBound){
    rightFavBtn.addEventListener('click', () => openFavoritesModal('dest'));
    rightFavBtn._favoritesBound = true;
  }
})();

function openCompareModal() {
  try {
    // Fallback: if exactly two images are base-selected but not compare-marked, auto-mark them
    if (compareSelected.size !== 2 && selectedImages && selectedImages.size === 2) {
      const two = Array.from(selectedImages).slice(0, 2);
      two.forEach(img => {
        if (!compareSelected.has(img)) {
          const el = document.querySelector(`.image-item[data-img='${img}']`);
          if (el) el.classList.add('compare-selected');
          compareSelected.add(img);
        }
      });
      updateCompareButton();
    }

    if (compareSelected.size !== 2) return;

    // Create modal markup if needed
    if (!document.getElementById('compareModal')) {
      const html = `
        <div class="modal fade" id="compareModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-fullscreen">
            <div class="modal-content bg-dark text-light">
              <div class="modal-header">
                
                <table style="width: 100%;">
                  <tr>
                  <td style="width: 33%; text-align: left;">
                  <button id="deleteLeft" class="btn btn-danger btn-sm">Delete Left</button>
                  </td>
                  <td style="width: 33%; text-align: center;">
                  <button id="overlayToggle" class="btn btn-outline-light btn-sm">Overlay</button>
                  <button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Close</button>
                  </td>
                  <td style="width: 33%; text-align: right;">
                  <button id="deleteRight" class="btn btn-danger btn-sm">Delete Right</button>
                  </td>
                  </tr>
                </table>
              </div>
              <div class="modal-body p-0">
                <div id="compareSideBySide" class="d-flex w-100 h-100">
                  <div class="flex-fill position-relative border-end">
                    <div class="cmp-viewport w-100 h-100 overflow-hidden position-relative">
                      <img id="cmpLeft" class="position-absolute" style="top:50%;left:50%;transform:translate(-50%, -50%);max-width:none;max-height:none;" />
                    </div>
                  </div>
                  <div class="flex-fill position-relative">
                    <div class="cmp-viewport w-100 h-100 overflow-hidden position-relative">
                      <img id="cmpRight" class="position-absolute" style="top:50%;left:50%;transform:translate(-50%, -50%);max-width:none;max-height:none;" />
                    </div>
                  </div>
                </div>
                <div id="compareOverlay" class="w-100 h-100 position-relative d-none">
                  <div class="cmp-viewport w-100 h-100 overflow-hidden position-relative">
                    <img id="ovBase" class="position-absolute" style="top:50%;left:50%;transform:translate(-50%, -50%);max-width:none;max-height:none;" />
                    <img id="ovTop" class="position-absolute" style="top:50%;left:50%;transform:translate(-50%, -50%);mix-blend-mode:difference;max-width:none;max-height:none;" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML('beforeend', html);
    }

    const el = document.getElementById('compareModal');
    const cmpLeft = document.getElementById('cmpLeft');
    const cmpRight = document.getElementById('cmpRight');
    const ovBase = document.getElementById('ovBase');
    const ovTop = document.getElementById('ovTop');
    const compareSideBySide = document.getElementById('compareSideBySide');
    const compareOverlay = document.getElementById('compareOverlay');
    const overlayToggleBtn = document.getElementById('overlayToggle');
    const deleteLeftBtn = document.getElementById('deleteLeft');
    const deleteRightBtn = document.getElementById('deleteRight');

    // Wire once
    if (!el._wired) {
      const state = { zoom: 1, panX: 0, panY: 0, dragging: false, lastX: 0, lastY: 0, overlay: false };
      el._state = state;

      function applyTransforms() {
        const t = `translate(-50%, -50%) translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
        if (!state.overlay) {
          if (cmpLeft) cmpLeft.style.transform = t;
          if (cmpRight) cmpRight.style.transform = t;
        } else {
          if (ovBase) ovBase.style.transform = t;
          if (ovTop) ovTop.style.transform = t;
        }
      }
      function resetView() {
        state.zoom = 1; state.panX = 0; state.panY = 0; state.overlay = false;
        compareSideBySide.classList.remove('d-none');
        compareOverlay.classList.add('d-none');
        applyTransforms();
      }
      el._resetView = resetView;

      function attachViewportEvents(view) {
        if (!view) return;
        view.addEventListener('wheel', (e) => {
          e.preventDefault();
          const delta = -e.deltaY;
          const factor = 1 + (delta * 0.001);
          state.zoom = Math.min(8, Math.max(0.1, state.zoom * factor));
          applyTransforms();
        }, { passive: false });
        view.addEventListener('mousedown', (e) => {
          e.preventDefault();
          state.dragging = true; state.lastX = e.clientX; state.lastY = e.clientY;
        });
        window.addEventListener('mousemove', (e) => {
          if (!state.dragging) return;
          const dx = e.clientX - state.lastX; const dy = e.clientY - state.lastY;
          state.lastX = e.clientX; state.lastY = e.clientY;
          state.panX += dx; state.panY += dy;
          applyTransforms();
        });
        window.addEventListener('mouseup', () => { state.dragging = false; });
      }
      attachViewportEvents(compareSideBySide.querySelectorAll('.cmp-viewport')[0]);
      attachViewportEvents(compareSideBySide.querySelectorAll('.cmp-viewport')[1]);
      attachViewportEvents(compareOverlay.querySelector('.cmp-viewport'));

      if (overlayToggleBtn) {
        overlayToggleBtn.onclick = () => {
          state.overlay = !state.overlay;
          if (state.overlay) {
            compareSideBySide.classList.add('d-none');
            compareOverlay.classList.remove('d-none');
          } else {
            compareOverlay.classList.add('d-none');
            compareSideBySide.classList.remove('d-none');
          }
          applyTransforms();
        };
      }

      async function del(which) {
        const arr = Array.from(compareSelected); if (arr.length < 1) return;
        const target = which === 'left' ? arr[0] : arr[1];
        let trash = config.trashFolder;
        if (!trash) { trash = await ipcRenderer.invoke('select-folder'); config.trashFolder = trash; await ipcRenderer.invoke('set-config', config); }
        const src = require('path').join(imageFolder, target);
        const dest = require('path').join(trash, target);
        await ipcRenderer.invoke('move-image', src, dest);
        const gridItem = document.querySelector(`.image-item[data-img='${target}']`);
        if (gridItem) {
          gridItem.classList.add('deleted');
          gridItem.style.opacity = '0.5';
          gridItem.style.pointerEvents = 'none';
          const iconCheck = gridItem.querySelector('.image-checkbox i');
          if (iconCheck) { iconCheck.classList.remove('bi-check-square-fill'); iconCheck.classList.add('bi-square'); }
        }
        clearCompareSelection();
        bootstrap.Modal.getOrCreateInstance(el).hide();
      }
      if (deleteLeftBtn) deleteLeftBtn.onclick = () => del('left');
      if (deleteRightBtn) deleteRightBtn.onclick = () => del('right');

      el.addEventListener('hidden.bs.modal', () => {
        if (el._resetView) el._resetView();
        clearCompareSelection();
      });

      // Ensure right-click actions modal for compare (Delete both / Send both to editor)
      function ensureCompareActionsModal(){
        if (document.getElementById('compareActionsModal')) return;
        const html = `
        <div class="modal fade" id="compareActionsModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-sm modal-dialog-centered">
            <div class="modal-content bg-dark text-light">
              <div class="modal-body">
                <button type="button" id="cmpDeleteBothBtn" class="btn btn-danger w-100 mb-2">Delete both images</button>
                <div style="height:1px;background:#444;margin:6px 0;"></div>
                <button type="button" id="cmpOpenBothBtn" class="btn btn-secondary w-100">Send both images to Image Editor</button>
              </div>
            </div>
          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        const mEl = document.getElementById('compareActionsModal');
        const delBtn = mEl.querySelector('#cmpDeleteBothBtn');
        const openBtn = mEl.querySelector('#cmpOpenBothBtn');
        if (delBtn && !delBtn._bound){
          delBtn.addEventListener('click', async ()=>{
            try {
              const pair = (el._currentImages && el._currentImages.paths) ? el._currentImages : null;
              if (!pair || !pair.paths || pair.paths.length !== 2) return;
              // Ensure trash folder
              let trash = config.trashFolder;
              if (!trash) {
                trash = await ipcRenderer.invoke('select-folder');
                if (!trash) return;
                config.trashFolder = trash;
                try { await ipcRenderer.invoke('set-config', config); } catch {}
              }
              const path = require('path');
              // Move both
              for (let i=0;i<2;i++){
                const src = pair.paths[i];
                const name = pair.names[i];
                const dest = path.join(trash, name);
                await ipcRenderer.invoke('move-image', src, dest);
                const itemRef = document.querySelector(`.image-item[data-img='${CSS.escape(name)}']`);
                if (itemRef) {
                  itemRef.classList.add('deleted');
                  itemRef.style.opacity = '0.5';
                  itemRef.style.pointerEvents = 'none';
                  const iconCheckRef = itemRef.querySelector('.image-checkbox i');
                  if (iconCheckRef) {
                    iconCheckRef.classList.remove('bi-check-square-fill');
                    iconCheckRef.classList.add('bi-square');
                  }
                }
              }
              clearCompareSelection();
              try { bootstrap.Modal.getOrCreateInstance(mEl).hide(); } catch {}
              try { bootstrap.Modal.getOrCreateInstance(el).hide(); } catch {}
            } catch {}
          });
          delBtn._bound = true;
        }
        if (openBtn && !openBtn._bound){
          openBtn.addEventListener('click', async ()=>{
            try {
              const pair = (el._currentImages && el._currentImages.paths) ? el._currentImages : null;
              if (!pair || !pair.paths || pair.paths.length !== 2) return;
              if (!config.imageEditorPath) { try { prefModal.show(); } catch {} }
              await ipcRenderer.invoke('open-in-editor', pair.paths[0]);
              await ipcRenderer.invoke('open-in-editor', pair.paths[1]);
              try { bootstrap.Modal.getOrCreateInstance(mEl).hide(); } catch {}
            } catch {}
          });
          openBtn._bound = true;
        }
      }
      ensureCompareActionsModal();
      if (!el._ctxBound){
        const bindCtx = (node)=>{
          if (!node || node._ctxBound) return;
          node.addEventListener('contextmenu', (ev)=>{
            ev.preventDefault();
            const mEl = document.getElementById('compareActionsModal');
            if (!mEl) return;
            bootstrap.Modal.getOrCreateInstance(mEl).show();
          });
          node._ctxBound = true;
        };
        bindCtx(compareSideBySide);
        bindCtx(compareOverlay);
        el._ctxBound = true;
      }

      el._wired = true;
    }

    // Set image sources and show
    const [leftImg, rightImg] = Array.from(compareSelected);
    const leftPath = require('path').join(imageFolder, leftImg);
    const rightPath = require('path').join(imageFolder, rightImg);
    if (cmpLeft) cmpLeft.src = leftPath;
    if (cmpRight) cmpRight.src = rightPath;
    if (ovBase) ovBase.src = leftPath;
    if (ovTop) ovTop.src = rightPath;

    if (el._resetView) el._resetView();
    // Store current image names and absolute paths for actions modal
    el._currentImages = {
      names: [leftImg, rightImg],
      paths: [leftPath, rightPath]
    };
    bootstrap.Modal.getOrCreateInstance(el).show();
  } catch (err) {
    console.error('openCompareModal error:', err);
  }
}

// Listen for menu-triggered events to open Preferences
ipcRenderer.on('open-preferences', () => {
  try { prefModal.show(); } catch {}
});
ipcRenderer.on('show-preferences', () => {
  try { prefModal.show(); } catch {}
});
ipcRenderer.on('menu-preferences', () => {
  try { prefModal.show(); } catch {}
});
ipcRenderer.on('preferences', () => {
  try { prefModal.show(); } catch {}
});

// ----- Help modal HTML -----
const helpModalHtml = `
  <div class="modal fade" id="helpModal" tabindex="-1" aria-labelledby="helpModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg">
      <div class="modal-content bg-dark text-light">
        <div class="modal-header">
          <h5 class="modal-title" id="helpModalLabel">Help</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body" style="max-height:70vh; overflow:auto;">
          <h6>Basics</h6>
          <ul>
            <li>Select an Image Folder on the left to view images.</li>
            <li>Select a Destination Folder on the right.</li>
            <li>Click an image tile to select/deselect it. </li>
            <li>Double-click an image to open a window to view it larger and display image properties.</li>
            <li>Use <strong>Move Selected</strong> to move selected images to the chosen destination.</li>
            <li>Use <strong>Delete Selected</sstrong> to delete the chosen images.</li>
            <li>Right-click an image for actions like <u>Mark to compare</u> or <u>Delete Image</u>.</li>
            <li><strong>Note:</strong>
                <div>- Moved or deleted images will be marked as such in the grid and cannot be re-selected</div>
                <div>- Deleted images are moved to a Trash folder, which you can set in Preferences.</div></li>
            </ul>
          <h6>Compare</h6>
          <ul>
            <li>Ctrl+Left-Click images to mark up to two for comparison (blue highlight), then click Compare.</li>
            <li>In the compare window, drag to pan, mouse wheel to zoom. Use Overlay mode to highlight differences</li>
          </ul>
          <h6>Favorites</h6>
          <ul>
            <li>Click the heart icon to favorite the current folder (source or destination). A filled heart indicates it is already favorited.</li>
            <li>Click Favorites to open your favorites lists. Click a favorite to load it or X to remove it from the list.</li>
          </ul>
          <h6>Zoom Controls</h6>
          <ul>
            <li>Use the footer zoom controls to zoom in/out the grid, or Reset to return to default.</li>
          </ul>
          <h6>Shortcuts</h6>
          <ul>
            <li>Enter: Move selected images (if a destination is chosen).</li>
            <li>F5: Reload current image folder, keeping sort order.</li>
          </ul>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  </div>
`;
if (!document.getElementById('helpModal')) {
  document.body.insertAdjacentHTML('beforeend', helpModalHtml);
}
const helpModal = new bootstrap.Modal(document.getElementById('helpModal'));

// Listen for menu-triggered events to open Help
ipcRenderer.on('open-help', () => { try { helpModal.show(); } catch {} });
ipcRenderer.on('show-help', () => { try { helpModal.show(); } catch {} });
ipcRenderer.on('menu-help', () => { try { helpModal.show(); } catch {} });
ipcRenderer.on('help', () => { try { helpModal.show(); } catch {} });
// Bind footer Help link to open Help modal if present
(function bindHelpLink(){
  const link = document.getElementById('help-show-link');
  if (link && !link._bound){
    link.addEventListener('click', (e)=>{
      e.preventDefault();
      const el = document.getElementById('helpModal');
      if (el) bootstrap.Modal.getOrCreateInstance(el).show();
    });
    link._bound = true;
  }
})();

// ----- Sort Order Modal and Button Binding (footer 'Sort order' button) -----
(function setupSortOrderModal(){
  function ensureSortModal(){
    if (document.getElementById('sortModal')) return;
    const html = `
    <div class="modal fade" id="sortModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header">
            <h5 class="modal-title">Sort Images</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Sort By:</label>
              <select id="sortBySelect" class="form-select bg-dark text-light">
                <option value="name">Name</option>
                <option value="date">Date</option>
                <option value="size">Size</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label">Sort Order:</label>
              <select id="sortOrderSelect" class="form-select bg-dark text-light">
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" id="applySortBtn">Apply</button>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          </div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  const sortBtn = document.getElementById('Sort-by');
  if (sortBtn && !sortBtn._sortBound){
    sortBtn.addEventListener('click', () => {
      ensureSortModal();
      const modalEl = document.getElementById('sortModal');
      const sortBySelect = document.getElementById('sortBySelect');
      const sortOrderSelect = document.getElementById('sortOrderSelect');
      if (sortBySelect) sortBySelect.value = typeof sortBy === 'string' ? sortBy : 'name';
      if (sortOrderSelect) sortOrderSelect.value = typeof sortOrder === 'string' ? sortOrder : 'asc';
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();

      const applyBtn = document.getElementById('applySortBtn');
      if (applyBtn && !applyBtn._applyBound){
        applyBtn.addEventListener('click', async () => {
          // Persist and apply new sort settings
          const newBy = sortBySelect ? sortBySelect.value : 'name';
          const newOrder = sortOrderSelect ? sortOrderSelect.value : 'asc';
          sortBy = newBy; sortOrder = newOrder;
          config.sortBy = sortBy; config.sortOrder = sortOrder;
          try { await ipcRenderer.invoke('set-config', config); } catch {}
          if (typeof sortImagesList === 'function') sortImagesList();
          loadedCount = 0;
          if (imageList) imageList.innerHTML = '';
          loadImagesBatch();
          // Optional: reflect current sort in footer span if present
          const sortType = document.getElementById('sort-type');
          if (sortType) sortType.textContent = ` ${sortBy} (${sortOrder})`;
          modal.hide();
        });
        applyBtn._applyBound = true;
      }
    });
    sortBtn._sortBound = true;
  }
})();
