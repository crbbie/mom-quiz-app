"""Developer-side converter: Vietnamese bulk text -> question-set JSON.

Reads the familiar paste format:

    Cau 1: ...            (also "1." / "1)" accepted)
    A. ...
    B. ...
    C. ...
    D. ...
    Dap an: A             ("Dap an dung:" / "Answer:" accepted)
    Giai thich: ...       (optional)

Usage:
  # New file (fresh IDs <slug>-001 ...):
  python tools/import_questions.py --slug luat-dat-dai --title "Luat Dat dai" input.txt -o data/luat-dat-dai.json

  # Update existing file (KEEPS ids for unchanged questions, new ids only for new ones):
  python tools/import_questions.py --slug luat-dat-dai --update data/luat-dat-dai.json input.txt -o /tmp/review.json

 Output JSON is for REVIEW: inspect it, run validate_questions.py after
 installing it into data/, then bump versions in catalog + file.
"""
import argparse
import json
import re
import sys
import unicodedata

OPT_RE = re.compile(r"^([A-Da-d])\s*[.:)]\s*(.+)$")
QHEAD_RE = re.compile(r"^(cau\s*\d+|\d+)\s*[:.)]\s*(.*)$", re.IGNORECASE)
ANS_RE = re.compile(r"^(dap\s*an|dap an dung|answer)\s*[:.]\s*([A-Da-d])", re.IGNORECASE)
EXP_RE = re.compile(r"^(giai\s*thich|explanation|loi giai)\s*[:.]\s*(.+)$", re.IGNORECASE | re.DOTALL)


def norm(t):
    t = unicodedata.normalize("NFC", (t or "").strip().lower())
    return re.sub(r"\s+", " ", t)


def parse_blocks(text):
    questions, malformed = [], []
    for bi, block in enumerate(re.split(r"\n\s*\n", text), start=1):
        lines = [l.strip() for l in block.strip().split("\n") if l.strip()]
        if not lines:
            continue
        qline, qidx = None, -1
        for i, l in enumerate(lines):
            m = QHEAD_RE.match(l)
            if m:
                qline, qidx = m.group(2).strip(), i
                break
        if qline is None:
            qline, qidx = lines[0], 0
        options, correct, seen_ans, explanation = [], -1, False, ""
        for l in lines[qidx + 1:]:
            m = OPT_RE.match(l)
            if m and len(options) < 4:
                options.append(m.group(2).strip())
                continue
            m = ANS_RE.match(l)
            if m:
                correct, seen_ans = ord(m.group(2).upper()) - 65, True
                continue
            m = EXP_RE.match(l)
            if m:
                explanation = m.group(2).strip()
                continue
        problems = []
        if not qline:
            problems.append("thieu noi dung cau hoi")
        if len(options) != 4:
            problems.append("chi nhan dien %d/4 dap an (can A-D)" % len(options))
        if not seen_ans:
            problems.append('thieu dong "Dap an: X"')
        if problems:
            malformed.append({"block": bi, "reason": "; ".join(problems),
                              "preview": block.strip()[:140]})
        else:
            questions.append({"question": qline, "options": options,
                              "correct": correct, "explanation": explanation})
    return questions, malformed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="text file with questions")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--title", default="")
    ap.add_argument("--update", default=None,
                    help="existing set JSON: match by text, keep old ids")
    ap.add_argument("-o", "--output", default="-")
    a = ap.parse_args()

    with open(a.input, encoding="utf-8") as f:
        text = f.read()
    parsed, malformed = parse_blocks(text)
    print("parsed valid: %d, malformed blocks: %d" % (len(parsed), len(malformed)),
          file=sys.stderr)
    for m in malformed:
        print("  ! block %d: %s | %s..." % (m["block"], m["reason"], m["preview"]),
              file=sys.stderr)

    old_by_text = {}
    old_doc = None
    if a.update:
        with open(a.update, encoding="utf-8") as f:
            old_doc = json.load(f)
        for q in old_doc.get("questions", []):
            old_by_text[norm(q.get("question"))] = q["id"]
        print("matched existing ids: %d" % sum(
            1 for p in parsed if norm(p["question"]) in old_by_text), file=sys.stderr)

    existing_ids = set(old_by_text.values()) if old_doc else set()
    counter = 0

    def fresh_id():
        nonlocal counter
        while True:
            counter += 1
            cand = "%s-%03d" % (a.slug, counter)
            if cand not in existing_ids:
                existing_ids.add(cand)
                return cand

    out_qs = []
    for p in parsed:
        key = norm(p["question"])
        qid = old_by_text.get(key)
        if qid is None:
            qid = fresh_id()  # NEW question -> new id
        out_qs.append({"id": qid, **p})

    doc = {"id": a.slug, "title": a.title or a.slug,
           "version": (old_doc.get("version", 0) + 1) if old_doc else 1,
           "updated_at": "2026-10-07", "questions": out_qs}
    out = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    if a.output == "-":
        sys.stdout.write(out)
    else:
        with open(a.output, "w", encoding="utf-8") as f:
            f.write(out)
        print("wrote %s (%d questions) - REVIEW before deploying" % (a.output, len(out_qs)),
              file=sys.stderr)


if __name__ == "__main__":
    main()
