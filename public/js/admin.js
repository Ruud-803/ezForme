'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const number = value => (Number(value) || 0).toLocaleString('ko-KR');
  const money = value => `${number(value)}원`;
  const state = { tenants: [], jobs: [], jobsLoaded: false, tenantsLoaded: false };
  const statusMap = { READY_TO_PAY: ['결제 대기', 'neutral'], PAID: ['결제 완료', ''], PRINTING: ['인쇄 중', 'warning'], COMPLETED: ['출력 완료', ''], FAILED: ['출력 실패', 'warning'] };
  let disposed = false;
  let socket;
  let reconnectTimer;
  let reloadTimer;
  const requests = new Map();
  byId('currentMonth').textContent = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
  function cell(text, tag = 'td') { const element = document.createElement(tag); element.textContent = text; return element; }
  function badge(text, kind = '') { const element = cell(text, 'span'); element.className = `badge ${kind}`; return element; }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
    let data;
    try { data = await response.json(); } catch { throw new Error('서버 응답을 읽을 수 없습니다.'); }
    if (!response.ok || data.success === false) throw new Error(data.error || '요청 처리에 실패했습니다.');
    return data;
  }
  function refreshed() { byId('lastUpdated').textContent = `최근 동기화 ${new Date().toLocaleTimeString('ko-KR')}`; }
  function showErrors() { byId('adminStatus').textContent = Array.from(requests.values()).join(' '); byId('adminStatus').classList.toggle('error', requests.size > 0); }
  function metrics() {
    if (state.tenantsLoaded) {
      const bw = state.tenants.reduce((sum, tenant) => sum + (Number(tenant.currentUsage?.bw) || 0), 0);
      const color = state.tenants.reduce((sum, tenant) => sum + (Number(tenant.currentUsage?.color) || 0), 0);
      byId('totalPages').textContent = `${number(bw + color)}매`;
      byId('pageBreakdown').textContent = `흑백 ${number(bw)}매 · 컬러 ${number(color)}매`;
      byId('totalOverage').textContent = money(state.tenants.reduce((sum, tenant) => sum + (Number(tenant.overage?.amount) || 0), 0));
      byId('overageNote').textContent = `${state.tenants.filter(tenant => tenant.overage?.amount > 0).length}개 입주사 · 월말 관리비 합산`;
    }
    if (state.jobsLoaded) {
      const now = new Date();
      const revenue = state.jobs.filter(job => {
        const date = new Date(job.createdAt);
        return ['PAID', 'PRINTING', 'COMPLETED'].includes(job.status) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      }).reduce((sum, job) => sum + (Number(job.totalPrice) || 0), 0);
      byId('totalRevenue').textContent = money(revenue);
      byId('settlementAmount').textContent = `확인된 당월 작업 · 점주 배분 ${money(Math.round(revenue * .6))}`;
    }
  }
  function renderTenants() {
    const query = byId('tenantSearch').value.trim().toLocaleLowerCase();
    const tenants = state.tenants.filter(tenant => `${tenant.name} ${tenant.code}`.toLocaleLowerCase().includes(query));
    const body = byId('tenantTableBody');
    body.replaceChildren();
    byId('tenantCount').textContent = `${state.tenants.length}개`;
    byId('tenantSummary').textContent = `전체 ${state.tenants.length}개 입주사 · ${tenants.length}개 표시`;
    if (!tenants.length) { const row = document.createElement('tr'); const item = cell(query ? '검색 결과가 없습니다.' : '등록된 입주사가 없습니다.'); item.colSpan = 7; item.className = 'empty'; row.append(item); body.append(row); }
    tenants.forEach(tenant => {
      const row = document.createElement('tr');
      const company = document.createElement('td');
      const avatar = cell(String(tenant.name || tenant.code).replace(/^\(주\)/, '').trim().slice(0, 1), 'span'); avatar.className = 'tenant-avatar';
      const name = document.createElement('span'); name.className = 'tenant-name'; name.append(cell(tenant.name, 'strong'), cell(tenant.code, 'small')); company.append(avatar, name);
      const quota = document.createElement('td'); quota.append(cell(`흑백 ${number(tenant.monthlyQuota?.bw)}매`, 'span'), cell(`컬러 ${number(tenant.monthlyQuota?.color)}매`, 'small'));
      const usage = document.createElement('td'); usage.append(cell(`흑백 ${number(tenant.currentUsage?.bw)}매`, 'span'), cell(`컬러 ${number(tenant.currentUsage?.color)}매`, 'small'));
      const percentages = ['bw', 'color'].map(mode => { const quotaCount = Number(tenant.monthlyQuota?.[mode]) || 0; const used = Number(tenant.currentUsage?.[mode]) || 0; return quotaCount ? Math.round(used / quotaCount * 100) : used > 0 ? 100 : 0; });
      const percentage = Math.max(...percentages);
      const progressCell = cell(`${percentage}%`);
      const progress = document.createElement('div'); progress.className = `usage-progress ${percentage > 100 ? 'over' : ''}`;
      progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100'); progress.setAttribute('aria-valuenow', String(Math.min(100, percentage))); progress.setAttribute('aria-label', `${tenant.name} 흑백·컬러 중 최대 쿼터 사용률`);
      const fill = document.createElement('span'); fill.style.width = `${Math.min(100, percentage)}%`; progress.append(fill); progressCell.append(progress);
      const overage = cell(`흑백 ${number(tenant.overage?.bw)} · 컬러 ${number(tenant.overage?.color)}`);
      const amount = cell(money(tenant.overage?.amount)); amount.style.fontWeight = '600';
      const status = document.createElement('td'); status.append(badge(tenant.overage?.amount > 0 ? '초과 사용' : '정상 이용', tenant.overage?.amount > 0 ? 'warning' : ''));
      row.append(company, quota, usage, progressCell, overage, amount, status); body.append(row);
    });
    metrics();
  }
  function renderJobs() {
    const list = byId('recentJobsList'); list.replaceChildren();
    if (!state.jobs.length) { const empty = cell('아직 인쇄 작업이 없습니다. 첫 작업이 도착하면 여기에 표시됩니다.', 'li'); empty.className = 'empty'; list.append(empty); }
    state.jobs.forEach(job => {
      const item = document.createElement('li'); item.className = 'job-item';
      const details = document.createElement('div');
      details.append(cell(job.originalName || '인쇄 문서', 'strong'), cell(`${job.colorMode === 'color' ? '컬러' : '흑백'} ${number(job.totalPages)}매 · ${money(job.totalPrice)} · ${new Date(job.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`, 'small'));
      const [title, kind] = statusMap[job.status] || ['상태 확인 중', 'neutral']; item.append(details, badge(title, kind)); list.append(item);
    });
    metrics();
  }
  async function loadTenants() {
    try { const data = await api('/api/b2b/tenants'); state.tenants = data.tenants; state.tenantsLoaded = true; byId('branchName').textContent = data.branchName; renderTenants(); requests.delete('tenants'); refreshed(); }
    catch (error) { requests.set('tenants', `입주사 조회 실패: ${error.message}`); if (!state.tenantsLoaded) byId('tenantTableBody').firstElementChild.firstElementChild.textContent = '입주사 조회에 실패했습니다. 서버 연결을 확인해 주세요.'; }
    showErrors();
  }
  async function loadJobs() {
    try { const data = await api('/api/jobs'); state.jobs = data.slice(0, 20); state.jobsLoaded = true; renderJobs(); requests.delete('jobs'); refreshed(); }
    catch (error) { requests.set('jobs', `작업 조회 실패: ${error.message}`); if (!state.jobsLoaded) byId('recentJobsList').textContent = '인쇄 작업을 불러올 수 없습니다.'; }
    showErrors();
  }
  async function loadPrinters() {
    try {
      const data = await api('/api/system/printers');
      const connected = data.hasPrinters === true;
      byId('activeStations').textContent = connected ? '연결 확인' : '시뮬레이션';
      byId('stationMetricNote').textContent = '로컬 프린터 조회 기준 · 전체 스테이션 집계 미제공';
      byId('printerMode').textContent = connected ? '로컬 프린터 등록 감지' : '가상 인쇄 시뮬레이터';
      byId('printerBadge').textContent = connected ? '연결 확인' : '시연 모드';
      byId('printerBadge').className = `badge ${connected ? '' : 'neutral'}`;
      byId('printerNote').textContent = connected ? '로컬 시스템에 등록된 프린터가 감지되었습니다. 실제 출력은 현장 에이전트 연결 상태를 별도로 확인해 주세요.' : '물리 프린터 연결이 감지되지 않았습니다. 현재 서버는 작업 상태 변화를 가상으로 시연합니다.';
      requests.delete('printers');
    } catch (error) { requests.set('printers', `프린터 조회 실패: ${error.message}`); byId('activeStations').textContent = '확인 불가'; byId('printerMode').textContent = '서버 연결을 확인하세요'; byId('printerBadge').textContent = '조회 실패'; byId('stationMetricNote').textContent = '프린터 상태를 불러올 수 없습니다.'; byId('printerNote').textContent = '새로고침 후 다시 확인해 주세요.'; }
    showErrors();
  }
  function connect() {
    if (disposed) return;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
    socket.addEventListener('open', () => { byId('connectionStatus').textContent = '실시간 연결'; byId('connectionStatus').classList.add('online'); });
    socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (['INIT_STATE', 'JOB_CREATED', 'JOB_PAID', 'PRINT_STARTED', 'PRINT_COMPLETED', 'B2B_USAGE_UPDATED', 'B2B_TENANTS_CHANGED'].includes(message.type)) {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => { void loadTenants(); void loadJobs(); }, 180);
      }
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => { if (disposed) return; byId('connectionStatus').textContent = '재연결 대기'; byId('connectionStatus').classList.remove('online'); reconnectTimer = setTimeout(connect, 5000); });
  }
  byId('tenantSearch').addEventListener('input', renderTenants);
  byId('btnRefreshJobs').addEventListener('click', async () => { const button = byId('btnRefreshJobs'); button.disabled = true; await Promise.allSettled([loadJobs(), loadTenants(), loadPrinters()]); button.disabled = false; });
  byId('tenantForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const values = Object.fromEntries(new FormData(form));
    const code = values.code.trim().toUpperCase();
    const status = byId('tenantFormStatus');
    status.classList.remove('error');
    if (!values.name.trim()) { status.textContent = '회사명을 입력해 주세요.'; status.classList.add('error'); return; }
    if (state.tenants.some(tenant => tenant.code === code)) { status.textContent = '이미 등록된 입주사 코드입니다. 다른 코드를 입력해 주세요.'; status.classList.add('error'); return; }
    byId('btnSaveTenant').disabled = true;
    status.textContent = '등록 중입니다…';
    try {
      await api('/api/b2b/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, code, bwQuota: Number(values.bwQuota), colorQuota: Number(values.colorQuota) }) });
      form.reset(); byId('tenantModal').close(); status.textContent = ''; await loadTenants();
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { byId('btnSaveTenant').disabled = false; }
  });
  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(reconnectTimer); clearTimeout(reloadTimer); socket?.close(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; connect(); void loadTenants(); void loadJobs(); } });
  void Promise.allSettled([loadTenants(), loadJobs(), loadPrinters()]);
  connect();
})();
