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

// Status updates now happen immediately in scan handler - no queue to reconcile

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

// Queue removed - scanning blocked when offline
function renderQueue() {
  // No longer using queue system
  queueInfo.innerHTML = '';
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
    else if (statusClass.includes('off') || statusClass.includes('err') || statusClass.includes('pend') || statusClass.includes('queue')) statusClass = 'queued';
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

// === CONNECTIVITY CHECK - Verify server is reachable before scanning ===
let isServerReachable = true;
let lastConnectivityCheck = 0;

async function checkConnectivity() {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const res = await fetch(ENDPOINT + '?ping=1', { 
      method: 'GET', 
      cache: 'no-cache',
      signal: controller.signal 
    });
    isServerReachable = res.ok;
    lastConnectivityCheck = Date.now();
    return isServerReachable;
  } catch {
    isServerReachable = false;
    lastConnectivityCheck = Date.now();
    return false;
  }
}

// === Send Function - No queue mode ===
async function send(payload) {
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

    // Mark server as reachable
    isServerReachable = true;
    updateNetworkStatus(true);

    return data.status || 'ERROR';

  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error("Fetch failed after " + elapsed + "s:", e.message || e);
    
    // Mark server as unreachable
    isServerReachable = false;
    updateNetworkStatus(false);
    
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
  
  // === BLOCK SCANNING WHEN OFFLINE ===
  if (!isServerReachable) {
    playSoundError();
    show('❌ OFFLINE - Swipe down to refresh', 'err');
    scanInput.value = '';
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
  lastScanStatus.textContent = 'SENDING';
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

  // Send and wait for response
  const status = await send(payload);
  
  // Update final status based on ACTUAL server response
  lastScanStatus.textContent = status;
  lastScanStatus.className = 'history-status';
  
  if (status === 'OK') {
    lastScanStatus.style.cssText = 'background:#d1fae5; color:#065f46;';
    playSoundSuccess();
    show('✅ SAVED', 'ok');
  } else if (status === 'DUPLICATE') {
    lastScanStatus.style.cssText = 'background:#fef3c7; color:#92400e;';
    playSoundDuplicate();
    show('⚠️ DUPLICATE', 'dup');
  } else {
    // OFFLINE or ERROR - scan failed
    lastScanStatus.style.cssText = 'background:#fee2e2; color:#991b1b;';
    lastScanStatus.textContent = 'FAILED';
    playSoundError();
    show('❌ FAILED - Try again when online', 'err');
    // Don't add to history if it failed
    isProcessing = false;
    scanInput.disabled = false;
    scanInput.style.opacity = '1';
    scanInput.focus();
    return;
  }

  // Only add to history if scan was successful (OK or DUPLICATE)
  addToHistory({ part: cleanedPart, serial: cleanedSerial, status, timestamp: new Date() });
  
  // Save last scan to localStorage (per operator/station)
  saveLastScan(cleanedPart, cleanedSerial, status);

  // === UNLOCK SCANNING ===
  isProcessing = false;
  scanInput.disabled = false;
  scanInput.style.opacity = '1';
  scanInput.focus();
});


// Queue system removed - scans only allowed when online

clearBtn.onclick = () => { scanInput.value=''; clearBtn.style.display='none'; scanInput.focus(); };
scanInput.oninput = () => clearBtn.style.display = scanInput.value ? 'flex' : 'none';

// NEW: The 'Clear' button for the Batch Comments box
const clearNoteBtn = document.querySelector('#clearNoteBtn');
// Show visual indicator when batch comment is active
const generalNoteInput = $('#generalNote');

// REMOVED: Orange highlight on scan card when batch comment is entered
// This was confusing operators

if (clearNoteBtn && generalNoteInput) {
  clearNoteBtn.onclick = () => {
    generalNoteInput.value = ''; 
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
}

function updateBatchLockUI(locked) {
  const lockBtn = document.getElementById('lockBatchBtn');
  
  if (locked) {
    lockBtn.innerHTML = '🔓 Unlock Comment';
    lockBtn.style.background = 'var(--warning)';
    generalNoteInput.disabled = true;
    generalNoteInput.style.opacity = '0.7';
  } else {
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
if (clearNoteBtn) {
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
        generalNoteInput.focus();
        show('🔓 Comment Cleared & Unlocked', 'ok');
        playSoundSuccess();
      }
    } else {
      // Just clear normally
      generalNoteInput.value = '';
      generalNoteInput.focus();
    }
  };
}

historyToggle.onclick = () => { 
  historyPanel.classList.toggle('expanded'); 
  if(historyPanel.classList.contains('expanded')) renderHistory();
};

stationSel.addEventListener('change', () => { 
  savePrefs(); 
  loadLastScan();
  loadBatchComment();
});

// Better offline detection
let isOnline = navigator.onLine;

function updateNetworkStatus(online) {
  isOnline = online;
  isServerReachable = online;
  const net = document.getElementById('netStatus');
  const offlineWarning = document.getElementById('offlineWarning');
  const scanField = document.getElementById('scan');
  
  if (online) {
    if (net) {
      net.textContent = 'ONLINE';
      net.style.background = 'var(--success)';
    }
    if (offlineWarning) offlineWarning.classList.remove('show');
    // Re-enable scan input
    if (scanField && !isProcessing) {
      scanField.disabled = false;
      scanField.style.opacity = '1';
      scanField.placeholder = 'Focus here and scan';
    }
  } else {
    if (net) {
      net.textContent = 'OFFLINE';
      net.style.background = 'var(--error)';
    }
    if (offlineWarning) offlineWarning.classList.add('show');
    // Disable scan input when offline
    if (scanField) {
      scanField.disabled = true;
      scanField.style.opacity = '0.5';
      scanField.placeholder = 'OFFLINE - Swipe down to refresh';
    }
  }
}

// Offline warning banner - just informational now (swipe down to refresh)
// No tap handler needed

window.addEventListener('online', () => updateNetworkStatus(true));
window.addEventListener('offline', () => updateNetworkStatus(false));

// Ping server every 30 seconds to detect real connectivity
setInterval(async () => {
  const wasOnline = isOnline;
  const nowOnline = await checkConnectivity();
  if (wasOnline !== nowOnline) {
    updateNetworkStatus(nowOnline);
  }
}, 30000);

// Initial connectivity check on load
setTimeout(checkConnectivity, 2000);

let isLocked = localStorage.getItem('isLocked') === 'true';

function updateLock() {
  console.log('🔐 updateLock() called. isLocked:', isLocked);
  
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
    // LOCKED STATE - just show unlock button, keep dropdowns visible but disabled
    lockBtnEl.style.display = 'none';
    unlockBtnEl.style.display = 'inline-flex';
    console.log('✅ Locked - unlock button visible');
  } else {
    // UNLOCKED STATE
    lockBtnEl.style.display = 'inline-flex';
    unlockBtnEl.style.display = 'none';
    console.log('✅ Unlocked - lock button visible');
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
console.log('SeeScan v8.0.8 (Compact UI)');

// === BATTERY STATUS API ===
function updateBatteryInfo(battery) {
  const batteryEl = document.getElementById('batteryStatus');
  if (!batteryEl) return;

  const percentage = Math.round(battery.level * 100);
  const chargingIcon = battery.charging ? '⚡' : '🔋';
  
  batteryEl.textContent = `${chargingIcon} ${percentage}%`;
  
  // Color based on level
  if (percentage < 20 && !battery.charging) {
    batteryEl.style.background = '#ef4444'; // Red for low
  } else if (battery.charging) {
    batteryEl.style.background = '#10b981'; // Green for charging
  } else {
    batteryEl.style.background = '#6b7280'; // Gray default
  }
}

async function startBatteryMonitoring() {
  const batteryEl = document.getElementById('batteryStatus');
  
  if ('getBattery' in navigator) {
    try {
      const battery = await navigator.getBattery();
      updateBatteryInfo(battery);
      battery.addEventListener('levelchange', () => updateBatteryInfo(battery));
      battery.addEventListener('chargingchange', () => updateBatteryInfo(battery));
      console.log('✅ Battery monitoring started');
    } catch (error) {
      console.warn('Battery API failed:', error);
      if (batteryEl) batteryEl.textContent = '🔋 N/A';
    }
  } else {
    console.warn('Battery API not supported');
    if (batteryEl) batteryEl.textContent = '🔋 N/A';
  }
}

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
    if (overlay) overlay.style.opacity = '0.85'; // 85% Darker
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

// === EVENT LISTENERS ===
// Reset brightness on any interaction
window.addEventListener('click', simpleBrighten);
window.addEventListener('keydown', simpleBrighten);
window.addEventListener('touchstart', simpleBrighten);

// === INITIALIZATION ===
// 1. Start the screen dimmer timer
resetDimTimer();

// 2. Attach the Operator Lock listeners
if (typeof attachLockHandlers === 'function') {
  attachLockHandlers();
  console.log('✅ Lock handlers initialized');
} else {
  console.error('❌ attachLockHandlers function is missing!');
}