# 🖨️ ezForme 현장 테스트 퀵 가이드 (출발 전 준비 + 현장 6단계)

- **작성일자**: 2026년 11월 22일
- **대상 장비**: 라즈베리파이 4B (`hostname: ezforme`, `user: igrid`, 서버 포트: `3456`)

---

## 📦 출발 전 집에서 끝낼 일

1. **라즈베리파이 코드 최신화**
   * 맥북 새 터미널 창에서 실행:
     ```bash
     rsync -avz --exclude node_modules --exclude .git --exclude .env --exclude uploads /Users/macbook/Desktop/igrid/ezforme/ igrid@192.168.45.195:~/ezforme/
     ```
   * 라즈베리파이 SSH 터미널(`ssh igrid@192.168.45.195`)에서 실행:
     ```bash
     cd ~/ezforme && npm install && sudo reboot
     ```

2. **Cloudflare Tunnel 고정 주소 세팅 (1~2주 무인 운영 추천)**
   * 손님이 매장 Wi-Fi에 연결하지 않고 **5G/LTE 상태에서도 QR을 찍어 인쇄**할 수 있으며, 공유기 재부팅으로 IP가 바뀌어도 QR이 유지됩니다.
   * 라즈베리파이 SSH(`ssh igrid@192.168.45.195`)에서 아래 순서대로 실행:
     ```bash
     # 1) cloudflared 설치 (Raspberry Pi 64-bit)
     curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
     sudo dpkg -i cloudflared.deb && rm cloudflared.deb

     # 2) Cloudflare 로그인 (출력되는 URL을 맥북 브라우저에서 열어 승인)
     cloudflared tunnel login

     # 3) 터널 생성 및 도메인 연결 (예: store1.ezforme.kr)
     cloudflared tunnel create ezforme-store1
     cloudflared tunnel route dns ezforme-store1 store1.ezforme.kr
     ```
   * `/etc/cloudflared/config.yml` 작성 (`<TUNNEL_ID>`는 위 3번에서 나온 UUID로 입력):
     ```bash
     sudo mkdir -p /etc/cloudflared
     sudo tee /etc/cloudflared/config.yml > /dev/null << 'EOF'
     tunnel: <TUNNEL_ID>
     credentials-file: /home/igrid/.cloudflared/<TUNNEL_ID>.json
     ingress:
       - hostname: store1.ezforme.kr
         service: http://localhost:3456
       - service: http_status:404
     EOF
     sudo cloudflared service install
     sudo systemctl enable --now cloudflared
     ```
   * 완료 후 집에서 미리 **`https://store1.ezforme.kr/api/qr?url=https://store1.ezforme.kr/mobile`**로 고정 QR을 생성·인쇄해 가면 현장에서 QR을 새로 만들 필요가 없습니다.

3. **메모장에 아래 3줄 복사해 가기** *(현장에서 `<IP>` 부분만 실제 IP로 바꿔 사용)*
   * SSH 접속: `ssh igrid@<IP>`
   * 프린터 등록(CUPS): `http://<IP>:631`
   * (터널링 미사용 시) 현장 QR 생성: `http://<IP>:3456/api/qr?url=http://<IP>:3456/mobile`

---

## 🏪 현장 도착 후 출력 완성까지 전체 프로세스 (총 6단계)

### 1단계. 선 연결 및 부팅 (1분)
1. 업장 프린터 전원을 켭니다.
2. 업장 프린터 뒷면 **USB 케이블**을 라즈베리파이 4B에 꽂습니다.
3. 대표님 **스마트폰 개인용 핫스팟**을 켠 상태에서 라즈베리파이 전원을 꽂고 1분 기다립니다.

### 2단계. 라즈베리파이 접속 및 업장 Wi-Fi 연결 (2분)
1. 맥북도 대표님 **스마트폰 핫스팟**에 연결합니다.
2. 맥북 터미널에서 `arp -a`를 실행해 라즈베리파이 IP를 확인합니다. (보통 `172.20.10.x` 대역)
3. 맥북 터미널에서 접속:
   ```bash
   ssh igrid@<IP>
   ```
4. **업장 Wi-Fi 연결 (1~2주 상주 운영 시 필수)**:
   ```bash
   sudo nmcli dev wifi connect "업장WiFi이름" password "비밀번호"
   hostname -I
   ```
   *(업장 Wi-Fi로 전환되면 대표님 맥북도 업장 Wi-Fi로 옮긴 뒤, 새로 확인된 `<업장_IP>`로 다시 `ssh igrid@<업장_IP>` 접속합니다.)*

### 3단계. 업장 프린터 등록 (2분)
1. 맥북 브라우저에서 **`http://<IP>:631`** (CUPS 관리자)에 접속합니다.
2. `[Administration]` → `[Add Printer]`를 클릭합니다. (로그인 요구 시 `igrid` / 라즈베리파이 비밀번호 입력)
3. USB로 연결된 업장 프린터를 선택해 추가하고, **`Set As Server Default` (기본 프린터 지정)**를 클릭합니다.
4. SSH 터미널에서 정상 등록 여부를 확인합니다:
   ```bash
   lpstat -p -d
   ```
   * `idle` 상태 및 `system default destination`에 업장 프린터 이름이 뜨면 완료입니다.
   * 브라우저에서 `http://<IP>:3456/api/system/printers`를 열었을 때 `"mode":"PHYSICAL_READY"`가 나오는지 확인합니다.

### 4단계. 현장용 QR코드 띄우기 (30초)
1. 맥북 브라우저에서 아래 주소를 엽니다:
   ```text
   http://<IP>:3456/api/qr?url=http://<IP>:3456/mobile
   ```
2. 화면에 뜬 QR코드를 프린터로 1장 출력해 두거나, 맥북/태블릿 화면에 띄워둡니다.

### 5단계. 스마트폰으로 실제 출력 테스트 (1분)
1. 테스트할 스마트폰을 라즈베리파이와 같은 네트워크(핫스팟 또는 업장 Wi-Fi)에 연결합니다.
2. 스마트폰 기본 카메라로 방금 만든 QR코드를 스캔합니다.
3. 모바일 인쇄 페이지(`.../mobile`)가 열리면 **PDF/사진 업로드** → 옵션(흑백/컬러, 부수) 선택 → **[인쇄 및 결제하기]** → 테스트 결제 진행 → **[지금 인쇄]**를 터치합니다.

### 6단계. 출력 완료 확인
* 업장 프린터에서 종이가 정상 배출되면 현장 테스트 1차 검증 완료입니다.
