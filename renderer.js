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
              <p>Are you sure you want to delete ${selectedImages.size} images?</p>
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
      modalImg.style.maxWidth = '100vw';
      modalImg.style.maxHeight = '80vh';
      modalImg.style.width = 'auto';
      modalImg.style.height = 'auto';
      modalImg.style.margin = 'auto';
      modalImg.style.objectFit = 'contain';
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
      // Close modal on click anywhere
      const closeHandler = () => {
        modal.hide();
        modalEl.removeEventListener('click', closeHandler);
      };
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
      // Handle both string format (old) and object format (new)
      const isObj = folder && typeof folder === 'object';
      const name = isObj ? folder.name : String(folder);
      const fullPath = isObj ? folder.path : require('path').join(dirFolder, String(folder));
      const safeId = `radio-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.innerHTML = `
        <input type="radio" name="folderRadio" value="${name}" id="${safeId}" data-path="${fullPath}">
        <label for="${safeId}" class="ms-2">${name}</label>
      `;
      folderList.appendChild(item);
      
      // Radio change handler
      item.querySelector('input[type=radio]').onchange = (e) => {
        if (e.target.checked) {
          selectedDir = fullPath; // Use the full path from data-path attribute
          updateHeartStates();
        }
      };
      
      // Add right-click context menu for folder management
      item.oncontextmenu = async (e) => {
        e.preventDefault();
        
        // Remove any existing menu
        let existing = document.getElementById('folder-context-menu');
        if (existing) existing.remove();
        
        const menu = document.createElement('div');
        menu.id = 'folder-context-menu';
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
        menu.style.minWidth = '220px';
        
        menu.innerHTML = `
          <div class="ctx-item" data-action="create-folder" style="padding:8px 16px; cursor:pointer;">
            <i class="bi bi-folder-plus me-2"></i>Create New Folder Here
          </div>
          <div class="ctx-sep" style="height:1px;background:#444;margin:4px 0;"></div>
          <div class="ctx-item" data-action="create-shortcut" style="padding:8px 16px; cursor:pointer;">
            <i class="bi bi-link-45deg me-2"></i>Create Shortcut to Folder
          </div>
          <div class="ctx-item" data-action="create-symlink" style="padding:8px 16px; cursor:pointer;">
            <i class="bi bi-box-arrow-in-down-right me-2"></i>Create Symbolic Link
          </div>
        `;
        
        document.body.appendChild(menu);
        
        menu.addEventListener('click', async (ev) => {
          const itemEl = ev.target.closest('.ctx-item');
          if (!itemEl) return;
          const action = itemEl.getAttribute('data-action');
          
          if (action === 'create-folder') {
            // Prompt for folder name
            const folderName = prompt('Enter new folder name:');
            if (!folderName) {
              menu.remove();
              return;
            }
            
            const newFolderPath = require('path').join(dirFolder, folderName);
            
            try {
              await ipcRenderer.invoke('create-directory', newFolderPath);
              // Refresh folder list
              loadFolders();
              // Show success message briefly
              showToast('Folder created successfully!', 'success');
            } catch (error) {
              alert(`Failed to create folder: ${error.message}`);
            }
            menu.remove();
            return;
          }
          
          if (action === 'create-shortcut') {
            // Select target folder
            const targetPath = await ipcRenderer.invoke('select-folder');
            if (!targetPath) {
              menu.remove();
              return;
            }
            
            // Prompt for shortcut name
            const shortcutName = prompt('Enter shortcut name:', require('path').basename(targetPath));
            if (!shortcutName) {
              menu.remove();
              return;
            }
            
            const shortcutPath = require('path').join(dirFolder, shortcutName + '.lnk');
            
            try {
              await ipcRenderer.invoke('create-shortcut', targetPath, shortcutPath);
              // Refresh folder list
              loadFolders();
              showToast('Shortcut created successfully!', 'success');
            } catch (error) {
              alert(`Failed to create shortcut: ${error.message}`);
            }
            menu.remove();
            return;
          }
          
          if (action === 'create-symlink') {
            // Select target folder
            const targetPath = await ipcRenderer.invoke('select-folder');
            if (!targetPath) {
              menu.remove();
              return;
            }
            
            // Prompt for link name
            const linkName = prompt('Enter symbolic link name:', require('path').basename(targetPath));
            if (!linkName) {
              menu.remove();
              return;
            }
            
            const linkPath = require('path').join(dirFolder, linkName);
            
            try {
              const result = await ipcRenderer.invoke('create-symlink', targetPath, linkPath);
              if (result.success) {
                // Refresh folder list
                loadFolders();
                showToast('Symbolic link created successfully!', 'success');
              }
            } catch (error) {
              // Show detailed error message
              const errorMsg = error.message;
              if (errorMsg.includes('administrator privileges') || errorMsg.includes('Developer Mode')) {
                // Show a more helpful modal
                showSymlinkHelpModal(errorMsg);
              } else {
                alert(`Failed to create symbolic link: ${errorMsg}`);
              }
            }
            menu.remove();
            return;
          }
        });
        
        // Close menu on click elsewhere
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
  });
}

// Helper function to show toast notifications
function showToast(message, type = 'info') {
  // Remove any existing toast
  let existing = document.getElementById('toast-notification');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.id = 'toast-notification';
  toast.style.position = 'fixed';
  toast.style.bottom = '80px';
  toast.style.right = '20px';
  toast.style.zIndex = 10000;
  toast.style.padding = '12px 20px';
  toast.style.borderRadius = '6px';
  toast.style.color = '#fff';
  toast.style.fontSize = '14px';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  toast.style.transition = 'opacity 0.3s';
  toast.style.opacity = '1';
  
  // Set color based on type
  if (type === 'success') {
    toast.style.background = '#28a745';
  } else if (type === 'error') {
    toast.style.background = '#dc3545';
  } else {
    toast.style.background = '#17a2b8';
  }
  
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Fade out and remove after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Helper function to show symlink help modal
function showSymlinkHelpModal(errorMessage) {
  // Remove any existing modal
  let existing = document.getElementById('symlinkHelpModal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'symlinkHelpModal';
  modal.className = 'modal fade';
  modal.tabIndex = -1;
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content bg-dark text-light">
        <div class="modal-header">
          <h5 class="modal-title"><i class="bi bi-exclamation-triangle me-2"></i>Administrator Privileges Required</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <p><strong>Creating symbolic links on Windows requires special permissions.</strong></p>
          <p class="mb-3">${errorMessage}</p>
          <div class="alert alert-info">
            <strong>Quick Alternative:</strong> Use "Create Shortcut to Folder" instead! 
            It works without admin rights and achieves the same result.
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Got it</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
  
  // Clean up after modal is hidden
  modal.addEventListener('hidden.bs.modal', () => {
    modal.remove();
  });
}
