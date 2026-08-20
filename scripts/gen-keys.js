// Vercel 빌드 시 환경변수로 *.local.js를 생성한다. 로컬 개발에서는 안 씀(파일이 이미 있으니까) —
// 파일이 이미 있으면 덮어쓰지 않는다. Vercel 빌드 컨테이너에는 이 파일들이 git에 없어서(비밀키라
// .gitignore) 매번 새로 받는 클론이라, 여기서 환경변수로부터 만들어줘야 한다.
const fs = require('fs');
const path = require('path');

function writeIfMissing(file, content) {
  const p = path.join(__dirname, '..', file);
  if (fs.existsSync(p)) { console.log(`skip ${file} (already exists)`); return; }
  fs.writeFileSync(p, content);
  console.log(`wrote ${file}`);
}

const { KAKAO_REST_API_KEY, KAKAO_JS_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (KAKAO_REST_API_KEY && KAKAO_JS_KEY) {
  writeIfMissing('kakao-keys.local.js', `window.KAKAO_KEYS = {\n  restApiKey: '${KAKAO_REST_API_KEY}',\n  jsKey: '${KAKAO_JS_KEY}',\n};\n`);
} else {
  console.warn('KAKAO_REST_API_KEY/KAKAO_JS_KEY 환경변수 없음 — kakao-keys.local.js 생성 건너뜀');
}

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  writeIfMissing('supabase-keys.local.js', `window.SUPABASE_KEYS = {\n  url: '${SUPABASE_URL}',\n  anonKey: '${SUPABASE_ANON_KEY}',\n};\n`);
} else {
  console.warn('SUPABASE_URL/SUPABASE_ANON_KEY 환경변수 없음 — supabase-keys.local.js 생성 건너뜀');
}
