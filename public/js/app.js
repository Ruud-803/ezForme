/**
 * ezForme - Frontend Core Logic
 * Handles Mobile Upload, Kiosk Numpad, Real-time WebSocket sync, and Virtual Printer Audio/Animation
 */

// Web Audio API Printer Sound Synthesizer
class PrinterSoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Mechanical feed motor hum and chatter
  playPrintingSound(durationSec = 3.5) {
    if (!this.enabled) return;
    this.init();
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1. Motor Hum (Oscillator)
    const motorOsc = ctx.createOscillator();
    const motorGain = ctx.createGain();
    motorOsc.type = 'sawtooth';
    motorOsc.frequency.setValueAtTime(110, now);
    motorOsc.frequency.exponentialRampToValueAtTime(140, now + durationSec * 0.7);
    motorGain.gain.setValueAtTime(0.08, now);
    motorGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
    motorOsc.connect(motorGain);
    motorGain.connect(ctx.destination);
    motorOsc.start(now);
    motorOsc.stop(now + durationSec);

    // 2. Stepper Clicks (Periodic noise bursts)
    for (let i = 0; i < 12; i++) {
      const clickTime = now + (i * 0.28);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800 + (i % 2) * 200, clickTime);
      gain.gain.setValueAtTime(0.05, clickTime);
      gain.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(clickTime);
      osc.stop(clickTime + 0.09);
    }
  }

  // Success Chime
  playSuccessChime() {
    if (!this.enabled) return;
    this.init();
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);
      gain.gain.setValueAtTime(0.12, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.55);
    });
  }
}

const soundFX = new PrinterSoundFX();

// State
let selectedFile = null;
let printOptions = {
  colorMode: 'bw', // 'bw' or 'color'
  copies: 1,
  duplex: 'single',
  estimatedPages: 2,
  tenantCode: 'ALPHA' // Default to Tenant Alpha
};
let b2bState = {
  branch: null,
  tenants: []
};
let currentKioskPin = '';
let ws = null;

// Initialize WebSocket
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('✅ [ezForme] WebSocket connected');
    const dot = document.getElementById('connStatusDot');
    if (dot) dot.style.background = '#10b981';
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error('WS Parse Error', e);
    }
  };

  ws.onclose = () => {
    console.log('⚠️ [ezForme] WebSocket disconnected, retrying in 3s...');
    setTimeout(initWebSocket, 3000);
  };
}

function handleWsMessage(msg) {
  const { type, payload } = msg;

  if (type === 'INIT_STATE') {
    if (payload.jobs) renderHistory(payload.jobs);
    if (payload.branch) {
      b2bState.branch = payload.branch;
      const titleEl = document.getElementById('b2bBranchTitle');
      if (titleEl) titleEl.textContent = payload.branch.branchName;
    }
    if (payload.tenants) {
      b2bState.tenants = payload.tenants;
      renderB2BTenants(payload.tenants);
    }
  } else if (type === 'INIT_JOBS') {
    renderHistory(payload);
  } else if (type === 'JOB_CREATED') {
    addHistoryItem(payload);
    showKioskToast(`📥 신규 인쇄 요청: PIN [${payload.pin}] (${payload.pages}페이지)`);
  } else if (type === 'JOB_PAID') {
    updateHistoryItem(payload);
  } else if (type === 'PRINT_STARTED') {
    updateHistoryItem(payload);
    triggerKioskPrintAnimation(payload);
  } else if (type === 'PRINT_COMPLETED') {
    updateHistoryItem(payload);
    finishKioskPrintAnimation(payload);
  } else if (type === 'B2B_USAGE_UPDATED') {
    if (payload.allTenants) {
      b2bState.tenants = payload.allTenants;
      renderB2BTenants(payload.allTenants);
      recalculatePrice();
    }
  } else if (type === 'B2B_TENANTS_CHANGED') {
    b2bState.tenants = payload;
    renderB2BTenants(payload);
  }
}

function renderB2BTenants(tenantsList) {
  const tbody = document.getElementById('b2bTenantsTableBody');
  const summaryEl = document.getElementById('b2bTotalOverageSummary');
  if (!tbody) return;

  tbody.innerHTML = '';
  let totalOverage = 0;

  tenantsList.forEach(t => {
    totalOverage += (t.overage ? t.overage.amount : 0);
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

    const bwUsed = t.currentUsage.bw;
    const bwQuota = t.monthlyQuota.bw;
    const colorUsed = t.currentUsage.color;
    const colorQuota = t.monthlyQuota.color;
    const overageAmount = t.overage ? t.overage.amount : 0;
    const overageBw = t.overage ? t.overage.bw : 0;
    const overageColor = t.overage ? t.overage.color : 0;

    const isOver = overageAmount > 0;

    tr.innerHTML = `
      <td style="padding: 10px; font-weight: 600; color: #f8fafc;">
        ${t.name}
        <div style="font-size: 10px; color: var(--text-muted);">${t.contact || ''}</div>
      </td>
      <td style="padding: 10px;"><code style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; color: #38bdf8;">${t.code}</code></td>
      <td style="padding: 10px;">
        <span style="color: ${bwUsed > bwQuota ? '#f87171' : '#34d399'}; font-weight: 600;">${bwUsed}</span> / ${bwQuota}매
      </td>
      <td style="padding: 10px;">
        <span style="color: ${colorUsed > colorQuota ? '#f87171' : '#38bdf8'}; font-weight: 600;">${colorUsed}</span> / ${colorQuota}매
      </td>
      <td style="padding: 10px;">
        ${isOver ? `<span style="color: #f87171; font-weight: 600;">흑백 +${overageBw}매, 컬러 +${overageColor}매</span>` : `<span style="color: #64748b;">한도 내</span>`}
      </td>
      <td style="padding: 10px; text-align: right; font-weight: 700; color: ${isOver ? '#f87171' : '#64748b'};">
        ${isOver ? `+${overageAmount.toLocaleString()}원` : '0원'}
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (summaryEl) {
    summaryEl.textContent = `초과 과금 총액: ${totalOverage.toLocaleString()}원 (익월 임대료 합산)`;
  }
}

// -------------------------------------------------------------
// Mobile View Logic
// -------------------------------------------------------------
function setupMobileHandlers() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const btnSample = document.getElementById('btnSampleFile');
  const btnSubmit = document.getElementById('btnSubmitPrint');

  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  // Sample file one-click generator
  if (btnSample) {
    btnSample.addEventListener('click', (e) => {
      e.stopPropagation();
      const sampleBlob = new Blob([
        `[ezForme 샘플 문서]\n\n문서명: 2026 스터디카페_발표자료_최종.pdf\n작성일: ${new Date().toLocaleDateString()}\n내용: 드라이버 설치 없이 3초 만에 무선 클라우드 인쇄 성공!`
      ], { type: 'application/pdf' });
      const sampleFile = new File([sampleBlob], '스터디카페_발표자료_최종.pdf', { type: 'application/pdf' });
      handleFileSelected(sampleFile);
    });
  }

  // Color / BW toggle
  document.querySelectorAll('.color-seg-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.color-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      printOptions.colorMode = btn.dataset.val;
      recalculatePrice();
    });
  });

  // Duplex toggle
  document.querySelectorAll('.duplex-seg-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.duplex-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      printOptions.duplex = btn.dataset.val;
    });
  });

  // Copies Stepper
  const btnMinus = document.getElementById('btnCopiesMinus');
  const btnPlus = document.getElementById('btnCopiesPlus');
  const copiesVal = document.getElementById('copiesVal');

  if (btnMinus && btnPlus) {
    btnMinus.addEventListener('click', () => {
      if (printOptions.copies > 1) {
        printOptions.copies--;
        copiesVal.textContent = printOptions.copies;
        recalculatePrice();
      }
    });
    btnPlus.addEventListener('click', () => {
      if (printOptions.copies < 20) {
        printOptions.copies++;
        copiesVal.textContent = printOptions.copies;
        recalculatePrice();
      }
    });
  }

  // B2B Tenant Select Handler
  const tenantSelect = document.getElementById('tenantSelect');
  if (tenantSelect) {
    printOptions.tenantCode = tenantSelect.value;
    tenantSelect.addEventListener('change', (e) => {
      printOptions.tenantCode = e.target.value;
      recalculatePrice();
    });
  }

  // Monthly Reset Button Handler
  const btnResetMonthly = document.getElementById('btnResetMonthly');
  if (btnResetMonthly) {
    btnResetMonthly.addEventListener('click', async () => {
      if (!confirm('새로운 정산 월을 시작하여 모든 입주사의 인쇄 사용량을 0으로 초기화하시겠습니까?')) return;
      try {
        const res = await fetch('/api/b2b/reset-monthly', { method: 'POST' });
        const data = await res.json();
        alert('✅ ' + data.message);
      } catch (err) {
        alert('초기화 실패: ' + err.message);
      }
    });
  }

  // Submit / Pay Button
  if (btnSubmit) {
    btnSubmit.addEventListener('click', submitPrintJob);
  }
}

function handleFileSelected(file) {
  selectedFile = file;
  const badge = document.getElementById('selectedFileBadge');
  const nameEl = document.getElementById('selectedFileName');
  const sizeEl = document.getElementById('selectedFileSize');
  const btnSubmit = document.getElementById('btnSubmitPrint');

  if (badge && nameEl && sizeEl) {
    nameEl.textContent = file.name;
    sizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB (약 2~3페이지)`;
    badge.style.display = 'flex';
  }

  if (btnSubmit) {
    btnSubmit.disabled = false;
  }

  recalculatePrice();
}

function recalculatePrice() {
  const unitPrice = printOptions.colorMode === 'color' ? 300 : 100;
  const totalPages = printOptions.estimatedPages * printOptions.copies;
  const normalPrice = totalPages * unitPrice;

  const priceEl = document.getElementById('displayTotalPrice');
  const noteEl = document.getElementById('priceSubNote');
  const badgeEl = document.getElementById('tenantStatusBadge');
  const btnSubmit = document.getElementById('btnSubmitPrint');

  const tenantCode = printOptions.tenantCode;
  const tenant = b2bState.tenants.find(t => t.code === tenantCode);

  if (tenant) {
    const quotaKey = printOptions.colorMode === 'color' ? 'color' : 'bw';
    const remaining = Math.max(0, tenant.monthlyQuota[quotaKey] - tenant.currentUsage[quotaKey]);

    if (badgeEl) {
      badgeEl.textContent = remaining > 0 ? 'B2B 무료 크레딧' : 'B2B 초과분 관리비 합산';
      badgeEl.style.color = remaining > 0 ? '#34d399' : '#f87171';
      badgeEl.style.background = remaining > 0 ? 'rgba(52, 211, 153, 0.15)' : 'rgba(248, 113, 113, 0.15)';
    }

    if (remaining >= totalPages) {
      if (priceEl) priceEl.textContent = '0원';
      if (noteEl) {
        noteEl.textContent = `(입주사 무료 쿼터 적용 / 잔여: ${remaining - totalPages}매)`;
        noteEl.style.color = '#34d399';
      }
      if (btnSubmit && selectedFile) {
        btnSubmit.innerHTML = '<span>⚡ 원클릭 인쇄 요청 (무료 0원)</span>';
      }
    } else {
      const overagePages = totalPages - remaining;
      const overageAmount = overagePages * unitPrice;
      if (priceEl) priceEl.textContent = '0원 (현장결제 없음)';
      if (noteEl) {
        noteEl.textContent = `(초과 ${overagePages}매 ${overageAmount.toLocaleString()}원은 익월 관리비 합산)`;
        noteEl.style.color = '#f87171';
      }
      if (btnSubmit && selectedFile) {
        btnSubmit.innerHTML = '<span>⚡ 원클릭 인쇄 요청 (관리비 합산)</span>';
      }
    }
  } else {
    // Guest (B2C)
    if (badgeEl) {
      badgeEl.textContent = '게스트 (카드결제)';
      badgeEl.style.color = '#38bdf8';
      badgeEl.style.background = 'rgba(56, 189, 248, 0.15)';
    }
    if (priceEl) priceEl.textContent = `${normalPrice.toLocaleString()}원`;
    if (noteEl) {
      noteEl.textContent = '(토스페이먼츠 신용카드 / 간편결제)';
      noteEl.style.color = '#94a3b8';
    }
    if (btnSubmit && selectedFile) {
      btnSubmit.innerHTML = '<span>⚡ 카드·간편결제 & 인쇄 요청</span>';
    }
  }
}

async function submitPrintJob() {
  if (!selectedFile) return;

  const btnSubmit = document.getElementById('btnSubmitPrint');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<span>⏳ 인쇄 작업 업로드 중...</span>';

  soundFX.init();

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('colorMode', printOptions.colorMode);
  formData.append('copies', printOptions.copies);
  formData.append('duplex', printOptions.duplex);
  formData.append('tenantCode', printOptions.tenantCode || '');

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.error || '업로드 실패');
      btnSubmit.disabled = false;
      return;
    }

    const job = data.job;

    // Check if B2B auto-approved (status === 'PAID')
    if (job.status === 'PAID') {
      showMobilePinResult(job);
    } else {
      // Simulate Toss Payments instant card payment
      btnSubmit.innerHTML = '<span>💳 토스페이먼츠 카드결제 승인 중...</span>';
      const payRes = await fetch(`/api/jobs/${job.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'tosspayments_card' })
      });
      const payData = await payRes.json();
      showMobilePinResult(job);
    }

  } catch (err) {
    console.error(err);
    alert('네트워크 오류가 발생했습니다.');
  } finally {
    btnSubmit.disabled = false;
    recalculatePrice();
  }
}

function showMobilePinResult(job) {
  const card = document.getElementById('pinResultCard');
  const codeEl = document.getElementById('issuedPinCode');
  const btnDirect = document.getElementById('btnDirectPrintNow');
  const statusBox = document.getElementById('directPrintStatus');
  const statusTitle = document.getElementById('directPrintStatusTitle');
  const statusSub = document.getElementById('directPrintStatusSub');
  const btnNewJob = document.getElementById('btnNewPrintJob');

  if (card) {
    if (codeEl) codeEl.textContent = job.pin;
    card.style.display = 'block';

    // Auto-fill kiosk PIN if in split-view
    const kioskPinBox = document.getElementById('pinDisplayBox');
    if (kioskPinBox) {
      currentKioskPin = job.pin;
      kioskPinBox.textContent = job.pin;
      kioskPinBox.classList.add('focused');
    }

    if (btnDirect) {
      btnDirect.className = 'btn-direct-print-pulse';
      btnDirect.disabled = false;
      btnDirect.innerHTML = '<span>🖨️ 프린터 앞 도착! 지금 바로 인쇄</span>';

      btnDirect.onclick = async () => {
        btnDirect.disabled = true;
        btnDirect.className = 'btn-direct-print-pulse direct-print-active';
        btnDirect.innerHTML = '<span>📄 프린터로 전송 중... (지잉- 징-)</span>';
        
        if (statusBox) {
          statusBox.style.display = 'block';
          statusTitle.textContent = '🖨️ 프린터 모터 가동 중...';
          statusSub.textContent = '종이가 곧 배출됩니다. 트레이를 확인해주세요.';
        }

        soundFX.playPrintingSound(3.5);

        try {
          const res = await fetch(`/api/jobs/${job.id}/trigger-print`, {
            method: 'POST'
          });
          const data = await res.json();

          // Wait 3.5s for print completion simulation
          setTimeout(() => {
            soundFX.playSuccessChime();
            btnDirect.className = 'btn-direct-print-pulse direct-print-done';
            btnDirect.innerHTML = '<span>✅ 인쇄 완료! 출력물을 챙겨주세요</span>';
            
            if (statusBox) {
              statusTitle.textContent = '🎉 출력이 완료되었습니다!';
              statusTitle.style.color = '#34d399';
              statusSub.textContent = '개인정보 보호를 위해 문서는 서버에서 영구 삭제되었습니다.';
            }

            if (btnNewJob) {
              btnNewJob.style.display = 'block';
              btnNewJob.onclick = () => {
                window.location.reload();
              };
            }
          }, 3500);

        } catch (err) {
          console.error(err);
          btnDirect.disabled = false;
          btnDirect.textContent = '❌ 출력 오류 발생 (다시 시도)';
        }
      };
    }
  }
}

// -------------------------------------------------------------
// Kiosk Numpad & Hardware Simulator Logic
// -------------------------------------------------------------
function setupKioskHandlers() {
  const pinDisplay = document.getElementById('pinDisplayBox');
  const numButtons = document.querySelectorAll('.num-btn');
  const btnPrint = document.getElementById('btnKioskPrint');
  const soundToggle = document.getElementById('soundToggleBtn');

  if (soundToggle) {
    soundToggle.addEventListener('click', () => {
      soundFX.enabled = !soundFX.enabled;
      soundToggle.textContent = soundFX.enabled ? '🔊 사운드 ON' : '🔇 사운드 OFF';
      soundToggle.style.opacity = soundFX.enabled ? '1' : '0.5';
    });
  }

  numButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      soundFX.init();
      const val = btn.dataset.num;

      if (val === 'clear') {
        currentKioskPin = '';
      } else if (val === 'back') {
        currentKioskPin = currentKioskPin.slice(0, -1);
      } else if (val) {
        if (currentKioskPin.length < 6) {
          currentKioskPin += val;
        }
      }

      if (pinDisplay) {
        pinDisplay.textContent = currentKioskPin || '______';
      }
    });
  });

  if (btnPrint) {
    btnPrint.addEventListener('click', triggerPrintByPin);
  }
}

async function triggerPrintByPin() {
  if (currentKioskPin.length !== 6) {
    alert('6자리 PIN 번호를 모두 입력해주세요.');
    return;
  }

  soundFX.init();

  try {
    const res = await fetch('/api/jobs/print-by-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: currentKioskPin })
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.error || '인쇄 요청 실패');
      return;
    }

    currentKioskPin = '';
    const pinDisplay = document.getElementById('pinDisplayBox');
    if (pinDisplay) pinDisplay.textContent = '______';

  } catch (err) {
    console.error(err);
    alert('서버와 통신할 수 없습니다.');
  }
}

function triggerKioskPrintAnimation(job) {
  const led = document.getElementById('printerLed');
  const paper = document.getElementById('ejectingPaper');
  const statusText = document.getElementById('printerStatusText');
  const paperDocTitle = document.getElementById('ejectedDocTitle');

  if (led) {
    led.className = 'printer-led busy';
  }
  if (statusText) {
    statusText.textContent = `[PRINTING] ${job.originalName} (${job.totalPages}매 인쇄 중...)`;
    statusText.style.color = '#fbbf24';
  }
  if (paperDocTitle) {
    paperDocTitle.textContent = `${job.originalName} (${job.colorMode === 'color' ? '컬러' : '흑백'})`;
  }
  if (paper) {
    paper.classList.add('printing-active');
  }

  // Play mechanical printer sound!
  soundFX.playPrintingSound(3.5);
}

function finishKioskPrintAnimation(job) {
  const led = document.getElementById('printerLed');
  const statusText = document.getElementById('printerStatusText');

  if (led) {
    led.className = 'printer-led';
  }
  if (statusText) {
    statusText.textContent = `[정상 대기] 인쇄 완료 (${job.originalName})`;
    statusText.style.color = '#34d399';
  }

  // Play victory chime!
  soundFX.playSuccessChime();

  // Reset paper animation after 4 seconds
  setTimeout(() => {
    const paper = document.getElementById('ejectingPaper');
    if (paper) paper.classList.remove('printing-active');
  }, 4000);
}

function showKioskToast(msg) {
  console.log('Toast:', msg);
}

// -------------------------------------------------------------
// History Table Render
// -------------------------------------------------------------
function renderHistory(jobs) {
  const list = document.getElementById('historyList');
  if (!list) return;
  list.innerHTML = '';
  jobs.forEach(j => addHistoryItem(j, false));
}

function addHistoryItem(job, prepend = true) {
  const list = document.getElementById('historyList');
  if (!list) return;

  const div = document.createElement('div');
  div.className = 'history-item';
  div.id = `job-item-${job.id}`;

  const statusBadge = getStatusBadge(job.status);

  div.innerHTML = `
    <div>
      <div style="font-weight: 600; color: #f8fafc;">${job.originalName}</div>
      <div style="font-size: 11px; color: #94a3b8;">PIN: <b style="color: #00f2fe;">${job.pin}</b> | ${job.totalPages}매 | ${(job.totalPrice || 0).toLocaleString()}원</div>
    </div>
    <div id="badge-${job.id}">${statusBadge}</div>
  `;

  if (prepend && list.firstChild) {
    list.insertBefore(div, list.firstChild);
  } else {
    list.appendChild(div);
  }
}

function updateHistoryItem(job) {
  const badgeEl = document.getElementById(`badge-${job.id}`);
  if (badgeEl) {
    badgeEl.innerHTML = getStatusBadge(job.status);
  }
}

function getStatusBadge(status) {
  switch (status) {
    case 'READY_TO_PAY':
      return `<span class="badge" style="background: rgba(255,255,255,0.1); color: #cbd5e1;">결제 대기</span>`;
    case 'PAID':
      return `<span class="badge badge-paid">결제 완료</span>`;
    case 'PRINTING':
      return `<span class="badge badge-printing">인쇄 중 🖨️</span>`;
    case 'COMPLETED':
      return `<span class="badge badge-completed">출력 완료 ✅</span>`;
    default:
      return `<span class="badge">${status}</span>`;
  }
}

// Global Init on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  setupMobileHandlers();
  setupKioskHandlers();
});
