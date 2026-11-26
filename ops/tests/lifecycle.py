"""Exercise the real HTTP, SMTP sink and signed S3 paths of a disposable Compose project."""

import base64
import concurrent.futures
import hashlib
import http.cookiejar
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ORIGIN = os.environ["PUBLIC_ORIGIN"]
INBOX = "http://127.0.0.1:" + os.environ["INBOX_PORT"]
API = "/api/v1"
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="
)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class Client:
    def __init__(self):
        self.http = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect()
        )

    def request(self, path, method="GET", data=None, expect=(200, 201, 204)):
        headers = {"x-kiska": "1"}
        if isinstance(data, bytes):
            headers["Content-Type"] = "image/png"
        elif data is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(data).encode()
        url = urllib.parse.urljoin(ORIGIN, path)
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            response = self.http.open(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
            if response.status not in expect:
                raise AssertionError(
                    f"{method} {urllib.parse.urlsplit(path).path}: {response.status}, {body[:200]!r}"
                )
            return response.headers, body

    def api(self, path, method="GET", data=None):
        return json.loads(self.request(API + path, method, data)[1])


def wait_for_token():
    deadline = time.monotonic() + 70
    while time.monotonic() < deadline:
        messages = json.load(urllib.request.urlopen(INBOX + "/api/v1/messages"))[
            "messages"
        ]
        for msg in messages:
            if "verify" in msg["Subject"]:
                message = json.load(
                    urllib.request.urlopen(INBOX + "/api/v1/message/" + msg["ID"])
                )
                return re.search(r"token=([a-zA-Z0-9]+)", message["Text"])[1]
        time.sleep(0.5)
    raise AssertionError("Verification mail did not reach the development inbox")


def login():
    staff = Client()
    staff.api(
        "/auth/login",
        "POST",
        {"email": "organizer@example.test", "password": "test-password-123456"},
    )
    return staff


def assert_grant(client, image, digest):
    headers, _ = client.request(image, expect=(307,))
    assert "no-store" in headers["Cache-Control"]
    url = headers["Location"]
    assert url.startswith(ORIGIN + "/kiska-media/")
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    assert 0 < int(query["X-Amz-Expires"][0]) <= 300
    headers, payload = client.request(url)
    assert (
        "no-store" in headers["Cache-Control"]
        and hashlib.sha256(payload).hexdigest() == digest
    )
    client.request(url.partition("?")[0], expect=(403,))
    return url


def sql(statement):
    # The rehearsal starts its own disposable PostgreSQL service.
    return subprocess.check_output(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "db",
            "psql",
            "-U",
            "kiska",
            "-v",
            "ON_ERROR_STOP=1",
            "-Atq",
        ],
        input=statement,
        text=True,
    ).strip()


def quota_checks(staff, guest, org, board_api, public, size):
    # Leave room for exactly one processed image and contend for the same final bytes.
    sql(
        f"UPDATE orgs SET media_limit=(SELECT coalesce(sum(bytes),0) FROM media)+{size} WHERE id='{org}';"
    )

    def attempt(_):
        _, body = staff.request(
            API + board_api + "/media?kind=post", "POST", PNG, expect=(201, 400)
        )
        return json.loads(body)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))
    success = [r for r in results if "id" in r]
    failure = [r for r in results if "id" not in r]
    assert len(success) == len(failure) == 1 and "allowance" in failure[0]["message"]
    guest.api(public + "/posts", "POST", {"title": "Text-only at capacity", "body": ""})
    staff.request(success[0]["url"], "DELETE")
    sql(f"UPDATE orgs SET media_limit=262144000 WHERE id='{org}';")


def seed():
    anon, guest = Client(), Client()
    anon.api(
        "/auth/register",
        "POST",
        {
            "name": "Organizer",
            "email": "organizer@example.test",
            "password": "test-password-123456",
        },
    )
    anon.api("/auth/verify", "POST", {"token": wait_for_token()})
    staff = login()
    org = staff.api(
        "/organizations", "POST", {"name": "Recovery Guild", "slug": "recovery-guild"}
    )
    board = staff.api(
        "/organizations/" + org["id"] + "/boards",
        "POST",
        {"title": "Expeditions", "slug": "expeditions"},
    )
    board_api = "/boards/" + board["id"]
    staff.api(board_api + "/publish", "POST", {})
    board["settings"]["require_approval"] = True
    staff.api(board_api, "PUT", board)
    public = "/b/recovery-guild/expeditions"
    guest.api(public + "/guest", "PATCH", {"name": "Nila"})
    recovery = guest.api(public + "/guest/recovery", "POST", {})["token"]

    def pending(title):
        uploaded = guest.api(board_api + "/media?kind=post", "POST", PNG)
        path = uploaded["url"]
        headers, private = guest.request(path)
        assert "no-store" in headers["Cache-Control"] and private.startswith(b"RIFF")
        anon.request(path, expect=(404,))
        post = guest.api(
            public + "/posts",
            "POST",
            {"title": title, "body": "Restore drill.", "media_ids": [uploaded["id"]]},
        )
        anon.request(path, expect=(404,))
        _, private_after = guest.request(path)
        assert private_after == private
        return (
            post.get("post", post)["id"],
            path,
            hashlib.sha256(private).hexdigest(),
            uploaded["bytes"],
        )

    post_id, image, digest, size = pending("Published expedition")
    other_id, other_image, other_digest, other_size = pending("Private expedition")
    added = guest.api(board_api + "/media", "POST", PNG)
    original = other_image.rsplit("/", 1)[1]
    post_path = public + "/posts/" + other_id
    for ids in ([original, added["id"]], [added["id"], original], [original]):
        guest.api(
            post_path,
            "PATCH",
            {"title": "Private expedition", "body": "Restore drill.", "media_ids": ids},
        )
        detail = guest.api(post_path)
        assert [m["id"] for m in detail["post"]["media"]] == ids
    guest.request(added["url"], expect=(404,))
    staff.api(
        board_api + "/moderate", "POST", {"post_id": post_id, "action": "approve"}
    )
    url = assert_grant(anon, image, digest)
    staff.api(board_api + "/moderate", "POST", {"post_id": post_id, "action": "hide"})
    anon.request(image, expect=(404,))
    time.sleep(int(os.environ["S3_GRANT_SECONDS"]) + 1)
    anon.request(url, expect=(403,))
    staff.api(
        board_api + "/moderate", "POST", {"post_id": post_id, "action": "restore"}
    )
    assert_grant(anon, image, digest)
    quota_checks(staff, guest, org["id"], board_api, public, size)
    # An upload for a sibling board remains private to that board and uploader.
    sibling = staff.api(
        "/organizations/" + org["id"] + "/boards",
        "POST",
        {"title": "Sibling", "slug": "sibling"},
    )
    wrong = staff.api("/boards/" + sibling["id"] + "/media", "POST", PNG)
    staff.request(
        API + public + "/posts",
        "POST",
        {"title": "Cross-board claim", "media_ids": [wrong["id"]]},
        expect=(400,),
    )
    guest.request(
        API + post_path,
        "PATCH",
        {"title": "Invalid replacement", "media_ids": [wrong["id"]]},
        expect=(400,),
    )
    retained = guest.api(post_path)["post"]
    assert retained["title"] == "Private expedition" and [
        m["id"] for m in retained["media"]
    ] == [original]
    staff.request(wrong["url"], "DELETE")
    return {
        "org": org["id"],
        "board": board["id"],
        "public": public,
        "post": post_id,
        "image": image,
        "digest": digest,
        "pending": other_id,
        "private_image": other_image,
        "private_digest": other_digest,
        "usage": size + other_size,
        "recovery": recovery,
    }


def check(s):
    staff, anon, recovered = login(), Client(), Client()
    assert staff.api("/organizations/" + s["org"])["usage"]["media_bytes"] == s["usage"]
    _, html = anon.request(s["public"])
    assert b"Published expedition" in html and b"Private expedition" not in html
    _, workspace_html = staff.request("/app")
    for entry, page in (("public", html), ("workspace", workspace_html)):
        for suffix in ("css", "js"):
            asset = f"/assets/{entry}.{suffix}"
            assert asset.encode() in page
            headers, body = anon.request(asset)
            assert (
                body
                and ("javascript" if suffix == "js" else "text/css")
                in headers["Content-Type"]
            )
    assert_grant(anon, s["image"], s["digest"])
    anon.request(s["private_image"], expect=(404,))
    recovered.api(s["public"] + "/guest/recover", "POST", {"token": s["recovery"]})
    _, payload = recovered.request(s["private_image"])
    assert hashlib.sha256(payload).hexdigest() == s["private_digest"]
    # Rotate the recovery token to leave an unused one for the next restart/restore.
    s["recovery"] = recovered.api(s["public"] + "/guest/recovery", "POST", {})["token"]
    return s


def wait_until(check, timeout=35):
    deadline = time.monotonic() + timeout
    while not check():
        if time.monotonic() >= deadline:
            raise AssertionError("Timed out waiting for storage maintenance")
        time.sleep(0.3)


def fault_checks(s):
    staff = login()
    board = s["board"]
    path = f"/boards/{board}/media?kind=post"

    def compose(*args):
        subprocess.run(
            ["docker", "compose", *args], check=True, stdout=subprocess.DEVNULL
        )

    # Drain older tombstones so the fault targets this object deterministically.
    compose("restart", "worker")
    wait_until(lambda: sql("SELECT count(*) FROM media_deletions;") == "0")
    compose("stop", "worker")
    abandon = staff.api(path, "POST", PNG)
    key = sql(f"SELECT object_key FROM media WHERE id='{abandon['id']}';")
    sql(
        f"UPDATE media SET created_at=now()-interval '25 hours' WHERE id='{abandon['id']}';"
    )
    # An object deletion must survive an S3 outage and a worker restart.
    compose("stop", "storage")
    try:
        compose("up", "--no-deps", "-d", "worker")
        wait_until(
            lambda: (
                sql(
                    f"SELECT EXISTS(SELECT 1 FROM media_deletions WHERE object_key='{key}' AND next_attempt>now());"
                )
                == "t"
            )
        )
        staff.request(API + path, "POST", PNG, expect=(500,))
        assert (
            staff.api("/organizations/" + s["org"])["usage"]["media_bytes"]
            == s["usage"]
        )
    finally:
        compose("up", "--no-deps", "-d", "--wait", "storage")
    # Move the retry deadline forward in the isolated fixture, then restart at that deadline.
    sql("UPDATE media_deletions SET next_attempt=now();")
    compose("restart", "worker")
    wait_until(
        lambda: (
            sql(
                f"SELECT NOT EXISTS(SELECT 1 FROM media_deletions WHERE object_key='{key}');"
            )
            == "t"
        )
    )
    staff.request(abandon["url"], expect=(404,))
    remaining = subprocess.check_output(
        [
            "docker",
            "compose",
            "run",
            "--rm",
            "--no-deps",
            "ops",
            "sh",
            "-ceu",
            'aws --endpoint-url "$S3_ENDPOINT" s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$1" --max-keys 1 --query KeyCount --output text',
            "sh",
            key,
        ],
        text=True,
    )
    assert remaining.strip() == "0"
    retry = staff.api(path, "POST", PNG)
    staff.request(retry["url"], "DELETE")
    return s


if __name__ == "__main__":
    path = Path(sys.argv[2])
    state = (
        seed()
        if sys.argv[1] == "seed"
        else {"faults": fault_checks, "check": check}[sys.argv[1]](
            json.loads(path.read_text())
        )
    )
    path.write_text(json.dumps(state))
