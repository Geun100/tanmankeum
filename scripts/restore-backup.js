// backups/<날짜>-<테이블>.json을 Supabase에 다시 올린다(2026-10-03 베타 초기화 때 만든 백업 복원용).
// 사용: node scripts/restore-backup.js 2026-10-03
// 백업 JSON에는 개인정보가 있어 git에 안 올린다(backups/ 는 .gitignore). 키는 supabase-keys.local.js에서 읽는다.
// FK 순서대로 넣는다 — profiles가 먼저 있어야 pods/참가자/채팅이 들어간다. 이미 있는 id는 건너뛴다(중복 무시).
const fs = require('fs');
const path = require('path');

const date = process.argv[2];
if (!date) { console.error('사용법: node scripts/restore-backup.js <날짜 예: 2026-10-03>'); process.exit(1); }

const keysSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase-keys.local.js'), 'utf8');
const url = /url:\s*'([^']+)'/.exec(keysSrc)[1];
const key = /anonKey:\s*'([^']+)'/.exec(keysSrc)[1];

const TABLES = ['profiles', 'pods', 'pod_participants', 'pod_messages', 'push_subscriptions'];

(async () => {
  for (const t of TABLES) {
    const file = path.join(__dirname, '..', 'backups', `${date}-${t}.json`);
    if (!fs.existsSync(file)) { console.log(`skip ${t} (백업 없음)`); continue; }
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!rows.length) { console.log(`skip ${t} (0건)`); continue; }
    for (let i = 0; i < rows.length; i += 200) {
      const res = await fetch(`${url}/rest/v1/${t}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 200)),
      });
      if (!res.ok) { console.error(`${t} 실패 HTTP ${res.status}: ${await res.text()}`); process.exit(1); }
    }
    console.log(`${t}: ${rows.length}건 복원`);
  }
})();
