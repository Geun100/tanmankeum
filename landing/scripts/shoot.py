"""랜딩페이지용 실제 앱 화면 캡처. 프로덕션(tanmankeum.vercel.app)을 실제로 조작해서 찍는다 —
손으로 그린 목업이 아니라 진짜 앱이 진짜 DB를 읽어 렌더한 화면이다.

먼저 seed_demo_pods.py를 실행해 깨끗한 닉네임의 시연 팟 몇 개를 만들어두고 이 스크립트를 돌릴 것.
그래야 프로덕션에 쌓인 테스트 닉네임("속이기", "skjfdjkfhask" 등)이 목록 화면에 안 찍힌다.

실행: python3 seed_demo_pods.py && python3 shoot.py
필요 패키지: pip install playwright && playwright install chromium
UI가 바뀌면 이 스크립트를 다시 돌려서 landing/shots/*.png를 갱신할 것."""
import json, os, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "shots")
IDS = os.path.join(HERE, "demo_ids.json")
BASE = "https://tanmankeum.vercel.app/"
NICK = "동근"

demo = json.load(open(IDS))
demo_pod_ids = [d["pod"] for d in demo]

def shot(page, name):
    path = f"{OUT}/{name}.png"
    page.screenshot(path=path)
    print("saved", path)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 430, "height": 880}, device_scale_factor=3,
                        locale="ko-KR", timezone_id="Asia/Seoul")
    page = ctx.new_page()
    page.goto(BASE, wait_until="networkidle")
    page.evaluate("() => { try { localStorage.clear(); } catch(e){} }")
    page.reload(wait_until="networkidle")
    time.sleep(2.5)

    # 1. 닉네임 + 성별
    page.evaluate(f"""() => {{
      const el = document.getElementById('ob-nickname');
      el.value = {NICK!r}; el.dispatchEvent(new Event('input', {{bubbles:true}}));
      [...document.querySelectorAll('.choice')].find(b => b.dataset.gender === '남성').click();
    }}""")
    time.sleep(0.6)
    shot(page, "01-profile")

    # 2. 이동 정보 입력
    page.evaluate("() => document.getElementById('btn-ob-next').click()")
    time.sleep(0.8)
    page.evaluate("""() => {
      registerPlace('한동대학교', 36.1035947023864, 129.3888679123017);
      registerPlace('영일대해수욕장', 36.05506856439884, 129.37819251803654);
      document.getElementById('ob-origin').value = '한동대학교';
      document.getElementById('ob-dest').value = '영일대해수욕장';
      syncRegisterBtn();
    }""")
    time.sleep(0.5)
    shot(page, "02-route-input")

    # 3. 홈: 추천 팟 목록 (시연 팟만 남기고 렌더)
    page.evaluate("() => document.getElementById('btn-find-pod').click()")
    time.sleep(8)
    page.evaluate("""(ids) => {
      STATE.pods = STATE.pods.filter(p => ids.includes(p.id) || p.id === STATE.myPodId);
      renderPodList();
    }""", demo_pod_ids)
    time.sleep(4)
    shot(page, "03-home-list")

    # 4. 팟 상세: 지도 + 하차 지점
    page.evaluate("() => document.querySelector('#pod-list .pod-card').click()")
    time.sleep(8)
    shot(page, "04-pod-detail")

    # 5. 채팅방: 실제로 참가해서 2명인 상태로 찍는다
    page.evaluate("""() => {
      const btn = document.getElementById('btn-join-pod');
      if (btn) btn.click();
    }""")
    time.sleep(2)
    page.evaluate("() => { const c = document.getElementById('modal-confirm'); if (c) c.click(); }")
    time.sleep(7)
    page.evaluate("""async () => {
      await renderPodChat(STATE.myPodId);
      showScreen('screen-pod-chat');
    }""")
    time.sleep(4)
    shot(page, "05-chat")

    print("done. 참가/시연 계정은 supabase에서 직접 지울 것 (profiles/pods).")
    b.close()
