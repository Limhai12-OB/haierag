"""End-to-end verification of the HaieRag vertical slice through the public backend API.

register → login → workspace → collection → upload PDF → wait for ingestion → inspect chunks → ask questions
(SSE) → verify answers + citations → open cited source → absent-answer question → cross-user isolation.

Run (backend, AI service, infra and Ollama running):
    PYTHONPATH=ai-service ai-service/.venv/bin/python scripts/e2e_verify.py [--base http://localhost:8080]
Exit code 0 only if every check passes.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid

import httpx

sys.path.insert(0, "ai-service")
from tests.fixtures.samples import HANDBOOK_FACTS, make_handbook_pdf  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}", flush=True)
    return ok


def sse_events(resp: httpx.Response):
    event, data = "message", []
    for line in resp.iter_lines():
        if line == "":
            if data:
                yield event, json.loads("\n".join(data))
            event, data = "message", []
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
    if data:
        yield event, json.loads("\n".join(data))


def ask(client: httpx.Client, conv_id: str, question: str) -> dict:
    events: dict[str, list] = {}
    t = time.perf_counter()
    first_token = None
    with client.stream("POST", f"/conversations/{conv_id}/messages", json={"content": question}, timeout=300) as r:
        if r.status_code != 200:
            return {"status": r.status_code, "body": r.read().decode()[:500]}
        for ev, data in sse_events(r):
            if ev == "token" and first_token is None:
                first_token = time.perf_counter() - t
            events.setdefault(ev, []).append(data)
    return {"status": 200, "events": events, "seconds": time.perf_counter() - t, "first_token_s": first_token}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    args = ap.parse_args()
    api = f"{args.base}/api/v1"
    c = httpx.Client(base_url=api, timeout=60)

    # 1. register + login
    email, pw = f"e2e-{uuid.uuid4().hex[:8]}@example.com", "Sup3r-secret-pass"
    r = c.post("/auth/register", json={"email": email, "password": pw, "displayName": "E2E User"})
    check("register", r.status_code == 201, str(r.status_code))
    r = c.post("/auth/login", json={"email": email, "password": pw})
    if not check("login returns access token + refresh cookie", r.status_code == 200 and "accessToken" in r.json()
                 and "haierag_refresh" in r.cookies, str(r.status_code)):
        return 1
    c.headers["Authorization"] = f"Bearer {r.json()['accessToken']}"
    r = c.post("/auth/refresh")
    check("refresh rotates token", r.status_code == 200 and "accessToken" in r.json(), str(r.status_code))
    if r.status_code == 200:
        c.headers["Authorization"] = f"Bearer {r.json()['accessToken']}"

    # 2-3. workspace + collection
    ws = c.post("/workspaces", json={"name": "E2E Workspace"}).json()
    check("create workspace", ws.get("role") == "OWNER", json.dumps(ws)[:200])
    col = c.post(f"/workspaces/{ws['id']}/collections", json={"name": "Policies"}).json()
    check("create collection", "id" in col, json.dumps(col)[:200])

    # 4. upload PDF
    pdf = make_handbook_pdf()
    r = c.post(f"/workspaces/{ws['id']}/documents", files={"file": ("northwind-handbook.pdf", pdf, "application/pdf")},
               data={"collectionId": col["id"]})
    doc = r.json()
    check("upload PDF accepted", r.status_code == 202 and doc.get("status") in ("QUEUED", "PROCESSING", "COMPLETED"),
          f"{r.status_code} {json.dumps(doc)[:200]}")
    r = c.post(f"/workspaces/{ws['id']}/documents", files={"file": ("evil.pdf", b"MZ\x90\x00 not a pdf", "application/pdf")})
    check("upload with wrong magic bytes rejected", r.status_code == 415, str(r.status_code))

    # 5. wait for ingestion
    t0, status = time.time(), None
    while time.time() - t0 < 240:
        st = c.get(f"/documents/{doc['id']}/status").json()
        status = st.get("status")
        if status in ("COMPLETED", "FAILED"):
            break
        time.sleep(1)
    check("ingestion completed", status == "COMPLETED", f"{status} after {time.time() - t0:.1f}s; {st.get('errorMessage')}")

    # 6. chunks
    page = c.get(f"/documents/{doc['id']}/chunks", params={"page": 0, "size": 50}).json()
    chunks = page.get("content", [])
    check("chunks extracted with page numbers", bool(chunks) and all(ch.get("pageStart") for ch in chunks),
          f"{len(chunks)} chunks, pages {sorted({ch.get('pageStart') for ch in chunks})}")
    chunk_by_id = {ch["id"]: ch for ch in chunks}

    # 7-10. chat
    conv = c.post("/conversations", json={"workspaceId": ws["id"], "scopeType": "COLLECTION", "collectionId": col["id"]}).json()
    check("create conversation (collection scope)", "id" in conv, json.dumps(conv)[:200])
    for question, phrase, expected_page in HANDBOOK_FACTS:
        res = ask(c, conv["id"], question)
        if not check(f"chat stream: {question}", res["status"] == 200 and "done" in res.get("events", {}),
                     f"status {res['status']} {res.get('body', '')} events={list(res.get('events', {}))}"):
            continue
        msg = res["events"]["done"][0]["message"]
        cits = msg.get("citations", [])
        check(f"  answer contains '{phrase}'", phrase in msg["content"], msg["content"][:200].replace("\n", " "))
        valid = bool(cits) and all(f"[{x['marker']}]" in msg["content"] and x["chunkId"] in chunk_by_id for x in cits)
        check("  citations are valid chunks of the uploaded document", valid,
              ", ".join(f"[{x['marker']}] p{x['pageNumber']}" for x in cits))
        check(f"  a citation points to page {expected_page}", any(x["pageNumber"] == expected_page for x in cits))
        print(f"        ({res['seconds']:.1f}s total, first token {res['first_token_s'] or 0:.1f}s)")

    res = ask(c, conv["id"], "What was the company's revenue in 2023?")
    if res["status"] == 200 and "done" in res["events"]:
        msg = res["events"]["done"][0]["message"]
        check("absent answer is declined", "not contain" in msg["content"].lower() or "no information" in msg["content"].lower()
              or "not provide" in msg["content"].lower() or "not mention" in msg["content"].lower(), msg["content"][:200])

    # 11. open cited source + conversation history
    detail = c.get(f"/conversations/{conv['id']}").json()
    msgs = detail.get("messages", [])
    check("conversation history persisted", len(msgs) == 2 * (len(HANDBOOK_FACTS) + 1), f"{len(msgs)} messages")
    first_cit = next((x for m in msgs for x in m.get("citations", [])), None)
    if first_cit:
        ch = chunk_by_id.get(first_cit["chunkId"])
        check("cited source opens and matches excerpt", ch is not None and first_cit["excerpt"][:60] in " ".join(ch["content"].split()))
    r = c.get(f"/documents/{doc['id']}/download")
    check("download original file", r.status_code == 200 and r.content == pdf, str(r.status_code))

    # isolation
    other = httpx.Client(base_url=api, timeout=30)
    e2 = f"e2e-other-{uuid.uuid4().hex[:8]}@example.com"
    other.post("/auth/register", json={"email": e2, "password": pw, "displayName": "Other"})
    tok = other.post("/auth/login", json={"email": e2, "password": pw}).json()["accessToken"]
    other.headers["Authorization"] = f"Bearer {tok}"
    check("other user cannot read document", other.get(f"/documents/{doc['id']}").status_code == 404)
    check("other user cannot read conversation", other.get(f"/conversations/{conv['id']}").status_code == 404)
    r = other.post("/conversations", json={"workspaceId": ws["id"]})
    check("other user cannot chat in workspace", r.status_code in (403, 404), str(r.status_code))

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
