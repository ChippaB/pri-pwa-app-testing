// ===== CONFIG =====
// REPLACE THIS WITH YOUR NEW DEPLOYED SCRIPT URL (ending in /exec)
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbyZio2iE1piL2hczpUgDx26EBn0_NxAj5o9vlFG6a8JoRD9lDu-B7VOH903_ArWaF4t/exec'; 

const SHARED_SECRET = 'qk92X3vE7LrT8c59H1zUM4Bn0ySDFwGp';

const PART_NUMBER_MAP = {
  '0100810016250258': '536713-001', 
  '0100810016250265': '536713-002', 
  '0100810016250326': '536713-004', 
  '0100810016250296': '536713-005', 
  '0100810016250302': '536719-001',
  '0100810016250289': '536723-001', 
  '0100810016250333': '536723-004', 
  '0100812574026603': '301-PFR60WEL', 
  '0100812574026597': '301-PFR60WE2', 
  '0100810016250272': '536719-004',
  '0100812574024722': '301-PFR80WKN'
};

// ===== HELPERS DEFINED FIRST =====
function unlockAudioOnFirstTap() {
  initAudio();
  document.body.removeEventListener('touchstart', unlockAudioOnFirstTap);
}

// ===== DOM Elements =====
const $ = s => document.querySelector(s);
const statusBox = $('#status'), lastSerial = $('#lastSerial'), lastPart = $('#lastPart');
const scanInput = $('#scan'), operatorInput = $('#operator'), stationSel = $('#station');
const queueInfo = $('#queueInfo'), clearBtn = $('#clearBtn');
const historyToggle = $('#historyToggle'), historyPanel = $('#historyPanel');
const lastScanStatus = $('#lastScanStatus');
const lockBtn = $('#lockBtn'), unlockBtn = $('#unlockBtn')
const correctionModal = $('#correctionModal');
const modalContext = $('#modalContext');
const correctionText = $('#correctionText');
const btnCancelCorrection = $('#cancelCorrection');
const btnSaveCorrection = $('#saveCorrection');
let currentEditItem = null; // Tracks which scan we are annotating

// Audio
let audioContext;
function initAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playBeep(freq, type = 'sine') {
  try {
    initAudio();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain); gain.connect(audioContext.destination);
    osc.frequency.value = freq; osc.type = type;
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    osc.start(); osc.stop(audioContext.currentTime + 0.1);
  } catch (e) {}
}

function playSoundSuccess() { 
  playBeep(880, 'sine'); 
  // Full-screen green flash
  document.body.style.transition = 'background-color 0.3s';
  document.body.style.backgroundColor = '#10b981';
  setTimeout(() => {
    document.body.style.backgroundColor = '';
  }, 300);
}

function playSoundDuplicate() { 
  playBeep(440, 'sine'); 
  // Orange flash
  document.body.style.transition = 'background-color 0.3s';
  document.body.style.backgroundColor = '#f59e0b';
  setTimeout(() => {
    document.body.style.backgroundColor = '';
  }, 300);
}

function playSoundError() { 
  playBeep(220, 'sawtooth'); 
  // Red flash
  document.body.style.transition = 'background-color 0.3s';
  document.body.style.backgroundColor = '#ef4444';
  setTimeout(() => {
    document.body.style.backgroundColor = '';
  }, 300);
}

function show(msg, cls) {
  statusBox.innerHTML = msg; statusBox.className = 'status show ' + cls;
  setTimeout(() => statusBox.classList.remove('show'), 2500);
}

function savePrefs() { localStorage.setItem('operator', operatorInput.value.trim()); localStorage.setItem('station', stationSel.value); }
function loadPrefs() { operatorInput.value = localStorage.getItem('operator') || ''; stationSel.value = localStorage.getItem('station') || 'MAIN'; }

function parsePN_SN(s) {
  const raw = String(s).toUpperCase().trim();

  // ===============================================
  // 1. GS1-128 FORMAT (Starts with 01)
  // Example: 01008100162502891125111021MGCK2114181
  // ===============================================
  if (raw.startsWith('01')) {
      const prefix = raw.substring(0, 16); // '01' + 14 digits (GTIN)
      let part = PART_NUMBER_MAP[prefix]; // <--- Use 'let' so we can change it later
      
      let remainder = raw.substring(16); // Strip the GTIN first
      let serial = ''; // Corrected variable name

      // STEP A: Check for Dates (length is always AI(2) + Date(6) = 8 chars)
      if (remainder.startsWith('11') || remainder.startsWith('17') || remainder.startsWith('13')) {
        remainder = remainder.substring(8); // Skip the date block
      }

      // STEP B: Check for Serial Number AI (21)
      if (remainder.startsWith('21')) {
        serial = remainder.substring(2); // Assign to 'serial'
      } else {
        // Fallback: If no '21' found, assume whatever is left is the serial
        serial = remainder; // Assign to 'serial'
      }

      // === NEW: Special Case for PFR... Part IDs Embedded in Serial Number ===
      // If the serial number contains the PFR pattern, extract the Part ID from it.
      if (serial) {
          // Regex to find 'PFR' followed by 3 to 10 alphanumeric characters (case-insensitive)
          const pfrMatch = serial.match(/^(PFR[A-Z0-9]{3,10})/i); 

          if (pfrMatch) {
              // The full matching Part ID (e.g., PFR8WK)
              const identifiedPartId = pfrMatch[1].toUpperCase();

              // 1. Assign the extracted Part ID, overriding the GTIN lookup if necessary
              part = identifiedPartId; 

              // 2. Clean the Serial Number (remove the Part ID prefix)
              serial = serial.substring(identifiedPartId.length); 

              // Handle the case where the serial number was ONLY the part ID (e.g., 'PFR8WK')
              if (!serial) {
                  serial = identifiedPartId; 
              } else {
                  // Optional: Remove any leading non-alphanumeric characters (like a hyphen)
                  serial = serial.replace(/^[^A-Z0-9]+/, ''); 
              }

              // Return immediately to prevent the final 'UNKNOWN' fallback
              return { part, serial }; 
          }
      }
      
      // Final Fallback: Uses the GTIN lookup result OR defaults to UNKNOWN
      return part ? { part, serial } : { part: 'UNKNOWN', serial };
  }
  
  // ===============================================
  // 2. HIBC FORMAT (Starts with +)
  // Example: +B446100760E1/$+760E13261/
  // ===============================================
  if (raw.includes('/$+')) {
    const parts = raw.split('/$+');
    if (parts.length < 2) return { part:'', serial:'' };
    let p = parts[0], sNum = parts[1];
    
    // HIBC Specific Cleanup
    if (p.startsWith('+B')) {
      p = p.substring(1); 
      if (p.startsWith('B')) p = p.substring(1); 
      
      // Only strip '+' from serial
      if (sNum.startsWith('+')) sNum = sNum.substring(1);
      
    } else {
      if (sNum.startsWith('+')) sNum = sNum.substring(1);
    }

    // Remove trailing slash OR trailing digit (checksum)
    if (sNum.endsWith('/')) {
      sNum = sNum.substring(0, sNum.length - 1);
    } else if (sNum.match(/\d$/)) {
      // Special case: P5556100 KEEPS the trailing checksum digit
      if (p !== 'P5556100') {
        // Remove last digit for all other parts
        sNum = sNum.substring(0, sNum.length - 1);
      }
    }
        // Remove trailing slash OR trailing digit (checksum)
    if (sNum.endsWith('/')) {
      sNum = sNum.substring(0, sNum.length - 1);
    } else if (sNum.match(/\d$/)) {
      // Special case: P5556100 KEEPS the trailing checksum digit
      if (p !== 'P5556100') {
        // Remove last digit for all other parts
        sNum = sNum.substring(0, sNum.length - 1);
      }
    }

    // [YOUR CUSTOM UX CLEANUP]
    // CONSOLIDATED RULE: Strip leading '446' and trailing character for special part formats.
    // This handles: 
    // 1. All new PUL formats (e.g., 446PUL9000E20 -> PUL9000E2)
    // 2. The old hardcoded PUL case (446PUL9000K0 -> PUL9000K)
    // 3. The old general case (446758W1 -> 758W)
    if (p.startsWith('446') && p.length > 4 && (p.includes('PUL') || p.endsWith('1') || p.endsWith('0'))) {
        p = p.substring(3, p.length - 1);
    }

    return { part: p, serial: sNum };
  }

  return { part: '', serial: '' };
}


// New client-side serial cleaner (for display purposes)
function cleanSerialClient(rawSerial) {
  if (!rawSerial) return "";
  let cleaned = rawSerial.toString();
  // Strip trailing non-numeric characters (garbage/checksums like B, -, $, ., etc.)
  cleaned = cleaned.replace(/[^0-9]+$/, '');
  return cleaned.trim();
}

// === NEW: Check for duplicates locally to allow instant scanning ===
function checkLocalDuplicate(serial) {
  const h = getHistory();
  // Returns true if this serial exists in history and wasn't an error
  return h.some(item => item.serial === serial && item.status !== 'ERR' && item.status !== 'ERROR');
}

// === NEW: Update a specific history item's status after background upload ===
function updateHistoryStatus(serial, newStatus) {
  const key = getHistoryKey();
  let h = getHistory();
  const index = h.findIndex(i => i.serial === serial);
  
  if (index !== -1) {
    h[index].status = newStatus;
    localStorage.setItem(key, JSON.stringify(h));
    renderHistory(); // Refresh the list to show the green badge
  }
}

function getLastScanKey() { 
  const op = operatorInput.value.trim() || 'UNNAMED';
  const st = stationSel.value || 'MAIN';
  return `lastScan_${op}_${st}`; 
}

function saveLastScan(part, serial, status) {
  const key = getLastScanKey();
  const scanData = { part, serial, status, timestamp: new Date().toISOString() };
  localStorage.setItem(key, JSON.stringify(scanData));
  console.log('💾 Saved last scan:', key);
}

function loadLastScan() {
  const key = getLastScanKey();
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const data = JSON.parse(stored);
      lastPart.textContent = data.part || '—';
      lastSerial.textContent = data.serial || '—';
      lastScanStatus.textContent = data.status || '';
      console.log('📂 Loaded last scan for:', key);
      return;
    } catch (e) {
      console.warn('Error loading last scan:', e);
    }
  }
  // Default: show dashes
  lastPart.textContent = '—';
  lastSerial.textContent = '—';
  lastScanStatus.textContent = '';
}

function getQueue() { return JSON.parse(localStorage.getItem('queue') || '[]'); }
function setQueue(q) { localStorage.setItem('queue', JSON.stringify(q)); renderQueue(); }
function enqueue(item) { const q = getQueue(); q.push(item); setQueue(q); }
function renderQueue() {
  const q = getQueue();
  queueInfo.innerHTML = q.length ? `<span class="queue-indicator"><span class="queue-badge">${q.length}</span> Pending</span>` : '';
}

function getHistoryKey() { return `history_${operatorInput.value.trim() || 'UNNAMED'}`; }
function getHistory() { try { return JSON.parse(localStorage.getItem(getHistoryKey()) || '[]'); } catch { return []; } }
function addToHistory(item) {
  const key = getHistoryKey();
  let h = getHistory();
  if (h.length > 0 && new Date(h[0].timestamp).toDateString() !== new Date().toDateString()) h = [];
  h.unshift(item);
  localStorage.setItem(key, JSON.stringify(h));
  renderHistory();
}
function renderHistory() {
  const h = getHistory();
  historyPanel.innerHTML = '';
  if (!h.length) { historyPanel.innerHTML = '<div style="padding:12px;color:#888">No scans today.</div>'; return; }

  h.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    let statusClass = (item.status || 'ERR').toLowerCase();
    if (statusClass.includes('dup')) statusClass = 'dup';
    else if (statusClass.includes('off') || statusClass.includes('err')) statusClass = 'queued';
    else statusClass = 'ok';
    
    let badgeStyle = '';
    if (statusClass === 'ok') badgeStyle = 'background:#d1fae5; color:#065f46;';
    if (statusClass === 'dup') badgeStyle = 'background:#fef3c7; color:#92400e;';
    if (statusClass === 'queued') badgeStyle = 'background:#dbeafe; color:#1e40af;';

    div.innerHTML = `
      <div class="scan-data-col"><div class="data-label">Ref</div><div class="history-part-num">${item.part}</div></div>
      <div class="scan-data-col"><div class="data-label">Serial</div><div class="history-serial-num">${item.serial}</div></div>
      <div class="scan-data-col">
         <div class="data-label">Status</div>
         <div class="history-status" style="${badgeStyle}">${item.status}</div>
         <div class="history-time">${new Date(item.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
      </div>
      <button class="history-edit-btn" data-part="${item.part}" data-serial="${item.serial}">✎</button>
    `;
    historyPanel.appendChild(div);
  });
}

// === FIX 1: Robust Send Function ===
async function send(payload, fromQueue = false) {
  const startTime = Date.now();
  
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify(payload),
      cache: 'no-cache',
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });

    if (!res.ok) {
        console.error('Server returned non-OK HTTP status:', res.status);
        return 'ERROR';
    }

    let data = {};
    const text = await res.text();
    try { 
      data = JSON.parse(text); 
    } catch(e) { 
      console.warn("JSON parse error:", text, e); 
      return 'ERROR'; 
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Scan saved in ${elapsed}s - Response received:`, data);

    const status = data.status;

    if (status === 'OK' || status === 'DUPLICATE') {
      if (status === 'OK') playSoundSuccess(); else playSoundDuplicate();
      if (!fromQueue) show(`✅ SAVED (${elapsed}s)`, status === 'OK' ? 'ok' : 'dup');
      return status;
    }

    // LOGIC CHANGE: Only play sounds/show main status if NOT from background queue
    if (!fromQueue) {
        if (status === 'OK') playSoundSuccess();
        else playSoundDuplicate();
        show(`✅ SAVED (${elapsed}s)`, status === 'OK' ? 'ok' : 'dup');
    } else {
        // Background mode: Console log only
        console.log(`Background upload result for ${payload.serial_number}: ${status}`);
    }

    return status;

  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error("Fetch failed after " + elapsed + "s:", e.message || e);
    
    if (!fromQueue) {
      if (elapsed >= 29) {
        show('⏳ Slow Network - Saved for Later', 'queued');
      } else {
        show('📡 No Connection - Saved for Later', 'queued');
      }
    }
    playSoundError();
    return 'OFFLINE';
  }
}

// === FIX 2 & 3: Scan Event Listener Update ===
// Scan lock to prevent double-scanning
let isProcessing = false;

scanInput.addEventListener('keydown', async (ev) => {
  if (ev.key !== 'Enter') return;
  
  // PREVENT DOUBLE SCANS - Critical fix!
  if (isProcessing) {
    playSoundError();
    return;
  }
  
  // --- CRITICAL FRONTEND CLEANUP ---
  let raw = scanInput.value.trim(); 
  if (!raw) return;

  // 1. Remove all invisible control characters (ASCII 0-31, 127) to fix JSON corruption
  raw = raw.replace(/[\x00-\x1F\x7F]/g, ''); 

  // 2. Remove the single quote prefix added by the scanner (if any)
  if (raw.startsWith("'")) {
    raw = raw.substring(1);
  }
  // --- END OF CRITICAL FRONTEND CLEANUP ---
  
  const parsed = parsePN_SN(raw);
  
  // Clean serial number for display and payload (removes trailing junk like '.')
  const cleanedSerial = cleanSerialClient(parsed.serial);
  const cleanedPart = parsed.part;

  if (!cleanedSerial) { show('INVALID FORMAT', 'err'); playSoundError(); scanInput.value=''; return; }

  // === IMMEDIATE FEEDBACK - Clear field right away! ===
  scanInput.value = '';
  clearBtn.style.display = 'none';
  
  // Lock scanning and show processing state
  isProcessing = true;
  scanInput.disabled = true;
  scanInput.style.opacity = '0.5';
  show('⏳ Sending...', 'queued');
  
  // Update display immediately (optimistic UI)
  lastPart.textContent = cleanedPart || 'N/A';
  lastSerial.textContent = cleanedSerial;
  lastScanStatus.textContent = 'PROCESSING';
  lastScanStatus.style.cssText = 'background:#dbeafe; color:#1e40af;';
  
  const payload = {
    secret: SHARED_SECRET,
    operator: operatorInput.value || 'UNNAMED',
    station: stationSel.value,
    raw_scan: raw,
    part_number: cleanedPart,
    serial_number: cleanedSerial,
    comment: $('#generalNote').value.trim()
  };

  // Send in background
  const status = await send(payload);
  
  // Update final status
  let statusClass = 'ok';
  if (status === 'DUPLICATE') statusClass = 'dup';
  if (status === 'OFFLINE' || status === 'ERROR') statusClass = 'queued';
  
  lastScanStatus.textContent = status;
  lastScanStatus.className = 'history-status';
  
  if (status === 'OK') lastScanStatus.style.cssText = 'background:#d1fae5; color:#065f46;';
  else if (status === 'DUPLICATE') lastScanStatus.style.cssText = 'background:#fef3c7; color:#92400e;';
  else lastScanStatus.style.cssText = 'background:#fee2e2; color:#991b1b;';

  // Add to history using CLEANED serial
  addToHistory({ part: cleanedPart, serial: cleanedSerial, status, timestamp: new Date() });
  
  // Save last scan to localStorage (per operator/station)
  saveLastScan(cleanedPart, cleanedSerial, status);
  
  if (status === 'OFFLINE') enqueue(payload);

  // === UNLOCK SCANNING ===
  isProcessing = false;
  scanInput.disabled = false;
  scanInput.style.opacity = '1';
  scanInput.focus();
});


// === UPDATED: Process the queue in background ===
async function drainQueue() {
  const q = getQueue();
  if (!q.length) return;

  const nextItem = q[0];
  
  // Update UI to show we are working on it (optional, mainly for debugging)
  console.log(`📤 Background uploading: ${nextItem.serial_number}...`);

  // Send with fromQueue = true (suppresses sounds)
  const status = await send(nextItem, true);

  // If successful or hard duplicate, remove from queue and update history
  if (status === 'OK' || status === 'DUPLICATE') {
    // 1. Update the visual history list
    updateHistoryStatus(nextItem.serial_number, status);
    
    // 2. Remove from queue
    q.shift();
    setQueue(q);
    
    // 3. Process next item immediately
    setTimeout(drainQueue, 1000); 
  } else if (status === 'ERROR') {
      // If hard error, maybe keep in queue or move to error state? 
      // For now, we keep it to retry, but you could add logic to skip after X retries
  }
}

// Run queue check every 5 seconds (more frequent than before)
setInterval(drainQueue, 5000);

clearBtn.onclick = () => { scanInput.value=''; clearBtn.style.display='none'; scanInput.focus(); };
scanInput.oninput = () => clearBtn.style.display = scanInput.value ? 'flex' : 'none';

// NEW: The 'Clear' button for the Batch Comments box
const clearNoteBtn = document.querySelector('#clearNoteBtn');
// Show visual indicator when batch comment is active
const generalNoteInput = $('#generalNote');
const scanCard = document.querySelector('.card'); // The scan input card

generalNoteInput.addEventListener('input', () => {
  const scanCards = document.querySelectorAll('.card');
  const scanInputCard = scanCards[2]; // Third card is scan input
  
  if (generalNoteInput.value.trim()) {
    scanInputCard.style.borderLeft = '6px solid #f59e0b';
    scanInputCard.style.background = '#fffbeb';
  } else {
    scanInputCard.style.borderLeft = '';
    scanInputCard.style.background = '';
  }
});

if (clearNoteBtn && generalNoteInput) {
  clearNoteBtn.onclick = () => {
    generalNoteInput.value = ''; 
    generalNoteInput.dispatchEvent(new Event('input')); // Trigger visual reset
    generalNoteInput.focus();
  };
}
// === BATCH COMMENT LOCK FUNCTIONALITY ===
function getBatchCommentKey() {
  const op = operatorInput.value.trim() || 'UNNAMED';
  const st = stationSel.value || 'MAIN';
  return `batchComment_${op}_${st}`;
}

function getBatchLockKey() {
  const op = operatorInput.value.trim() || 'UNNAMED';
  const st = stationSel.value || 'MAIN';
  return `batchLocked_${op}_${st}`;
}

function loadBatchComment() {
  const key = getBatchCommentKey();
  const lockKey = getBatchLockKey();
  const isLocked = localStorage.getItem(lockKey) === 'true';
  
  if (isLocked) {
    const savedComment = localStorage.getItem(key) || '';
    generalNoteInput.value = savedComment;
    updateBatchLockUI(true);
    console.log('📂 Loaded locked batch comment:', savedComment);
  } else {
    updateBatchLockUI(false);
  }
  
  // Trigger visual indicator
  generalNoteInput.dispatchEvent(new Event('input'));
}

function updateBatchLockUI(locked) {
  const lockBtn = document.getElementById('lockBatchBtn');
  const lockStatus = document.getElementById('batchLockStatus');
  const lockOperator = document.getElementById('batchLockOperator');
  
  if (locked) {
    lockStatus.style.display = 'block';
    lockOperator.textContent = `${operatorInput.value} at ${stationSel.value}`;
    lockBtn.innerHTML = '🔓 Unlock Comment';
    lockBtn.style.background = 'var(--warning)';
    generalNoteInput.disabled = true;
    generalNoteInput.style.opacity = '0.7';
  } else {
    lockStatus.style.display = 'none';
    lockBtn.innerHTML = '🔒 Lock Comment';
    lockBtn.style.background = 'var(--success)';
    generalNoteInput.disabled = false;
    generalNoteInput.style.opacity = '1';
  }
}

// Lock/Unlock Button Handler
document.getElementById('lockBatchBtn').addEventListener('click', () => {
  const lockKey = getBatchLockKey();
  const commentKey = getBatchCommentKey();
  const isCurrentlyLocked = localStorage.getItem(lockKey) === 'true';
  
  if (!isCurrentlyLocked) {
    // LOCK IT
    const comment = generalNoteInput.value.trim();
    if (!comment) {
      show('❌ Enter a comment first!', 'err');
      playSoundError();
      return;
    }
    
    localStorage.setItem(lockKey, 'true');
    localStorage.setItem(commentKey, comment);
    updateBatchLockUI(true);
    show('🔒 Batch Comment Locked!', 'ok');
    playSoundSuccess();
    console.log('🔒 Locked batch comment:', comment);
  } else {
    // UNLOCK IT
    if (confirm('Unlock batch comment?')) {
      localStorage.setItem(lockKey, 'false');
      updateBatchLockUI(false);
      show('🔓 Batch Comment Unlocked', 'ok');
      playSoundSuccess();
      console.log('🔓 Unlocked batch comment');
    }
  }
});

// Update Clear Button to work with Lock
const originalClearHandler = clearNoteBtn.onclick;
clearNoteBtn.onclick = () => {
  const lockKey = getBatchLockKey();
  const isLocked = localStorage.getItem(lockKey) === 'true';
  
  if (isLocked) {
    // Clear AND unlock
    if (confirm('This will clear and unlock the batch comment. Continue?')) {
      generalNoteInput.value = '';
      localStorage.setItem(lockKey, 'false');
      localStorage.removeItem(getBatchCommentKey());
      updateBatchLockUI(false);
      generalNoteInput.dispatchEvent(new Event('input'));
      generalNoteInput.focus();
      show('🔓 Comment Cleared & Unlocked', 'ok');
      playSoundSuccess();
    }
  } else {
    // Just clear normally
    if (originalClearHandler) originalClearHandler();
  }
};

historyToggle.onclick = () => { 
  historyPanel.classList.toggle('expanded'); 
  if(historyPanel.classList.contains('expanded')) renderHistory();
};
// === FIX 2 & 3: Scan Event Listener (OPTIMISTIC MODE) ===
scanInput.addEventListener('change', async () => {
  const raw = scanInput.value.trim();
  if (!raw) return;

  // 1. Prevent double-scanning logic
  if (isProcessing) return;
  isProcessing = true;
  scanInput.disabled = true;

  // 2. Parse & Clean
  const { part, serial } = parsePN_SN(raw);
  const cleanedSerial = cleanSerialClient(serial);
  const cleanedPart = part || 'UNKNOWN';

  // 3. FAST CHECK: Local Duplicate?
  if (checkLocalDuplicate(cleanedSerial)) {
    playSoundDuplicate();
    show('⚠️ DUPLICATE (Local)', 'dup');
    
    // Update display to show the duplicate details
    lastPart.textContent = cleanedPart;
    lastSerial.textContent = cleanedSerial;
    lastScanStatus.textContent = 'DUPLICATE';
    lastScanStatus.className = 'history-status';
    lastScanStatus.style.cssText = 'background:#fef3c7; color:#92400e;';
    
    // Reset immediately
    scanInput.value = '';
    scanInput.disabled = false;
    scanInput.focus();
    isProcessing = false;
    return;
  }

  // 4. Prepare Payload
  const payload = {
    action: 'SCAN',
    secret: SHARED_SECRET,
    operator: operatorInput.value || 'UNNAMED',
    station: stationSel.value,
    raw_scan: raw,
    part_number: cleanedPart,
    serial_number: cleanedSerial,
    comment: $('#generalNote') ? $('#generalNote').value.trim() : ''
  };

  // 5. OPTIMISTIC UPDATE: Assume success
  // Add to History immediately as "PENDING"
  addToHistory({ 
    part: cleanedPart, 
    serial: cleanedSerial, 
    status: 'PENDING', // Will turn Green/Yellow later via drainQueue
    timestamp: new Date() 
  });

  // Update "Last Scan" Display
  lastPart.textContent = cleanedPart;
  lastSerial.textContent = cleanedSerial;
  lastScanStatus.textContent = 'QUEUED';
  lastScanStatus.className = 'history-status';
  lastScanStatus.style.cssText = 'background:#dbeafe; color:#1e40af;'; // Blue for pending
  saveLastScan(cleanedPart, cleanedSerial, 'QUEUED');

  // 6. QUEUE IT & RESET UI
  enqueue(payload);      // Add to background list
  playSoundSuccess();    // Beep immediately!
  
  // Clear and unlock for next scan INSTANTLY
  scanInput.value = '';
  scanInput.disabled = false;
  scanInput.style.opacity = '1';
  scanInput.focus();
  isProcessing = false;

  // 7. Trigger Background Process (Fire and Forget)
  setTimeout(drainQueue, 50); 
});
stationSel.addEventListener('change', () => { 
  savePrefs(); 
  loadLastScan();
  loadBatchComment();    // Load last scan for this operator/station combo
});

// Better offline detection
let isOnline = navigator.onLine;

function updateNetworkStatus(online) {
  isOnline = online;
  const net = document.getElementById('netStatus');
  if (online) {
    net.textContent = 'ONLINE';
    net.style.background = 'var(--success)';
    drainQueue();
  } else {
    net.textContent = 'OFFLINE';
    net.style.background = 'var(--error)';
  }
}

window.addEventListener('online', () => updateNetworkStatus(true));
window.addEventListener('offline', () => updateNetworkStatus(false));

// Ping server every 30 seconds to detect real connectivity
setInterval(async () => {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    await fetch(ENDPOINT + '?ping=1', { 
      method: 'GET', 
      cache: 'no-cache',
      signal: controller.signal 
    });
    if (!isOnline) updateNetworkStatus(true);
  } catch {
    if (isOnline) updateNetworkStatus(false);
  }
}, 30000);

let isLocked = localStorage.getItem('isLocked') === 'true';

function updateLock() {
  console.log('🔐 updateLock() called. isLocked:', isLocked);
  
  const lockBar = document.getElementById('lockStatusBar');
  const lockBtnEl = document.getElementById('lockBtn');
  const unlockBtnEl = document.getElementById('unlockBtn');
  const rowEl = document.getElementById('operatorStationRow');
  
  if (!lockBtnEl || !unlockBtnEl) {
    console.error('❌ updateLock: buttons not found');
    return;
  }
  
  // Disable/enable inputs
  operatorInput.disabled = isLocked;
  stationSel.disabled = isLocked;
  
  if (isLocked) {
    // LOCKED STATE
    if (lockBar) lockBar.style.display = 'block';
    if (rowEl) rowEl.classList.add('hidden');  // Hide operator/station row
    const opEl = document.getElementById('lockedOperatorDisplay');
    const stEl = document.getElementById('lockedStationDisplay');
    if (opEl) opEl.textContent = operatorInput.value || 'UNNAMED';
    if (stEl) stEl.textContent = stationSel.value || 'MAIN';
    
    lockBtnEl.style.display = 'none';
    unlockBtnEl.style.display = 'inline-flex';
    console.log('✅ Locked - row hidden, unlock button visible');
  } else {
    // UNLOCKED STATE
    if (lockBar) lockBar.style.display = 'none';
    if (rowEl) rowEl.classList.remove('hidden');  // Show operator/station row
    lockBtnEl.style.display = 'inline-flex';
    unlockBtnEl.style.display = 'none';
    console.log('✅ Unlocked - row visible, lock button visible');
  }
}

// Lock button - BULLETPROOF VERSION with comprehensive error checking
function attachLockHandlers() {
  const lockBtnElement = document.getElementById('lockBtn');
  const unlockBtnElement = document.getElementById('unlockBtn');
  
  if (!lockBtnElement) {
    console.error('❌ CRITICAL: lockBtn element not found in DOM');
    return;
  }
  if (!unlockBtnElement) {
    console.error('❌ CRITICAL: unlockBtn element not found in DOM');
    return;
  }
  
  // LOCK BUTTON
  lockBtnElement.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('🔒 Lock button clicked');
    
    initAudio();
    
    const opValue = operatorInput.value;
    if (!opValue || opValue.trim() === '') {
      console.warn('⚠️ No operator selected');
      show('❌ Select Operator First!', 'err');
      playSoundError();
      return;
    }
    
    console.log('✅ Locking with:', opValue, 'at', stationSel.value);
    isLocked = true;
    localStorage.setItem('isLocked', 'true');
    updateLock();
    show('🔒 Locked!', 'ok');
    playSoundSuccess();
  });
  
  // UNLOCK BUTTON
  unlockBtnElement.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('🔓 Unlock button clicked');
    
    initAudio();
    
    if (confirm('Unlock to change operator/station?')) {
      console.log('✅ User confirmed unlock');
      isLocked = false;
      localStorage.setItem('isLocked', 'false');
      updateLock();
      show('🔓 Unlocked', 'ok');
      playSoundSuccess();
    } else {
      console.log('⚠️ User cancelled unlock');
    }
  });
  
  console.log('✅ Lock handlers successfully attached');
}

// Attach handlers when DOM is ready
if (document.readyState === 'loading') {
  console.log('📄 DOM loading, waiting for DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOMContentLoaded event fired');
    attachLockHandlers();
  });
} else {
  console.log('📄 DOM already loaded, attaching handlers now');
  attachLockHandlers();
}

// === HISTORY NOTE LOGIC ===

// 1. Handle clicking the "Pencil" in history list
historyPanel.addEventListener('click', (e) => {
  if (e.target.classList.contains('history-edit-btn')) {
    const part = e.target.getAttribute('data-part');
    const serial = e.target.getAttribute('data-serial');
    
    currentEditItem = { part, serial };
    
    // Populate and show modal
    modalContext.textContent = `Attaching note to: ${part} / ${serial}`;
    correctionText.value = ''; // Clear old text
    correctionModal.style.display = 'flex';
    correctionText.focus();
  }
});

// 2. Cancel Button
btnCancelCorrection.onclick = () => {
  correctionModal.style.display = 'none';
  currentEditItem = null;
};

// 3. Save Button (Sends data to Google Sheet Column G)
btnSaveCorrection.onclick = async () => {
  if (!currentEditItem || !correctionText.value.trim()) return;

  const noteContent = correctionText.value.trim();
  
  // UI Feedback
  const originalBtnText = btnSaveCorrection.textContent;
  btnSaveCorrection.textContent = 'Saving...';
  btnSaveCorrection.disabled = true;

  const payload = {
    secret: SHARED_SECRET,
    action: 'CORRECTION', // <--- This triggers the specific block in your Code.gs
    part_number: currentEditItem.part,
    serial_number: currentEditItem.serial,
    note: noteContent
  };

  // Send to Google Sheets
  const status = await send(payload);

  if (status === 'OK') {
    show('Note Attached', 'ok');
    correctionModal.style.display = 'none';
  } else {
    show('Error Saving Note', 'err');
  }

  // Reset UI
  btnSaveCorrection.textContent = originalBtnText;
  btnSaveCorrection.disabled = false;
};

// Double-tap to clear comment
let commentTapCount = 0;
$('#generalNote').addEventListener('click', () => {
  commentTapCount++;
  if (commentTapCount === 2) {
    $('#generalNote').value = '';
    $('#generalNote').focus();
    show('Comment Cleared', 'ok');
    playSoundSuccess();
    commentTapCount = 0;
  }
  setTimeout(() => commentTapCount = 0, 500);
});

// Init
loadPrefs();
loadBatchComment();  
loadLastScan();   // Load last scan for current operator/station
renderQueue(); 
updateLock();

document.body.addEventListener('touchstart', unlockAudioOnFirstTap);

scanInput.focus();
console.log('SeeScan Test v8.0.4 (Offline Fix)');

// === BATTERY STATUS API ===

function updateBatteryInfo(battery) {
  const statusContainer = document.getElementById('battery-status');
  const levelText = document.getElementById('battery-level-text');
  
  // Show the container once we successfully get battery data
  if (statusContainer) {
    statusContainer.style.display = 'block';
  }

  if (levelText) {
    const percentage = Math.round(battery.level * 100);
    
    // REFINED: Only show the "Charging" text and icon when it's plugged in.
    const chargingStatus = battery.charging ? ' ⚡️ CHARGING' : '';
    
    levelText.textContent = `Battery: ${percentage}%${chargingStatus}`;
    
    // Optional: Change background color based on level
    if (percentage < 20 && !battery.charging) {
      statusContainer.style.backgroundColor = '#fecaca'; // Red for low battery
      statusContainer.style.fontWeight = 'bold';
    } else if (battery.charging) {
      statusContainer.style.backgroundColor = '#d1fae5'; // Light green for charging
      statusContainer.style.fontWeight = 'normal';
    } else {
      statusContainer.style.backgroundColor = '#e5e7eb'; // Default gray for discharging
      statusContainer.style.fontWeight = 'normal';
    }
  }
}

async function startBatteryMonitoring() {
  if ('getBattery' in navigator) {
    try {
      const battery = await navigator.getBattery();
      
      // Initial update
      updateBatteryInfo(battery);

      // Listen for changes
      battery.addEventListener('levelchange', () => updateBatteryInfo(battery));
      battery.addEventListener('chargingchange', () => updateBatteryInfo(battery));
      
      console.log('✅ Battery Status API monitoring started.');

    } catch (error) {
      console.warn('Battery Status API failed to access device battery. Check webkiosk app settings.', error);
      const statusContainer = document.getElementById('battery-status');
      if (statusContainer) {
        statusContainer.style.display = 'block';
        document.getElementById('battery-level-text').textContent = 'Battery Status Unavailable';
        statusContainer.style.backgroundColor = '#fee2e2';
      }
    }
  } else {
    console.warn('❌ navigator.getBattery() not supported in this browser/webview.');
  }
}

// Ensure this call remains at the bottom of your app.js
startBatteryMonitoring();

// SERVICE WORKER REGISTRATION - ADD THIS AT THE END OF app.js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(registration => {
        console.log('✅ Service Worker registered successfully:', registration.scope);
      })
      .catch(error => {
        console.error('❌ Service Worker registration failed:', error);
      });
  });
}

// WAKE LOCK - Prevents screen timeout
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('✅ Wake Lock active - screen won\'t timeout');
    }
  } catch (err) {
    console.log('⚠️ Wake Lock not supported, using auto-dim only');
  }
}
requestWakeLock();

document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    requestWakeLock();
  }
});

// SIMPLE BRIGHTNESS DIM - 60% after 1 minute idle
let dimTimer;
let isDimmed = false;

function simpleDim() {
  if (!isDimmed) {
    const overlay = document.getElementById('dimOverlay');
    if (overlay) overlay.style.opacity = '0.6'; // 60% Darker
    isDimmed = true;
    console.log('🔅 Screen dimmed');
  }
}

function simpleBrighten() {
  if (isDimmed) {
    const overlay = document.getElementById('dimOverlay');
    if (overlay) overlay.style.opacity = '0'; // Transparent
    isDimmed = false;
    console.log('☀️ Screen restored');
  }
  resetDimTimer();
}

function resetDimTimer() {
  clearTimeout(dimTimer);
  dimTimer = setTimeout(simpleDim, 60000); // 60 seconds = 1 minute
}

// Detect activity and reset timer
['mousedown', 'touchstart', 'keypress'].forEach(event => {
  document.addEventListener(event, simpleBrighten, true);
});

function resetDimTimer() {
  clearTimeout(dimTimer);
  dimTimer = setTimeout(simpleDim, 60000); // 60000ms = 1 minute
}

// === EVENT LISTENERS ===
// Reset brightness on any interaction
window.addEventListener('click', simpleBrighten);
window.addEventListener('keydown', simpleBrighten);
window.addEventListener('touchstart', simpleBrighten);

// === INITIALIZATION ===
// 1. Start the screen dimmer timer
resetDimTimer();

// 2. Attach the Operator Lock listeners
// (This was defined earlier but never called!)
if (typeof attachLockHandlers === 'function') {
  attachLockHandlers();
  console.log('✅ Lock handlers initialized');
} else {
  console.error('❌ attachLockHandlers function is missing!');
}