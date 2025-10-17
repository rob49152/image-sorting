function readImageMetadata(file) {
    // Only PNG for now; JPEG/WEBP can be added later
    const reader = new FileReader();
    reader.onload = function (e) {
        const arr = new Uint8Array(e.target.result);
        let text = '';
        // PNG text chunk extraction
        if (file.type === 'image/png') {
            let i = 8; // skip PNG header
            while (i < arr.length) {
                let length = (arr[i] << 24) | (arr[i + 1] << 16) | (arr[i + 2] << 8) | arr[i + 3];
                let type = String.fromCharCode(arr[i + 4], arr[i + 5], arr[i + 6], arr[i + 7]);
                if (type === 'tEXt' || type === 'iTXt') {
                    let chunk = arr.slice(i + 8, i + 8 + length);
                    let chunkText = new TextDecoder().decode(chunk);
                    if (chunkText.match(/Steps:|Negative prompt:/)) {
                        text = chunkText;
                        break;
                    }
                }
                i += 8 + length + 4;
            }
        }
        // Fallback: try EXIF for JPEG/WEBP (not implemented yet)
        if (!text) text = 'Prompt not found.';
        // Parse prompt metadata
        const parsed = parsePrompt(text);
        showPrompt(parsed);
    };
    reader.readAsArrayBuffer(file);
}

// New: Electron-friendly reader from absolute file path
async function readImageMetadataFromPath(filePath) {
    try {
        const fs = require('fs');
        const path = require('path');
        let text = '';
        const ext = (path.extname(filePath) || '').toLowerCase();
        const buf = fs.readFileSync(filePath);

        if (ext === '.png') {
            // Parse PNG chunks
            let i = 8; // PNG header
            while (i + 8 <= buf.length) {
                const length = buf.readUInt32BE(i);
                const type = buf.toString('ascii', i + 4, i + 8);
                const dataStart = i + 8;
                const dataEnd = dataStart + length;
                if (dataEnd > buf.length) break;
                if (type === 'tEXt' || type === 'iTXt') {
                    const chunkText = buf.slice(dataStart, dataEnd).toString('utf8');
                    if (/Steps:|Negative prompt:/i.test(chunkText)) {
                        text = chunkText;
                        break;
                    }
                }
                i = dataEnd + 4; // skip CRC
            }
        } else if (ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
            // Best-effort: search for plain text parameters or XMP area
            let found = '';
            const utf8 = buf.toString('utf8');
            // Prefer a parameters-like block
            const paramIdx = utf8.search(/parameters|Negative prompt:|Steps:/i);
            if (paramIdx !== -1) {
                found = utf8.slice(paramIdx);
            } else {
                // Try XMP area
                const xmpStart = utf8.indexOf('<x:xmpmeta');
                const xmpEnd = utf8.indexOf('</x:xmpmeta>');
                if (xmpStart !== -1 && xmpEnd !== -1) {
                    found = utf8.slice(xmpStart, xmpEnd + 12);
                }
            }
            text = found || '';
        }

        if (!text) text = 'Prompt not found.';
        const parsed = parsePrompt(text);
        showPrompt(parsed);
    } catch (err) {
        // Silent fail to avoid disrupting existing app behavior
        try { showPrompt({ prompt: '', negative: '', params: {} }); } catch {}
    }
}

// Parse prompt metadata into positive, negative, and other metadata
function parsePrompt(raw) {
    if (!raw) return { prompt: '', negative: '', params: {}, tool: '', sdxl: false };
    // Remove any leading "parameters" line
    raw = raw.replace(/^parameters\s*/i, '');

    // Find boundaries
    const negIdx = raw.search(/\n?Negative prompt:/i);
    const stepsIdx = raw.search(/\n?Steps:/i);

    // 1. Positive prompt: all text up to "Negative prompt"
    let positive = negIdx !== -1 ? raw.slice(0, negIdx).replace(/^Prompt:/i, '').trim() : raw.trim();

    // 2. Negative prompt: from "Negative prompt" up to "Steps"
    let negative = '';
    if (negIdx !== -1 && stepsIdx !== -1 && stepsIdx > negIdx) {
        negative = raw.slice(negIdx, stepsIdx).replace(/\n?Negative prompt:/i, '').trim();
    } else if (negIdx !== -1) {
        negative = raw.slice(negIdx).replace(/\n?Negative prompt:/i, '').trim();
    }

    // 3. Other metadata: from "Steps" to end
    let setting = '';
    if (stepsIdx !== -1) {
        setting = raw.slice(stepsIdx).trim();
    }
    let params = {};
    let paramLines = setting.split('\n');
    paramLines.forEach(line => {
        let m = line.match(/^([\w ][\w ]*):\s*(.+)$/);
        if (m) {
            params[m[1]] = m[2];
        }
    });

    // Return the split metadata
    return { prompt: positive, negative, params, tool: 'AUTOMATIC1111', sdxl: false };
}

function showPrompt(data) {
    // Fill textareas if they exist
    const pos = document.getElementById('positive-prompt');
    if (pos) pos.value = data && data.prompt ? data.prompt : '';
    const neg = document.getElementById('negative-prompt');
    if (neg) neg.value = data && data.negative ? data.negative : '';
    const plist = document.getElementById('param-list');
    if (plist) {
        let metaText = '';
        if (data && data.params) {
            metaText = Object.keys(data.params).sort().map(key => `${key}: ${data.params[key]}`).join('\n');
        }
        plist.value = metaText;
    }
}

// CRC32 helper for PNG chunk
function crc32(buf) {
    let table = window._crcTable;
    if (!table) {
        table = window._crcTable = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
            table[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
}

// Hook: when Image Info modal is shown, read the displayed image and populate prompts
(function hookImageInfoModal(){
    try {
        document.addEventListener('shown.bs.modal', (ev) => {
            const modal = ev.target;
            if (!modal || modal.id !== 'imgModal') return;
            const imgEl = document.getElementById('modal-img-preview');
            if (!imgEl || !imgEl.src) return;
            let src = imgEl.src;
            try {
                if (src.startsWith('file://')) {
                    const { URL } = window;
                    const u = new URL(src);
                    // On Windows, pathname starts with /C:/...
                    let p = decodeURIComponent(u.pathname);
                    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
                    readImageMetadataFromPath(p);
                } else {
                    readImageMetadataFromPath(src);
                }
            } catch { readImageMetadataFromPath(src); }
        });
    } catch {}
})();