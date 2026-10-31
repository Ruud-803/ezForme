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
  document.getElementById('partnerStatus').textContent = '입력 형식을 확인했습니다. 현재 접수 API가 연결되지 않아 신청은 접수되지 않았습니다. 입력 내용은 저장·전송되지 않았습니다.';
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
    document.getElementById('signupStatus').textContent = '입력 형식을 확인했습니다. 가입 API 연결 전이므로 계정은 생성되지 않았으며 단말기 신청도 접수되지 않았습니다. 비밀번호·계좌 정보 등 입력 내용은 저장·전송되지 않았습니다.';
  });
}
