// ===== SeeScan v8.2.0 - Production Release =====
// v8.2.0: Added timestamps with relative time, DD/MM/YY format, wake-from-sleep connectivity fix
// v8.1.1: Fixed history not clearing on new day, fixed initial offline detection
// FIXES: XSS vulnerability, lock acquisition handling, 10s timeout, history cap

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbw8rpcRdBiAy7UfhzMrDCu_3n3vzA0fOtcs6vmw_H9oA1HRWzxH5GADT4l9crohw1QS5A/exec'; 

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

// ===== DATE/TIME FORMATTING HELPERS =====
function formatDateMMDDYY(date) {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function formatTimestamp(date) {
  const d = new Date(date);
  const dateStr = formatDateMMDDYY(d);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${dateStr} ${timeStr}`;
}

function getRelativeTime(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec} secs ago`;
  if (diffMin === 1) return '1 min ago';
  if (diffMin < 60) return `${diffMin} mins ago`;
  if (diffHr === 1) return '1 hour ago';
  if (diffHr < 24) return `${diffHr} hours ago`;
  return formatDateMMDDYY(then);
}

// ===== HELPERS =====
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
const lastScanTime = $('#lastScanTime');
const lastScanRelative = $('#lastScanRelative');
const lockBtn = $('#lockBtn'), unlockBtn = $('#unlockBtn')
const correctionModal = $('#correctionModal');
const modalContext = $('#modalContext');
const correctionText = $('#correctionText');
const btnCancelCorrection = $('#cancelCorrection');
const btnSaveCorrection = $('#saveCorrection');
let currentEditItem = null;

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
  document.body.style.transition = 'background-color 0.3s';
  document.body.style.backgroundColor = '#10b981';
  setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
}

function playSoundDuplicate() { 
  playBeep(440, 'sine'); 
  document.body.style.transition = 'background-color 0.3s';
  document.body.style.backgroundColor = '#f59e0b';
  setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
}

function playSoundError() { 
  playBeep(220, 'sawtooth'); 
  document.body.style.transition = 'background-color 0.3s';
  document.body.style.backgroundColor = '#ef4444';
  setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
}

function show(msg, cls) {
  statusBox.innerHTML = msg; statusBox.className = 'status show ' + cls;
  setTimeout(() => statusBox.classList.remove('show'), 2500);
}

function savePrefs() { localStorage.setItem('operator', operatorInput.value.trim()); localStorage.setItem('station', stationSel.value); }
function loadPrefs() { operatorInput.value = localStorage.getItem('operator') || ''; stationSel.value = localStorage.getItem('station') || 'MAIN'; }

function parsePN_SN(s) {
  const raw = String(s).toUpperCase().trim();

  // GS1-128 FORMAT (Starts with 01)
  if (raw.startsWith('01')) {
      const prefix = raw.substring(0, 16);
      let part = PART_NUMBER_MAP[prefix];
      let remainder = raw.substring(16);
      let serial = '';

      if (remainder.startsWith('11') || remainder.startsWith('17') || remainder.startsWith('13')) {
        remainder = remainder.substring(8);
      }

      if (remainder.startsWith('21')) {
        serial = remainder.substring(2);
      } else {
        serial = remainder;
      }

      if (serial) {
          const pfrMatch = serial.match(/^(PFR[A-Z0-9]{3,10})/i); 
          if (pfrMatch) {
              const identifiedPartId = pfrMatch[1].toUpperCase();
              part = identifiedPartId; 
              serial = serial.substring(identifiedPartId.length); 
              if (!serial) {
                  serial = identifiedPartId; 
              } else {
                  serial = serial.replace(/^[^A-Z0-9]+/, ''); 
              }
              return { part, serial }; 
          }
      }
      
      return part ? { part, serial } : { part: 'UNKNOWN', serial };
  }
  
  // HIBC FORMAT (Contains /$+)
  if (raw.includes('/$+')) {
    const parts = raw.split('/$+');
    if (parts.length < 2) return { part:'', serial:'' };
    let p = parts[0], sNum = parts[1];
    
    if (p.startsWith('+B')) {
      p = p.substring(1); 
      if (p.startsWith('B')) p = p.substring(1); 
      if (sNum.startsWith('+')) sNum = sNum.substring(1);
    } else {
      if (sNum.startsWith('+')) sNum = sNum.substring(1);
    }

    if (sNum.endsWith('/')) {
      sNum = sNum.substring(0, sNum.length - 1);
    } else if (sNum.match(/\d$/)) {
      if (p !== 'P5556100') {
        sNum = sNum.substring(0, sNum.length - 1);
      }
    }

    if (sNum.endsWith('/')) {
      sNum = sNum.substring(0, sNum.length - 1);
    } else if (sNum.match(/\d$/)) {
      if (p !== 'P5556100') {
        sNum = sNum.substring(0, sNum.length - 1);
      }
    }

    if (p.startsWith('446') && p.length > 4 && (p.includes('PUL') || p.endsWith('1') || p.endsWith('0'))) {
        p = p.substring(3, p.length - 1);
    }

    return { part: p, serial: sNum };
  }

  return { part: '', serial: '' };
}

function cleanSerialClient(rawSerial) {
  if (!rawSerial) return "";
  let cleaned = rawSerial.toString();
  cleaned = cleaned.replace(/[^0-9]+$/, '');
  return cleaned.trim();
}

function checkLocalDuplicate(serial) {
  const h = getHistory();
  return h.some(item => item.serial === serial && item.status !== 'ERR' && item.status !== 'ERROR');
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
  updateLastScanDisplay(scanData);
}

function updateLastScanDisplay(data) {
  if (!data) {
    lastPart.textContent = '—';
    lastSerial.textContent = '—';
    lastScanStatus.textContent = '';
    if (lastScanTime) lastScanTime.textContent = '';
    if (lastScanRelative) lastScanRelative.textContent = '';
    return;
  }
  
  lastPart.textContent = data.part || '—';
  lastSerial.textContent = data.serial || '—';
  lastScanStatus.textContent = data.status || '';
  
  // Apply status styling
  if (data.status === 'OK') {
    lastScanStatus.style.cssText = 'background:#d1fae5; color:#065f46;';
  } else if (data.status === 'DUPLICATE') {
    lastScanStatus.style.cssText = 'background:#fef3c7; color:#92400e;';
  } else {
    lastScanStatus.style.cssText = 'background:#fee2e2; color:#991b1b;';
  }
  
  // Update timestamp displays
  if (data.timestamp) {
    if (lastScanTime) lastScanTime.textContent = formatTimestamp(data.timestamp);
    if (lastScanRelative) lastScanRelative.textContent = getRelativeTime(data.timestamp);
  }
}

function loadLastScan() {
  const key = getLastScanKey();
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const data = JSON.parse(stored);
      updateLastScanDisplay(data);
      return;
    } catch (e) {}
  }
  updateLastScanDisplay(null);
}

// Update relative time every 30 seconds
setInterval(() => {
  const key = getLastScanKey();
  const stored = localStorage.getItem(key);
  if (stored && lastScanRelative) {
    try {
      const data = JSON.parse(stored);
      if (data.timestamp) {
        lastScanRelative.textContent = getRelativeTime(data.timestamp);
      }
    } catch (e) {}
  }
}, 30000);

function renderQueue() {
  queueInfo.innerHTML = '';
}

function getHistoryKey() { return `history_${operatorInput.value.trim() || 'UNNAMED'}`; }

function getHistory() { 
  try { 
    let h = JSON.parse(localStorage.getItem(getHistoryKey()) || '[]');
    // Clear history if first item is from a different day
    if (h.length > 0 && new Date(h[0].timestamp).toDateString() !== new Date().toDateString()) {
      h = [];
      localStorage.setItem(getHistoryKey(), '[]');
    }
    return h;
  } catch { 
    return []; 
  } 
}

function addToHistory(item) {
  const key = getHistoryKey();
  let h = getHistory(); // getHistory() already clears old data
  h.unshift(item);
  // Cap at 100 items to prevent localStorage overflow
  if (h.length > 100) h = h.slice(0, 100);
  localStorage.setItem(key, JSON.stringify(h));
  renderHistory();
}

// XSS-safe history rendering with full DD/MM/YY timestamps
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

    // XSS-safe: use textContent for user data
    const partCol = document.createElement('div');
    partCol.className = 'scan-data-col';
    partCol.innerHTML = '<div class="data-label">Ref</div><div class="history-part-num"></div>';
    partCol.querySelector('.history-part-num').textContent = item.part;
    
    const serialCol = document.createElement('div');
    serialCol.className = 'scan-data-col';
    serialCol.innerHTML = '<div class="data-label">Serial</div><div class="history-serial-num"></div>';
    serialCol.querySelector('.history-serial-num').textContent = item.serial;
    
    const statusCol = document.createElement('div');
    statusCol.className = 'scan-data-col';
    statusCol.innerHTML = '<div class="data-label">Status</div><div class="history-status"></div><div class="history-time"></div>';
    const statusEl = statusCol.querySelector('.history-status');
    statusEl.textContent = item.status;
    statusEl.style.cssText = badgeStyle;
    // Full DD/MM/YY timestamp
    statusCol.querySelector('.history-time').textContent = formatTimestamp(item.timestamp);
    
    const editBtn = document.createElement('button');
    editBtn.className = 'history-edit-btn';
    editBtn.textContent = '✎';
    editBtn.dataset.part = item.part;
    editBtn.dataset.serial = item.serial;
    
    div.appendChild(partCol);
    div.appendChild(serialCol);
    div.appendChild(statusCol);
    div.appendChild(editBtn);
    
    historyPanel.appendChild(div);
  });
}

// === CONNECTIVITY CHECK ===
// Start as false until first connectivity check confirms online
let isServerReachable = false;
let lastConnectivityCheck = 0;
let connectivityCheckInProgress = false;

async function checkConnectivity() {
  // Prevent multiple simultaneous checks
  if (connectivityCheckInProgress) return isServerReachable;
  connectivityCheckInProgress = true;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(ENDPOINT + '?ping=1', { 
      method: 'GET', 
      cache: 'no-cache',
      signal: controller.signal 
    });
    
    clearTimeout(timeoutId);
    isServerReachable = res.ok;
    lastConnectivityCheck = Date.now();
    return isServerReachable;
  } catch {
    isServerReachable = false;
    lastConnectivityCheck = Date.now();
    return false;
  } finally {
    connectivityCheckInProgress = false;
  }
}

// === Send Function ===
async function send(payload) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify(payload),
      cache: 'no-cache',
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!res.ok) return 'ERROR';

    let data = {};
    const text = await res.text();
    try { 
      data = JSON.parse(text); 
    } catch(e) { 
      return 'ERROR'; 
    }

    // Handle server busy response (lock acquisition failed)
    if (data.status === 'BUSY' || data.status === 'ERROR' && data.message && data.message.includes('busy')) {
      return 'BUSY';
    }

    isServerReachable = true;
    updateNetworkStatus(true);

    return data.status || 'ERROR';

  } catch (e) {
    isServerReachable = false;
    updateNetworkStatus(false);
    return 'OFFLINE';
  }
}

// Scan lock to prevent double-scanning (CRITICAL for concurrent operator protection)
let isProcessing = false;

scanInput.addEventListener('keydown', async (ev) => {
  if (ev.key !== 'Enter') return;
  
  // CRITICAL: Prevent double scans from rapid Enter key presses
  if (isProcessing) {
    playSoundError();
    return;
  }
  
  // Block scanning when offline
  if (!isServerReachable) {
    playSoundError();
    show('❌ OFFLINE - Swipe down to refresh', 'err');
    scanInput.value = '';
    return;
  }
  
  let raw = scanInput.value.trim(); 
  if (!raw) return;

  // Clean control characters that can corrupt JSON
  raw = raw.replace(/[\x00-\x1F\x7F]/g, ''); 

  if (raw.startsWith("'")) {
    raw = raw.substring(1);
  }
  
  const parsed = parsePN_SN(raw);
  const cleanedSerial = cleanSerialClient(parsed.serial);
  const cleanedPart = parsed.part;

  if (!cleanedSerial) { show('INVALID FORMAT', 'err'); playSoundError(); scanInput.value=''; return; }

  // Clear input immediately
  scanInput.value = '';
  clearBtn.style.display = 'none';
  
  // LOCK: Prevent any other scans while this one processes
  isProcessing = true;
  scanInput.disabled = true;
  scanInput.style.opacity = '0.5';
  show('⏳ Sending...', 'queued');
  
  // Optimistic UI update
  lastPart.textContent = cleanedPart || 'N/A';
  lastSerial.textContent = cleanedSerial;
  lastScanStatus.textContent = 'SENDING';
  lastScanStatus.style.cssText = 'background:#dbeafe; color:#1e40af;';
  if (lastScanTime) lastScanTime.textContent = 'Sending...';
  if (lastScanRelative) lastScanRelative.textContent = '';
  
  const payload = {
    secret: SHARED_SECRET,
    operator: operatorInput.value || 'UNNAMED',
    station: stationSel.value,
    raw_scan: raw,
    part_number: cleanedPart,
    serial_number: cleanedSerial,
    comment: $('#generalNote').value.trim()
  };

  const status = await send(payload);
  
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
  } else if (status === 'BUSY') {
    // Server lock acquisition failed - another operator is writing
    lastScanStatus.style.cssText = 'background:#fef3c7; color:#92400e;';
    lastScanStatus.textContent = 'BUSY';
    playSoundError();
    show('⏳ Server busy - try again', 'dup');
    // UNLOCK immediately so they can retry
    isProcessing = false;
    scanInput.disabled = false;
    scanInput.style.opacity = '1';
    scanInput.focus();
    return;
  } else {
    lastScanStatus.style.cssText = 'background:#fee2e2; color:#991b1b;';
    lastScanStatus.textContent = 'FAILED';
    playSoundError();
    show('❌ FAILED - Try again when online', 'err');
    // UNLOCK immediately so they can retry
    isProcessing = false;
    scanInput.disabled = false;
    scanInput.style.opacity = '1';
    scanInput.focus();
    return;
  }

  // Only save to history if scan was accepted by server
  const now = new Date();
  addToHistory({ part: cleanedPart, serial: cleanedSerial, status, timestamp: now });
  saveLastScan(cleanedPart, cleanedSerial, status);

  // UNLOCK: Allow next scan
  isProcessing = false;
  scanInput.disabled = false;
  scanInput.style.opacity = '1';
  scanInput.focus();
});

clearBtn.onclick = () => { scanInput.value=''; clearBtn.style.display='none'; scanInput.focus(); };
scanInput.oninput = () => clearBtn.style.display = scanInput.value ? 'flex' : 'none';

const clearNoteBtn = document.querySelector('#clearNoteBtn');
const generalNoteInput = $('#generalNote');

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

document.getElementById('lockBatchBtn').addEventListener('click', () => {
  const lockKey = getBatchLockKey();
  const commentKey = getBatchCommentKey();
  const isCurrentlyLocked = localStorage.getItem(lockKey) === 'true';
  
  if (!isCurrentlyLocked) {
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
  } else {
    if (confirm('Unlock batch comment?')) {
      localStorage.setItem(lockKey, 'false');
      updateBatchLockUI(false);
      show('🔓 Batch Comment Unlocked', 'ok');
      playSoundSuccess();
    }
  }
});

if (clearNoteBtn) {
  clearNoteBtn.onclick = () => {
    const lockKey = getBatchLockKey();
    const isLocked = localStorage.getItem(lockKey) === 'true';
    
    if (isLocked) {
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
    if (scanField) {
      scanField.disabled = true;
      scanField.style.opacity = '0.5';
      scanField.placeholder = 'OFFLINE - Swipe down to refresh';
    }
  }
}

window.addEventListener('online', () => {
  // Browser says online, but verify with server ping
  checkConnectivity().then(online => updateNetworkStatus(online));
});
window.addEventListener('offline', () => updateNetworkStatus(false));

// Regular connectivity check every 30 seconds
setInterval(async () => {
  const nowOnline = await checkConnectivity();
  updateNetworkStatus(nowOnline);
}, 30000);

// CRITICAL: Check connectivity when tablet wakes from sleep
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    // Tablet just woke up - immediately check connectivity
    const net = document.getElementById('netStatus');
    if (net) {
      net.textContent = 'CHECKING...';
      net.style.background = '#6b7280';
    }
    
    const online = await checkConnectivity();
    updateNetworkStatus(online);
    
    // Also refresh wake lock
    if (wakeLock !== null) {
      requestWakeLock();
    }
  }
});

// Check connectivity immediately on load
checkConnectivity().then(online => updateNetworkStatus(online));

let isLocked = localStorage.getItem('isLocked') === 'true';

function updateLock() {
  const lockBtnEl = document.getElementById('lockBtn');
  const unlockBtnEl = document.getElementById('unlockBtn');
  
  if (!lockBtnEl || !unlockBtnEl) return;
  
  operatorInput.disabled = isLocked;
  stationSel.disabled = isLocked;
  
  if (isLocked) {
    lockBtnEl.style.display = 'none';
    unlockBtnEl.style.display = 'inline-flex';
  } else {
    lockBtnEl.style.display = 'inline-flex';
    unlockBtnEl.style.display = 'none';
  }
}

function attachLockHandlers() {
  const lockBtnElement = document.getElementById('lockBtn');
  const unlockBtnElement = document.getElementById('unlockBtn');
  
  if (!lockBtnElement || !unlockBtnElement) return;
  
  lockBtnElement.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    initAudio();
    
    const opValue = operatorInput.value;
    if (!opValue || opValue.trim() === '') {
      show('❌ Select Operator First!', 'err');
      playSoundError();
      return;
    }
    
    isLocked = true;
    localStorage.setItem('isLocked', 'true');
    updateLock();
    show('🔒 Locked!', 'ok');
    playSoundSuccess();
  });
  
  unlockBtnElement.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    initAudio();
    
    if (confirm('Unlock to change operator/station?')) {
      isLocked = false;
      localStorage.setItem('isLocked', 'false');
      updateLock();
      show('🔓 Unlocked', 'ok');
      playSoundSuccess();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachLockHandlers);
} else {
  attachLockHandlers();
}

// === HISTORY NOTE LOGIC ===
historyPanel.addEventListener('click', (e) => {
  if (e.target.classList.contains('history-edit-btn')) {
    const part = e.target.getAttribute('data-part');
    const serial = e.target.getAttribute('data-serial');
    
    currentEditItem = { part, serial };
    modalContext.textContent = `Attaching note to: ${part} / ${serial}`;
    correctionText.value = '';
    correctionModal.style.display = 'flex';
    correctionText.focus();
  }
});

btnCancelCorrection.onclick = () => {
  correctionModal.style.display = 'none';
  currentEditItem = null;
};

btnSaveCorrection.onclick = async () => {
  if (!currentEditItem || !correctionText.value.trim()) return;

  const noteContent = correctionText.value.trim();
  const originalBtnText = btnSaveCorrection.textContent;
  btnSaveCorrection.textContent = 'Saving...';
  btnSaveCorrection.disabled = true;

  const payload = {
    secret: SHARED_SECRET,
    action: 'CORRECTION',
    part_number: currentEditItem.part,
    serial_number: currentEditItem.serial,
    note: noteContent
  };

  const status = await send(payload);

  if (status === 'OK') {
    show('Note Attached', 'ok');
    correctionModal.style.display = 'none';
  } else {
    show('Error Saving Note', 'err');
  }

  btnSaveCorrection.textContent = originalBtnText;
  btnSaveCorrection.disabled = false;
};

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
loadLastScan();
renderQueue(); 
updateLock();

document.body.addEventListener('touchstart', unlockAudioOnFirstTap);
scanInput.focus();

// === BATTERY STATUS API ===
function updateBatteryInfo(battery) {
  const batteryEl = document.getElementById('batteryStatus');
  if (!batteryEl) return;

  const percentage = Math.round(battery.level * 100);
  const chargingIcon = battery.charging ? '⚡' : '🔋';
  
  batteryEl.textContent = `${chargingIcon} ${percentage}%`;
  
  if (percentage < 20 && !battery.charging) {
    batteryEl.style.background = '#ef4444';
  } else if (battery.charging) {
    batteryEl.style.background = '#10b981';
  } else {
    batteryEl.style.background = '#6b7280';
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
    } catch (error) {
      if (batteryEl) batteryEl.textContent = '🔋 N/A';
    }
  } else {
    if (batteryEl) batteryEl.textContent = '🔋 N/A';
  }
}

startBatteryMonitoring();

// SERVICE WORKER REGISTRATION
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

// WAKE LOCK
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {}
}
requestWakeLock();

// SCREEN DIMMER
let dimTimer;
let isDimmed = false;

function simpleDim() {
  if (!isDimmed) {
    const overlay = document.getElementById('dimOverlay');
    if (overlay) overlay.style.opacity = '0.85';
    isDimmed = true;
  }
}

function simpleBrighten() {
  if (isDimmed) {
    const overlay = document.getElementById('dimOverlay');
    if (overlay) overlay.style.opacity = '0';
    isDimmed = false;
  }
  resetDimTimer();
}

function resetDimTimer() {
  clearTimeout(dimTimer);
  dimTimer = setTimeout(simpleDim, 60000);
}

['mousedown', 'touchstart', 'keypress'].forEach(event => {
  document.addEventListener(event, simpleBrighten, true);
});

window.addEventListener('click', simpleBrighten);
window.addEventListener('keydown', simpleBrighten);
window.addEventListener('touchstart', simpleBrighten);

// === INITIALIZATION ===
resetDimTimer();
