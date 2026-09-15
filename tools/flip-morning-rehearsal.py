# Walks Andjroo's first-payout path on a COPY of the live mainnet database, on a spare port,
# under HATCH_CUSTODY=parent. Nothing here touches the live instance or the live DB, and the
# only thing it stops short of is the signature itself, which is the whole point: the Nimiq
# Hub cannot open in headless Chromium, so a human has to do that part.
#
# What it proves: correcting the family wallet writes through, an approval on a flipped
# mainnet instance answers 202 with a signing intent instead of paying, and every field the
# parent's wallet will be handed is the field the server pinned.
import json, sys, urllib.request, urllib.error

BASE = "http://127.0.0.1:3981"
TOKEN = sys.argv[1]
MY_WALLET = "NQ88 XCBE BYC4 RHDY TTDJ AP14 9H4P MDF6 N7FG"  # stands in for Andjroo's own


def api(path, body=None, method="POST"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    req.add_header("Authorization", "Bearer " + TOKEN)
    try:
        r = urllib.request.urlopen(req)
        return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


ov = api("/api/parent/overview", method="GET")[1]
kid = ov["children"][0]
print("STEP 0  family wallet is", ov["parentAddress"])

print("STEP 1  point it at the parent's own wallet")
s, d = api("/api/family/address", {"address": MY_WALLET}, "PATCH")
print("        PATCH /api/family/address ->", s, d)
assert s == 200, d

print("STEP 2  create a chore worth 3 NIM")
s, d = api("/api/chores", {"childId": kid["id"], "title": "Tidy your room", "rewardLuna": 300000})
print("        POST /api/chores ->", s)
assert s in (200, 201), d
chore = d.get("chore", d)

print("STEP 3  the kid hands it in")
s, d = api(f"/api/chores/{chore['id']}/submit", {})
print("        POST /api/chores/:id/submit ->", s)
assert s in (200, 201), d

ov = api("/api/parent/overview", method="GET")[1]
print("STEP 4  parent queue now holds", len(ov["pending"]), "card(s)")
assert ov["pending"], "nothing queued"
appr = ov["pending"][0]

print("STEP 5  approve it")
s, d = api(f"/api/approvals/{appr['id']}/approve", {})
print("        POST /api/approvals/:id/approve ->", s)
if s != 202:
    print("        BODY:", json.dumps(d)[:800])
assert s == 202, "expected 202 accepted-not-done"

intent = d["signingIntent"]
print("        approval status stays:", d["approval"]["status"])
print("        intent.sender             :", intent["sender"])
print("        intent.recipient          :", intent.get("recipient"))
print("        intent.valueLuna          :", intent.get("valueLuna"))
print("        intent.data               :", intent.get("data"))
print("        intent.validityStartHeight:", intent.get("validityStartHeight"))

assert intent["sender"].replace(" ", "") == MY_WALLET.replace(" ", ""), intent["sender"]
assert intent.get("recipient", "").replace(" ", "") == kid["address"].replace(" ", "")
assert d["approval"]["status"] == "pending", "the approval must stay pending until money moves"

print("STEP 6  tap it again, and get the SAME bytes back rather than a second popup")
# 409 `already_claimed`, WITH the intent in the body. The status is the interesting part: it
# is the payout CLAIM refusing to be minted twice, not the approval row refusing to be
# decided twice, and that distinction is the whole resume mechanism. What has to hold is
# that the bytes are identical, because a second popup for one chore is a second signable
# transaction for one chore.
s2, d2 = api(f"/api/approvals/{appr['id']}/approve", {})
print("        second approve ->", s2, d2.get("error"))
assert s2 == 409 and d2.get("error") == "already_claimed", d2
again = d2["signingIntent"]
for field in ("sender", "recipient", "valueLuna", "data", "validityStartHeight", "nettedLuna"):
    assert again[field] == intent[field], f"{field} changed on the second tap"
print("        identical bytes on every pinned field")

print("\nPASS. The only step left is the signature itself, which needs a real wallet.")
