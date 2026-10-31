const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const { exec } = require('child_process');
const QRCode = require('qrcode');

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'https://ezforme.kr';

// Load environment variables from .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      value = value.replace(/^['"](.*)['"]$/, '$1').trim();
      process.env[key] = value;
    }
  });
}

const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm';
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e4);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// PRD single-domain page routes. Keep the original split-view demo available.
for (const [route, file] of Object.entries({
  '/signup': 'signup.html',
  '/admin': 'admin.html',
  '/demo': 'demo.html',
  '/kiosk': 'kiosk.html',
  '/mobile': 'mobile.html',
  '/print': 'mobile.html',
  '/setup-wifi': 'setup-wifi.html',
  '/install': 'partner-install-card.html',
  '/terms': 'terms.html',
  '/privacy': 'privacy.html',
  '/stand': 'stand.html'
})) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
}
app.get('/p/:stationId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

// Dynamic QR Code Generator API for ezforme.kr
app.get('/api/qr', async (req, res) => {
  const { stationId, url, format = 'png' } = req.query;
  const targetUrl = url || (stationId ? `${BASE_DOMAIN}/p/${stationId}` : `${BASE_DOMAIN}/mobile`);

  try {
    if (format === 'svg') {
      const svg = await QRCode.toString(targetUrl, { type: 'svg', margin: 2 });
      res.type('image/svg+xml').send(svg);
    } else {
      const buffer = await QRCode.toBuffer(targetUrl, { width: 500, margin: 2 });
      res.type('image/png').send(buffer);
    }
  } catch (err) {
    console.error('[QR GEN ERROR]', err);
    res.status(500).json({ error: 'QR 코드 생성 실패' });
  }
});


// --- B2B Shared Office & Tenant Data Models ---
const branchConfig = {
  branchId: 'BRANCH-GANGNAM-01',
  branchName: '패스트파이브 강남 1호점 (공유오피스)',
  saasPlan: {
    planName: 'B2B Pro SaaS',
    monthlySubscriptionFee: 49000, // ezforme가 공유오피스로부터 받는 월 고정 솔루션 구독료
    currency: 'KRW',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    contractDate: '2026-10-01'
  },
  policy: {
    overageBwUnitPrice: 100,       // 초과 흑백 단가 (100원)
    overageColorUnitPrice: 300,    // 초과 컬러 단가 (300원)
    overageBillingMode: 'POST_INVOICE', // 'POST_INVOICE' (월말 관리비 합산) vs 'INSTANT_PAY' (사용자 즉시 결제)
    maxPagesPerJobCap: 50          // 사적 대량 인쇄 방지 캡 (1회 최대 50매)
  }
};

// In-memory Tenant Database (공유오피스 입주사 목록 및 실시간 크레딧 잔여량)
const tenants = new Map([
  ['ALPHA', {
    id: 'TENANT-001',
    code: 'ALPHA',
    name: '(주)알파테크 (501호)',
    monthlyQuota: { bw: 100, color: 20 },       // 월 기본 무료 제공량
    currentUsage: { bw: 32, color: 6 },         // 이번 달 누적 사용량
    overage: { bw: 0, color: 0, amount: 0 },     // 초과 사용량 및 초과 과금액
    contact: 'admin@alphatech.kr',
    updatedAt: new Date().toISOString()
  }],
  ['BETA', {
    id: 'TENANT-002',
    code: 'BETA',
    name: '베타벤처스 (604호)',
    monthlyQuota: { bw: 50, color: 10 },
    currentUsage: { bw: 54, color: 12 },        // 이미 무료 초과 상태! (흑백 4장, 컬러 2장 초과)
    overage: { bw: 4, color: 2, amount: 1000 }, // 4*100 + 2*300 = 1,000원
    contact: 'ops@betavc.com',
    updatedAt: new Date().toISOString()
  }],
  ['GAMMA', {
    id: 'TENANT-003',
    code: 'GAMMA',
    name: '감마디자인랩 (302호)',
    monthlyQuota: { bw: 200, color: 50 },
    currentUsage: { bw: 15, color: 2 },
    overage: { bw: 0, color: 0, amount: 0 },
    contact: 'design@gamma.io',
    updatedAt: new Date().toISOString()
  }]
]);

// In-memory Job Queue
const jobs = new Map();

// Generate readable 6-digit PIN (e.g., 739241)
function generatePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Broadcast to all connected WebSocket clients
function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  console.log('⚡ [ezForme WS] New client connected');
  
  // Send current active jobs and B2B tenant status on connect
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    payload: {
      jobs: Array.from(jobs.values()).slice(-10),
      branch: branchConfig,
      tenants: Array.from(tenants.values())
    }
  }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {
      console.error('WS Error:', e.message);
    }
  });
});

// API 1: File Upload & Print Job Registration (B2C & B2B SaaS Hybrid)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '파일이 전송되지 않았습니다.' });
  }

  const {
    colorMode = 'bw',       // 'bw' or 'color'
    copies = 1,             // 1 to 99
    duplex = 'single',       // 'single' or 'double'
    paperSize = 'A4',
    stationId = 'STATION-01',
    tenantCode = ''         // Optional B2B Tenant Code ('ALPHA', 'BETA', etc.)
  } = req.body;

  // Simple page estimate (simulate 1-20 pages based on file size or default to 2)
  const estimatedPages = Math.max(1, Math.min(20, Math.ceil(req.file.size / (150 * 1024)))) || 1;
  const numCopies = parseInt(copies, 10) || 1;
  const totalPages = estimatedPages * numCopies;

  // Check 1회 인쇄 매수 캡 (사적 대량 인쇄 방지)
  if (totalPages > branchConfig.policy.maxPagesPerJobCap) {
    return res.status(400).json({
      error: `1회 최대 인쇄 한도(${branchConfig.policy.maxPagesPerJobCap}매)를 초과했습니다. (요청: ${totalPages}매)`
    });
  }
  
  // Pricing: BW 100 KRW/page, Color 300 KRW/page
  const unitPrice = colorMode === 'color' 
    ? branchConfig.policy.overageColorUnitPrice 
    : branchConfig.policy.overageBwUnitPrice;
  const normalTotalPrice = totalPages * unitPrice;

  const jobId = 'JOB-' + Date.now().toString(36).toUpperCase();
  const pin = generatePin();

  // B2B Quota & Overage Calculation Engine
  let b2bMeta = {
    isB2B: false,
    tenant: null,
    quotaDeducted: 0,
    overagePages: 0,
    overageAmount: 0,
    billingNote: ''
  };

  const normalizedCode = (tenantCode || '').trim().toUpperCase();
  const matchedTenant = tenants.get(normalizedCode);

  let initialStatus = 'READY_TO_PAY'; // B2C default
  let finalTotalPrice = normalTotalPrice;

  if (matchedTenant) {
    b2bMeta.isB2B = true;
    b2bMeta.tenant = {
      id: matchedTenant.id,
      code: matchedTenant.code,
      name: matchedTenant.name
    };

    const quotaKey = colorMode === 'color' ? 'color' : 'bw';
    const totalAllowed = matchedTenant.monthlyQuota[quotaKey];
    const currentUsed = matchedTenant.currentUsage[quotaKey];
    const remainingFree = Math.max(0, totalAllowed - currentUsed);

    if (totalPages <= remainingFree) {
      // 100% 무료 쿼터 범위 내 출력
      matchedTenant.currentUsage[quotaKey] += totalPages;
      b2bMeta.quotaDeducted = totalPages;
      b2bMeta.overagePages = 0;
      b2bMeta.overageAmount = 0;
      b2bMeta.billingNote = `입주사 무료 크레딧 적용 (${totalPages}매 차감 / 잔여: ${totalAllowed - matchedTenant.currentUsage[quotaKey]}매)`;
      
      finalTotalPrice = 0;
      initialStatus = 'PAID'; // B2B 무료 크레딧 즉시 승인!
    } else {
      // 무료 쿼터 초과 발생!
      const freeCovered = remainingFree;
      const overageCount = totalPages - freeCovered;
      const overageCost = overageCount * unitPrice;

      matchedTenant.currentUsage[quotaKey] += totalPages;
      matchedTenant.overage[quotaKey] += overageCount;
      matchedTenant.overage.amount += overageCost;

      b2bMeta.quotaDeducted = freeCovered;
      b2bMeta.overagePages = overageCount;
      b2bMeta.overageAmount = overageCost;

      if (branchConfig.policy.overageBillingMode === 'POST_INVOICE') {
        // 공유오피스 익월 관리비 합산 모드: 사용자 카드결제 없이 자동 승인!
        b2bMeta.billingNote = `무료 한도 초과! 초과분 ${overageCount}매(${overageCost.toLocaleString()}원)는 익월 입주사 관리비에 합산 청구됩니다.`;
        finalTotalPrice = 0;
        initialStatus = 'PAID';
      } else {
        // 즉시 결제 모드: 초과분에 대해서만 Toss 결제창 호출
        b2bMeta.billingNote = `무료 한도 초과! 초과분 ${overageCount}매에 대한 ${overageCost.toLocaleString()}원 결제가 필요합니다.`;
        finalTotalPrice = overageCost;
        initialStatus = 'READY_TO_PAY';
      }
    }

    matchedTenant.updatedAt = new Date().toISOString();
    broadcast('B2B_USAGE_UPDATED', {
      tenant: matchedTenant,
      allTenants: Array.from(tenants.values())
    });
  }

  const job = {
    id: jobId,
    pin: pin,
    originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), // handle Korean filenames
    savedFileName: req.file.filename,
    fileSize: req.file.size,
    fileUrl: `/uploads/${req.file.filename}`,
    colorMode,
    copies: numCopies,
    duplex,
    paperSize,
    stationId,
    pages: estimatedPages,
    totalPages,
    unitPrice,
    totalPrice: finalTotalPrice,
    originalTotalPrice: normalTotalPrice,
    status: initialStatus, // READY_TO_PAY -> PAID -> PRINTING -> COMPLETED -> FAILED
    b2b: b2bMeta,
    createdAt: new Date().toISOString()
  };

  jobs.set(jobId, job);
  broadcast('JOB_CREATED', job);

  res.json({
    success: true,
    job
  });
});

// API 2: Simulate Payment Approval (For B2C Guests or B2B Instant Overage)
app.post('/api/jobs/:id/pay', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: '해당 인쇄 작업을 찾을 수 없습니다.' });
  }

  const { method = 'tosspayments_card' } = req.body || {};
  job.status = 'PAID';
  job.paymentMethod = method; // 'tosspayments_card', 'kakaopay', 'naverpay', 'tosspay'
  job.paidAt = new Date().toISOString();

  jobs.set(job.id, job);
  broadcast('JOB_PAID', job);

  res.json({
    success: true,
    message: '결제가 완료되었습니다. 스테이션에서 6자리 PIN을 입력하시면 출력이 시작됩니다.',
    job
  });
});

// Config API: Public Toss Payments Client Key
app.get('/api/config', (req, res) => {
  res.json({
    tossClientKey: TOSS_CLIENT_KEY
  });
});

// API 2-B: Real Toss Payments Confirm API (Backend Verification)
app.post('/api/payments/toss/confirm', async (req, res) => {
  const { paymentKey, orderId, amount, jobId } = req.body || {};

  if (!paymentKey || !orderId || !amount || !jobId) {
    return res.status(400).json({ error: '필수 결제 승인 파라미터가 누락되었습니다.' });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: '해당 인쇄 작업을 찾을 수 없습니다.' });
  }

  // 1. Amount Verification (위변조 방지)
  if (Number(amount) !== Number(job.totalPrice)) {
    console.error(`[PAYMENT FRAUD ALERT] Job ${jobId} price mismatch: expected ${job.totalPrice}, got ${amount}`);
    return res.status(400).json({ error: '결제 요청 금액과 승인 금액이 일치하지 않습니다.' });
  }

  try {
    const basicAuth = Buffer.from(TOSS_SECRET_KEY + ':').toString('base64');
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(amount)
      })
    });

    const tossData = await tossRes.json();
    if (!tossRes.ok) {
      console.error('[TOSS CONFIRM FAILED]', tossData);
      return res.status(400).json({
        error: tossData.message || '토스페이먼츠 승인에 실패했습니다.',
        code: tossData.code
      });
    }

    // 2. Mark Job as PAID
    job.status = 'PAID';
    job.paymentMethod = tossData.method || '토스페이먼츠';
    job.paymentKey = paymentKey;
    job.orderId = orderId;
    job.paidAt = tossData.approvedAt || new Date().toISOString();
    job.tossPayment = {
      method: tossData.method,
      totalAmount: tossData.totalAmount,
      card: tossData.card,
      easyPay: tossData.easyPay,
      receiptUrl: tossData.receipt?.url
    };

    jobs.set(job.id, job);
    broadcast('JOB_PAID', job);

    console.log(`[TOSS PAYMENT APPROVED] Job ${job.id} approved for ${job.totalPrice}원 via ${job.paymentMethod}`);

    res.json({
      success: true,
      message: '토스페이먼츠 결제 승인이 완료되었습니다.',
      job
    });
  } catch (err) {
    console.error('[TOSS API EXCEPTION]', err);
    res.status(500).json({ error: '토스 결제 서버와의 통신 중 오류가 발생했습니다.' });
  }
});

// Toss Payments Browser Success Redirect Handler
app.get('/payment/success', async (req, res) => {
  const { paymentKey, orderId, amount, jobId } = req.query;

  if (!paymentKey || !orderId || !amount || !jobId) {
    return res.redirect('/payment/fail?message=' + encodeURIComponent('필수 결제 정보가 누락되었습니다.'));
  }

  const job = jobs.get(jobId);
  if (!job) {
    return res.redirect('/payment/fail?message=' + encodeURIComponent('인쇄 작업을 찾을 수 없습니다.'));
  }

  if (Number(amount) !== Number(job.totalPrice)) {
    return res.redirect('/payment/fail?message=' + encodeURIComponent('결제 금액 위변조가 감지되었습니다.'));
  }

  try {
    const basicAuth = Buffer.from(TOSS_SECRET_KEY + ':').toString('base64');
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(amount)
      })
    });

    const tossData = await tossRes.json();
    if (!tossRes.ok) {
      console.error('[TOSS REDIRECT CONFIRM ERROR]', tossData);
      return res.redirect(`/payment/fail?jobId=${jobId}&message=` + encodeURIComponent(tossData.message || '승인 실패'));
    }

    job.status = 'PAID';
    job.paymentMethod = tossData.method || '토스페이먼츠';
    job.paymentKey = paymentKey;
    job.orderId = orderId;
    job.paidAt = tossData.approvedAt || new Date().toISOString();
    job.tossPayment = {
      method: tossData.method,
      totalAmount: tossData.totalAmount,
      card: tossData.card,
      easyPay: tossData.easyPay,
      receiptUrl: tossData.receipt?.url
    };

    jobs.set(job.id, job);
    broadcast('JOB_PAID', job);

    console.log(`[TOSS REDIRECT APPROVED] Job ${job.id} approved for ${job.totalPrice}원`);

    // Redirect to mobile page with paid parameter
    res.redirect(`/mobile.html?jobId=${job.id}&paid=1`);
  } catch (err) {
    console.error('[TOSS REDIRECT ERROR]', err);
    res.redirect(`/payment/fail?jobId=${jobId}&message=` + encodeURIComponent('결제 승인 처리 중 네트워크 오류'));
  }
});

// Toss Payments Browser Fail Redirect Handler
app.get('/payment/fail', (req, res) => {
  const { message = '결제가 취소되었거나 승인에 실패했습니다.', jobId } = req.query;
  res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ezForme - 결제 실패</title>
      <link rel="stylesheet" href="/css/style.css">
      <style>
        body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #090d16; padding: 20px; font-family: -apple-system, sans-serif; }
        .fail-card { background: #0f172a; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 16px; padding: 32px 24px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
      </style>
    </head>
    <body>
      <div class="fail-card">
        <div style="font-size: 48px; margin-bottom: 12px;">⚠️</div>
        <h2 style="font-size: 18px; color: #f87171; margin-bottom: 8px;">결제가 완료되지 않았습니다</h2>
        <p style="font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px;">${message}</p>
        <a href="/mobile.html${jobId ? '?retryJob=' + jobId : ''}" style="display: block; background: #38bdf8; color: #0b1120; padding: 12px; border-radius: 8px; font-weight: 700; text-decoration: none;">다시 시도하기</a>
      </div>
    </body>
    </html>
  `);
});

// API 3: Trigger Print by 6-digit PIN (From Station Kiosk)
app.post('/api/jobs/print-by-pin', (req, res) => {
  const { pin } = req.body || {};
  if (!pin) {
    return res.status(400).json({ error: '6자리 PIN 번호를 입력해주세요.' });
  }

  const job = Array.from(jobs.values()).find(j => j.pin === pin.trim());
  if (!job) {
    return res.status(404).json({ error: '일치하는 인쇄 작업을 찾을 수 없습니다. PIN 번호를 확인해주세요.' });
  }

  if (job.status === 'COMPLETED') {
    return res.status(400).json({ error: '이미 출력이 완료된 작업입니다.' });
  }

  // Helper to trigger physical print spooling via CUPS lp
  function buildLpOptions(job) {
    const opts = ['-o PageSize=A4', '-o fit-to-page'];
    if (job.copies && job.copies > 1) {
      opts.push(`-n ${job.copies}`);
    }
    if (job.colorMode === 'bw') {
      opts.push('-o ColorModel=KGray');
    }
    if (job.duplex === 'double') {
      opts.push('-o sides=two-sided-long-edge');
    }
    return opts;
  }

  function triggerSpoolPrint(job) {
    const filePath = path.join(UPLOAD_DIR, job.savedFileName);
    const options = buildLpOptions(job);

    const printCmd = `lp ${options.join(' ')} "${filePath}"`;
    console.log(`[PRINT DISPATCH] Executing: ${printCmd}`);

    exec(printCmd, (err, stdout, stderr) => {
      if (err) {
        console.warn(`[PRINT SPOOL WARNING] lp command: ${stderr || err.message}`);
      } else {
        console.log(`[PRINT SPOOL SUCCESS] Spooled job ${job.id}: ${stdout.trim()}`);
      }
    });

    // Broadcast intermediate printing event when physical paper starts feeding (~5s)
    setTimeout(() => {
      broadcast('PRINT_IN_PROGRESS', job);
    }, 5000);

    // Broadcast completion when paper is fully ejected to tray (~8.5s)
    setTimeout(() => {
      job.status = 'COMPLETED';
      job.completedAt = new Date().toISOString();
      broadcast('PRINT_COMPLETED', job);
    }, 8500);
  }

  // Start Printing Process
  job.status = 'PRINTING';
  job.printStartedAt = new Date().toISOString();
  broadcast('PRINT_STARTED', job);

  triggerSpoolPrint(job);

  res.json({
    success: true,
    message: '프린터로 스풀링 전송을 시작합니다.',
    job
  });
});

// API 3-B: Direct Print Trigger from Mobile Web (Zero-Kiosk Mode)
app.post('/api/jobs/:id/trigger-print', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: '해당 인쇄 작업을 찾을 수 없습니다.' });
  }

  if (job.status === 'COMPLETED') {
    return res.status(400).json({ error: '이미 출력이 완료된 작업입니다.' });
  }

  // Start Printing Process
  job.status = 'PRINTING';
  job.printStartedAt = new Date().toISOString();
  broadcast('PRINT_STARTED', job);

  const filePath = path.join(UPLOAD_DIR, job.savedFileName);
  const options = ['-o PageSize=A4', '-o fit-to-page'];
  if (job.copies && job.copies > 1) {
    options.push(`-n ${job.copies}`);
  }
  if (job.colorMode === 'bw') {
    options.push('-o ColorModel=KGray');
  }
  if (job.duplex === 'double') {
    options.push('-o sides=two-sided-long-edge');
  }

  const printCmd = `lp ${options.join(' ')} "${filePath}"`;
  console.log(`[PRINT DISPATCH] Executing: ${printCmd}`);

  exec(printCmd, (err, stdout, stderr) => {
    if (err) {
      console.warn(`[PRINT SPOOL WARNING] lp command: ${stderr || err.message}`);
    } else {
      console.log(`[PRINT SPOOL SUCCESS] Spooled job ${job.id}: ${stdout.trim()}`);
    }
  });

  // Broadcast intermediate printing event when physical paper starts feeding (~5s)
  setTimeout(() => {
    broadcast('PRINT_IN_PROGRESS', job);
  }, 5000);

  // Broadcast completion when paper is fully ejected to tray (~8.5s)
  setTimeout(() => {
    job.status = 'COMPLETED';
    job.completedAt = new Date().toISOString();
    broadcast('PRINT_COMPLETED', job);
  }, 8500);

  res.json({
    success: true,
    message: '프린터로 출력을 즉시 시작합니다.',
    job
  });
});

// API 4: Get Job Status
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  }
  res.json(job);
});

// API 5: List Recent Jobs
app.get('/api/jobs', (req, res) => {
  res.json(Array.from(jobs.values()).reverse().slice(0, 20));
});

// --- B2B SaaS Specific Management APIs ---

// B2B API 1: Get Branch Info & Active SaaS Subscription Status
app.get('/api/b2b/branch', (req, res) => {
  res.json({
    success: true,
    branch: branchConfig
  });
});

// B2B API 2: List All Tenants with Current Quota & Overage Metrics
app.get('/api/b2b/tenants', (req, res) => {
  const tenantList = Array.from(tenants.values()).map(t => {
    const bwPercent = Math.min(100, Math.round((t.currentUsage.bw / t.monthlyQuota.bw) * 100));
    const colorPercent = Math.min(100, Math.round((t.currentUsage.color / t.monthlyQuota.color) * 100));
    return {
      ...t,
      metrics: {
        bwUsageRate: bwPercent,
        colorUsageRate: colorPercent,
        hasOverage: t.overage.amount > 0
      }
    };
  });
  res.json({
    success: true,
    branchId: branchConfig.branchId,
    branchName: branchConfig.branchName,
    tenants: tenantList
  });
});

// B2B API 3: Register or Update Tenant
app.post('/api/b2b/tenants', (req, res) => {
  const { code, name, bwQuota = 100, colorQuota = 20, contact = '' } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: '입주사 코드와 회사명은 필수입니다.' });
  }

  const normalizedCode = code.trim().toUpperCase();
  const existing = tenants.get(normalizedCode);

  const tenantObj = {
    id: existing ? existing.id : 'TENANT-' + Date.now().toString(36).toUpperCase(),
    code: normalizedCode,
    name: name.trim(),
    monthlyQuota: {
      bw: parseInt(bwQuota, 10) || 100,
      color: parseInt(colorQuota, 10) || 20
    },
    currentUsage: existing ? existing.currentUsage : { bw: 0, color: 0 },
    overage: existing ? existing.overage : { bw: 0, color: 0, amount: 0 },
    contact: contact.trim(),
    updatedAt: new Date().toISOString()
  };

  tenants.set(normalizedCode, tenantObj);
  broadcast('B2B_TENANTS_CHANGED', Array.from(tenants.values()));

  res.json({
    success: true,
    tenant: tenantObj
  });
});

// B2B API 4: Generate Monthly Billing Report (JSON or Downloadable CSV)
app.get('/api/b2b/monthly-report', (req, res) => {
  const { format } = req.query; // 'json' or 'csv'
  const now = new Date();
  const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const tenantSummaries = Array.from(tenants.values()).map(t => {
    return {
      tenantCode: t.code,
      tenantName: t.name,
      contact: t.contact,
      monthlyQuotaBw: t.monthlyQuota.bw,
      monthlyQuotaColor: t.monthlyQuota.color,
      currentUsageBw: t.currentUsage.bw,
      currentUsageColor: t.currentUsage.color,
      overageBwPages: t.overage.bw,
      overageColorPages: t.overage.color,
      overageTotalAmount: t.overage.amount
    };
  });

  const totalOverageToCollect = tenantSummaries.reduce((sum, t) => sum + t.overageTotalAmount, 0);

  // If CSV format requested by Shared Office Manager
  if (format === 'csv') {
    const BOM = '\uFEFF'; // UTF-8 BOM for Korean Excel compatibility
    let csv = BOM;
    csv += `[ezForme B2B SaaS] 입주사별 월간 출력 정산 및 관리비 합산 청구 명세서\n`;
    csv += `정산 월,${billingMonth}\n`;
    csv += `공유오피스 지점,${branchConfig.branchName}\n`;
    csv += `ezforme SaaS 월 고정 구독료,${branchConfig.saasPlan.monthlySubscriptionFee.toLocaleString()}원\n`;
    csv += `입주사 초과 과금 합산 총액,${totalOverageToCollect.toLocaleString()}원\n\n`;
    
    csv += `입주사코드,회사명,연락처,흑백제공량,컬러제공량,흑백사용량,컬러사용량,흑백초과(매),컬러초과(매),관리비합산청구액(원)\n`;

    tenantSummaries.forEach(t => {
      csv += `"${t.tenantCode}","${t.tenantName}","${t.contact}",${t.monthlyQuotaBw},${t.monthlyQuotaColor},${t.currentUsageBw},${t.currentUsageColor},${t.overageBwPages},${t.overageColorPages},${t.overageTotalAmount}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ezforme_billing_${billingMonth}.csv"`);
    return res.send(csv);
  }

  // JSON Response
  res.json({
    success: true,
    billingMonth,
    branch: {
      branchId: branchConfig.branchId,
      branchName: branchConfig.branchName,
      saasSubscriptionFee: branchConfig.saasPlan.monthlySubscriptionFee
    },
    summary: {
      totalTenants: tenants.size,
      totalOverageAmountToBill: totalOverageToCollect
    },
    tenants: tenantSummaries
  });
});

// B2B API 5: Simulate Monthly Reset / Rollover
app.post('/api/b2b/reset-monthly', (req, res) => {
  tenants.forEach(t => {
    t.currentUsage = { bw: 0, color: 0 };
    t.overage = { bw: 0, color: 0, amount: 0 };
    t.updatedAt = new Date().toISOString();
  });

  broadcast('B2B_USAGE_UPDATED', {
    message: '새로운 정산 월이 시작되어 모든 입주사의 무료 크레딧이 갱신되었습니다.',
    allTenants: Array.from(tenants.values())
  });

  res.json({
    success: true,
    message: '월간 크레딧이 100% 초기화되었습니다.'
  });
});

// API 6: Check System Printers Status
app.get('/api/system/printers', (req, res) => {
  exec('lpstat -p -d', (err, stdout, stderr) => {
    if (err) {
      return res.json({
        hasPrinters: false,
        raw: stderr || err.message,
        mode: 'VIRTUAL_SIMULATION'
      });
    }
    res.json({
      hasPrinters: true,
      raw: stdout,
      mode: 'PHYSICAL_READY'
    });
  });
});

// API 7: Scan Nearby Wi-Fi Networks (For Partner Self-Setup)
app.get('/api/wifi/scan', (req, res) => {
  exec('nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list --rescan yes', (err, stdout, stderr) => {
    if (err) {
      return res.json({
        success: true,
        networks: [
          { ssid: '매장_5G_고객용', signal: 94, security: 'WPA2' },
          { ssid: 'StudyCafe_Main_Wi-Fi', signal: 82, security: 'WPA2' },
          { ssid: 'KT_GIGA_2G', signal: 68, security: 'WPA2' }
        ]
      });
    }

    const lines = (stdout || '').trim().split('\n');
    const seen = new Set();
    const networks = [];

    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const ssid = parts[0].trim();
        const signal = parseInt(parts[1], 10) || 50;
        const security = parts[2] || 'WPA2';
        if (ssid && !seen.has(ssid) && ssid !== '--') {
          seen.add(ssid);
          networks.push({ ssid, signal, security });
        }
      }
    }

    res.json({
      success: true,
      networks: networks.sort((a, b) => b.signal - a.signal)
    });
  });
});

// API 8: Connect to Selected Store Wi-Fi
app.post('/api/wifi/connect', (req, res) => {
  const { ssid, password } = req.body || {};
  if (!ssid) {
    return res.status(400).json({ error: '와이파이 이름을 선택해 주세요.' });
  }

  const safeSsid = ssid.replace(/(["$`\\])/g, '\\$1');
  const safePass = (password || '').replace(/(["$`\\])/g, '\\$1');
  const cmd = password
    ? `nmcli dev wifi connect "${safeSsid}" password "${safePass}"`
    : `nmcli dev wifi connect "${safeSsid}"`;

  console.log(`[WIFI SETUP] Attempting connection to SSID: ${ssid}`);
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.warn(`[WIFI SETUP FAILED]: ${stderr || err.message}`);
      return res.status(500).json({
        success: false,
        error: `와이파이 연결에 실패했습니다: ${stderr || err.message}`
      });
    }

    console.log(`[WIFI SETUP SUCCESS]: ${stdout.trim()}`);
    res.json({
      success: true,
      message: `'${ssid}' 와이파이에 성공적으로 연결되었습니다!`,
      output: stdout.trim()
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🖨️  ezForme Station Server Running on http://localhost:${PORT}`);
  console.log(`🏢  B2B SaaS Shared Office Branch: ${branchConfig.branchName}`);
  console.log(`📱 Mobile User Interface: http://localhost:${PORT}/mobile.html`);
  console.log(`🖥️  Station Kiosk View:   http://localhost:${PORT}/kiosk.html`);
  console.log(`🎛️  Dual Live Split View:  http://localhost:${PORT}/demo`);
  console.log(`📊 B2B Monthly CSV:       http://localhost:${PORT}/api/b2b/monthly-report?format=csv`);
  console.log(`=======================================================`);
});

