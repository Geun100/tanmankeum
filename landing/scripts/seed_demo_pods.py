"""랜딩 스크린샷용 시연 팟을 실제 DB(프로덕션)에 잠깐 만든다. shoot.py로 찍고 나면
demo_ids.json에 적힌 pod/user id를 Supabase에서 직접 지울 것(pods 삭제 시 FK cascade로
참가자까지 같이 지워진다). 가짜 화면을 그리는 게 아니라, 실제 앱이 실제 DB를 읽어 그린
화면을 찍기 위한 것이다.

실행: python3 seed_demo_pods.py"""
import json, os, urllib.request, urllib.error, uuid, datetime, sys

HERE = os.path.dirname(os.path.abspath(__file__))

BASE = "https://coibqtzhvceoqjdjovgd.supabase.co/rest/v1"
KEY = "sb_publishable_O2KlZcSNkiQlzWX5wIRiYg_IMNZUKAC"
HAN = (36.1035947023864, 129.3888679123017)
YEONGIL = (36.05506856439884, 129.37819251803654)
HWANHO = (36.066006868098675, 129.39333111942932)

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "apikey": KEY, "Authorization": "Bearer " + KEY,
        "Content-Type": "application/json", "Prefer": "return=representation",
    })
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        print("ERR", method, path, e.code, e.read().decode()[:300], file=sys.stderr)
        raise

today = datetime.date.today().isoformat()

# (닉네임, 성별, 출발시각, 정원, 목적지)
DEMO = [
    ("밤바다산책", "남성", "19:20", 3, ("영일대해수욕장", YEONGIL)),
    ("기숙사복귀", "남성", "19:40", 4, ("환호공원", HWANHO)),
    ("과제하러", "남성", "20:10", 2, ("영일대해수욕장", YEONGIL)),
]

made = []
for nick, gender, t, size, (dest, dc) in DEMO:
    uid = str(uuid.uuid4())
    req("POST", "/profiles", {"id": uid, "nickname": nick, "gender": gender})
    pod = req("POST", "/pods", {
        "leader_id": uid, "origin_name": "한동대학교",
        "origin_lat": HAN[0], "origin_lng": HAN[1],
        "leader_dest": dest, "leader_dest_lat": dc[0], "leader_dest_lng": dc[1],
        "depart_date": today, "depart_time": t, "desired_size": size, "status": "open",
    })[0]
    # 팟장 참가자 행은 pods_add_leader 트리거가 자동으로 넣는다 — 여기서 또 넣으면 unique 충돌.
    made.append({"pod": pod["id"], "user": uid, "nick": nick})
    print("made", nick, pod["id"])

with open(os.path.join(HERE, "demo_ids.json"), "w") as f:
    json.dump(made, f)
print("saved ids")
