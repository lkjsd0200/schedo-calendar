// ===== 탭 전환 =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.card').forEach(c => c.classList.add('hidden'));
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

// URL에 roomId가 있으면 방 코드 자동 입력
const urlParams = new URLSearchParams(location.search);
const roomIdFromUrl = urlParams.get('room');
if (roomIdFromUrl) {
  document.getElementById('join-room-id').value = roomIdFromUrl;
  document.querySelector('[data-tab="join"]').click();
}

// ===== 구글 로그인 =====
let googleUserData = null;

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return {}; }
}

async function initGoogleLogin() {
  try {
    const res = await fetch('/api/config');
    const { googleClientId } = await res.json();
    if (!googleClientId) return;

    // GIS가 로드될 때까지 대기
    const waitForGoogle = (resolve) => {
      if (typeof google !== 'undefined' && google.accounts) resolve();
      else setTimeout(() => waitForGoogle(resolve), 200);
    };
    await new Promise(waitForGoogle);

    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    document.getElementById('google-login-section').classList.remove('hidden');
    google.accounts.id.renderButton(
      document.getElementById('google-btn-container'),
      { theme: 'outline', size: 'large', width: 360, text: 'signin_with', locale: 'ko', shape: 'rectangular' }
    );
  } catch (e) {
    // 구글 로그인 미설정 시 조용히 무시
  }
}

function handleGoogleCredential(response) {
  const payload = parseJwt(response.credential);
  if (!payload.sub) return;

  googleUserData = payload;
  const nameInput = document.getElementById('join-name');
  nameInput.value = payload.name || '';
  nameInput.readOnly = true;

  // 구글 계정 카드 표시
  document.getElementById('google-login-section').classList.add('hidden');
  const card = document.getElementById('google-user-card');
  card.classList.remove('hidden');
  document.getElementById('google-user-avatar').src = payload.picture || '';
  document.getElementById('google-user-name').textContent = payload.name || '';
  document.getElementById('google-user-email').textContent = payload.email || '';

  // 이메일 해시로 색상 결정
  const colors = ['#4A90D9','#E25B5B','#50C878','#F5A623','#9B59B6','#1ABC9C','#E67E22','#2ECC71','#3498DB','#E91E63'];
  const hash = [...(payload.email || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  document.getElementById('join-color').value = colors[Math.abs(hash) % colors.length];
}

document.getElementById('btn-google-logout').addEventListener('click', () => {
  googleUserData = null;
  const nameInput = document.getElementById('join-name');
  nameInput.value = '';
  nameInput.readOnly = false;
  document.getElementById('google-user-card').classList.add('hidden');
  document.getElementById('google-login-section').classList.remove('hidden');
  if (typeof google !== 'undefined') {
    google.accounts.id.disableAutoSelect();
  }
});

initGoogleLogin();

// ===== 방 만들기 =====
document.getElementById('btn-create').addEventListener('click', createRoom);
document.getElementById('create-password').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
document.getElementById('create-name').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });

async function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  const password = document.getElementById('create-password').value;
  const errEl = document.getElementById('create-error');
  errEl.textContent = '';
  if (!name) { errEl.textContent = '캘린더 이름을 입력하세요.'; return; }
  if (!password) { errEl.textContent = '비밀번호를 입력하세요.'; return; }

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }

    document.getElementById('share-room-id').textContent = data.id;
    document.getElementById('share-box').classList.remove('hidden');
    document.getElementById('btn-go-join').onclick = () => {
      document.querySelector('[data-tab="join"]').click();
      document.getElementById('join-room-id').value = data.id;
    };
  } catch { errEl.textContent = '서버 오류가 발생했습니다.'; }
}

document.getElementById('btn-copy-code').addEventListener('click', () => {
  const code = document.getElementById('share-room-id').textContent;
  navigator.clipboard.writeText(code).then(() => alert('방 코드가 복사되었습니다!'));
});

// ===== 방 입장 =====
document.getElementById('btn-join').addEventListener('click', joinRoom);
['join-room-id', 'join-password', 'join-name'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
});

async function joinRoom() {
  const roomId = document.getElementById('join-room-id').value.trim();
  const password = document.getElementById('join-password').value;
  const name = document.getElementById('join-name').value.trim() || (googleUserData && googleUserData.name);
  const color = document.getElementById('join-color').value;
  const errEl = document.getElementById('join-error');
  errEl.textContent = '';

  if (!roomId) { errEl.textContent = '방 코드를 입력하세요.'; return; }
  if (!password) { errEl.textContent = '비밀번호를 입력하세요.'; return; }
  if (!name) { errEl.textContent = '이름을 입력하세요.'; return; }

  try {
    const res = await fetch(`/api/rooms/${roomId}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password,
        participantName: name,
        participantColor: color,
        googleId: googleUserData ? googleUserData.sub : null,
        googlePicture: googleUserData ? googleUserData.picture : null,
      })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }

    sessionStorage.setItem('calSession', JSON.stringify({
      roomId: data.room.id, roomName: data.room.name,
      participant: data.participant, events: data.events, participants: data.participants
    }));
    location.href = '/calendar.html';
  } catch { errEl.textContent = '서버 오류가 발생했습니다.'; }
}
