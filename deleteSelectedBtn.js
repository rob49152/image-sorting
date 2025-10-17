const deleteSelectedBtn = document.getElementById('delete-selected');

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
  // ...existing delete logic here...
};
