'use strict';
const menuButton = document.querySelector('.menu-button');
menuButton?.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(expanded));
  menuButton.setAttribute('aria-label', expanded ? '메뉴 닫기' : '메뉴 열기');
  document.getElementById('mainNav').classList.toggle('open', expanded);
});
document.querySelectorAll('#mainNav a').forEach(link => link.addEventListener('click', () => {
  document.getElementById('mainNav').classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
  menuButton?.setAttribute('aria-label', '메뉴 열기');
}));
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => {
  document.getElementById(button.dataset.open)?.showModal();
}));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));
document.getElementById('quickPrintForm')?.addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById('quickStationCode');
  if (/^[0-9]{4}$/.test(input.value.trim())) window.location.assign(`/p/${encodeURIComponent(input.value.trim())}`);
});
const visitors = document.getElementById('visitorsInput');
function updateRevenue() {
  const count = Number(visitors.value);
  const pages = Math.round(count * .2 * 5 * 30);
  document.getElementById('visitorsValue').textContent = `${count}명`;
  document.getElementById('monthlyPages').textContent = pages.toLocaleString('ko-KR');
  document.getElementById('monthlyRevenue').textContent = `${Math.round(pages * 100 * .6).toLocaleString('ko-KR')}원`;
}
if (visitors) { visitors.addEventListener('input', updateRevenue); updateRevenue(); }
document.getElementById('unknownPrinter')?.addEventListener('change', event => {
  const input = document.getElementById('printerModel');
  input.disabled = event.target.checked;
  input.required = !event.target.checked;
});
document.getElementById('partnerForm')?.addEventListener('submit', event => {
  event.preventDefault();
  document.getElementById('partnerStatus').textContent = '도입 상담 신청이 접수되었습니다. 담당자가 확인 후 영업일 기준 1일 이내 연락드리겠습니다.';
});
const signupForm = document.getElementById('signupForm');
if (signupForm) {
  const password = document.getElementById('signupPassword');
  const confirmation = document.getElementById('signupPasswordConfirm');
  const validatePassword = () => confirmation.setCustomValidity(confirmation.value && password.value !== confirmation.value ? '비밀번호가 일치하지 않습니다.' : '');
  password.addEventListener('input', validatePassword);
  confirmation.addEventListener('input', validatePassword);
  signupForm.querySelectorAll('[name="accountType"]').forEach(input => input.addEventListener('change', () => {
    const partner = signupForm.elements.accountType.value === 'partner';
    const fields = document.getElementById('partnerFields');
    fields.hidden = !partner;
    fields.disabled = !partner;
    document.getElementById('btnSubmitSignup').textContent = partner ? '가입 및 단말기 신청 완료 ↗' : '회원가입 완료 ↗';
    document.getElementById('signupStatus').textContent = '';
  }));
  signupForm.addEventListener('submit', event => {
    event.preventDefault();
    document.getElementById('signupStatus').textContent = '파트너 가입 및 도입 신청이 접수되었습니다. 담당자가 확인 후 영업일 기준 1일 이내 안내드리겠습니다.';
  });
}

// Guest Checkout (Non-member PG payment path for B2B plans using v2 Payment Widget)
const guestCheckoutDialog = document.getElementById('guestCheckoutDialog');
const guestCheckoutForm = document.getElementById('guestCheckoutForm');
let selectedPlan = { id: 'standard', name: 'ezForme B2B 스탠다드 월 구독', amount: 39000 };
let b2bWidgets = null;

async function mountB2BPaymentWidget(amount) {
  const statusEl = document.getElementById('guestCheckoutStatus');
  const methodsEl = document.getElementById('b2bPaymentMethods');
  const agreementEl = document.getElementById('b2bAgreement');
  if (!methodsEl || !agreementEl) return;

  methodsEl.innerHTML = '';
  agreementEl.innerHTML = '';
  if (statusEl) statusEl.textContent = '결제 수단 및 약관을 불러오는 중...';

  try {
    const cfgRes = await fetch('/api/config');
    const cfg = await cfgRes.json();
    const clientKey = cfg.tossClientKey || 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm';
    if (typeof TossPayments === 'undefined') {
      throw new Error('결제 모듈(PG SDK)을 불러오지 못했습니다.');
    }
    const tossPayments = TossPayments(clientKey);
    b2bWidgets = tossPayments.widgets({ customerKey: TossPayments.ANONYMOUS });
    await b2bWidgets.setAmount({ currency: 'KRW', value: amount });
    await Promise.all([
      b2bWidgets.renderPaymentMethods({ selector: '#b2bPaymentMethods', variantKey: 'DEFAULT' }),
      b2bWidgets.renderAgreement({ selector: '#b2bAgreement', variantKey: 'AGREEMENT' })
    ]);
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    if (statusEl) statusEl.textContent = err?.message || '결제 수단 초기화 중 오류가 발생했습니다.';
  }
}

document.querySelectorAll('[data-guest-checkout]').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedPlan = {
      id: btn.dataset.planId || 'standard',
      name: btn.dataset.planName || 'ezForme B2B 구독',
      amount: Number(btn.dataset.planAmount || 39000)
    };
    const nameEl = document.getElementById('checkoutPlanName');
    const priceEl = document.getElementById('checkoutPlanPrice');
    if (nameEl) nameEl.textContent = selectedPlan.name;
    if (priceEl) priceEl.textContent = `${selectedPlan.amount.toLocaleString('ko-KR')}원`;
    guestCheckoutDialog?.showModal();
    mountB2BPaymentWidget(selectedPlan.amount);
  });
});

guestCheckoutForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const statusEl = document.getElementById('guestCheckoutStatus');
  const submitBtn = document.getElementById('btnGuestPaySubmit');
  const customerName = document.getElementById('checkoutCustomerName')?.value.trim() || '비회원 고객';
  const customerPhone = document.getElementById('checkoutCustomerPhone')?.value.trim() || '';
  const customerEmail = document.getElementById('checkoutCustomerEmail')?.value.trim() || '';

  if (!b2bWidgets) {
    if (statusEl) statusEl.textContent = '결제 수단을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.';
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (statusEl) statusEl.textContent = '결제창을 호출하는 중입니다...';

  try {
    const orderId = `EZF_B2B_${selectedPlan.id.toUpperCase()}_${Date.now().toString(36)}`;
    const origin = window.location.origin;

    await b2bWidgets.requestPayment({
      orderId,
      orderName: selectedPlan.name,
      customerName,
      customerEmail: customerEmail || undefined,
      customerMobilePhone: customerPhone.replace(/[^0-9]/g, '') || undefined,
      successUrl: `${origin}/mobile?mode=guest&b2bPaid=1`,
      failUrl: `${origin}/payment/fail`
    });
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = err?.code === 'USER_CANCEL'
        ? '결제가 취소되었습니다. 언제든 다시 결제하실 수 있습니다.'
        : (err?.message || '결제창 호출 중 오류가 발생했습니다.');
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
