const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3456;
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

  const { method = 'tosspayments_card' } = req.body;
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

// API 3: Trigger Print by 6-digit PIN (From Station Kiosk)
app.post('/api/jobs/print-by-pin', (req, res) => {
  const { pin } = req.body;
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

  // Start Printing Process
  job.status = 'PRINTING';
  job.printStartedAt = new Date().toISOString();
  broadcast('PRINT_STARTED', job);

  // We simulate printing progress over 3.5 seconds
  setTimeout(() => {
    job.status = 'COMPLETED';
    job.completedAt = new Date().toISOString();
    broadcast('PRINT_COMPLETED', job);
  }, 3500);

  res.json({
    success: true,
    message: '프린터로 스풀링 전송을 시작합니다.',
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

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🖨️  ezForme Station Server Running on http://localhost:${PORT}`);
  console.log(`🏢  B2B SaaS Shared Office Branch: ${branchConfig.branchName}`);
  console.log(`📱 Mobile User Interface: http://localhost:${PORT}/mobile.html`);
  console.log(`🖥️  Station Kiosk View:   http://localhost:${PORT}/kiosk.html`);
  console.log(`🎛️  Dual Live Split View:  http://localhost:${PORT}/index.html`);
  console.log(`📊 B2B Monthly CSV:       http://localhost:${PORT}/api/b2b/monthly-report?format=csv`);
  console.log(`=======================================================`);
});

