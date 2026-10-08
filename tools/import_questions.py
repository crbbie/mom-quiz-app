"""Developer-side converter: Vietnamese bulk text -> question-set JSON.

Reads the familiar paste format (accents optional everywhere):

    Cau 1: ...            ("Câu 1:", "1." / "1)" accepted)
    A. ...
    B. ...
    C. ...
    D. ...                (letters define identity; input order need not be A-B-C-D)
    Dap an: A             ("Đáp án:", "Đáp án đúng:", "Dap an dung:", "Answer:" accepted)
    Giai thich: ...       ("Giải thích:", "Lời giải:", "Explanation:" accepted; optional)

Multiline rule (deterministic): a non-empty line that matches no label is a
continuation of the current field — appended with a single space to:
  1. the question text (no options parsed yet), else
  2. the most recently parsed option (answer not seen yet), else
  3. the explanation (answer already seen; starts it when absent).

Usage:
  # New file (fresh IDs <slug>-001 ...):
  python tools/import_questions.py --slug luat-dat-dai --title "Luat Dat dai" input.txt -o data/luat-dat-dai.json

  # Update existing file (KEEPS ids for unchanged questions, new ids only for new ones):
  python tools/import_questions.py --slug luat-dat-dai --update data/luat-dat-dai.json input.txt -o /tmp/review.json

 Output JSON is for REVIEW: inspect it, run validate_questions.py after
 installing it into data/, then bump versions in catalog + file.
"""
import argparse
import datetime
import json
import re
import sys
import unicodedata

# Letter identity first: options map by A/B/C/D, then emit in A-B-C-D order.
OPT_RE = re.compile(r"^([A-Da-d])\s*[.:)]\s*(.+)$")
# Accent-tolerant heads/labels (match the real Vietnamese wording, not only
# the unaccented ASCII form). Content after the label is preserved verbatim.
QHEAD_RE = re.compile(r"^(c[aâ]u\s*\d+|\d+)\s*[:.)]\s*(.*)$", re.IGNORECASE)
ANS_RE = re.compile(r"^([dđ][aá]p\s*[aá]n(?:\s*[dđ][uú]ng)?|answer)\s*[:.]\s*([A-Da-d])\b",
                    re.IGNORECASE)
EXP_RE = re.compile(r"^(gi[aả]i\s*th[ií]ch|l[ờo]i\s*gi[aả]i|explanation)\s*[:.]\s*(.+)$",
                    re.IGNORECASE | re.DOTALL)


def norm(t):
    t = unicodedata.normalize("NFC", (t or "").strip().lower())
    return re.sub(r"\s+", " ", t)


def looks_like_answer(line):
    n = unicodedata.normalize("NFD", line.lower())
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = n.replace("đ", "d")
    return "dap an" in n or n.startswith("answer")


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
        opts, correct, seen_ans = {}, -1, False
        seen_exp, explanation = False, ""
        last_opt = None
        dup_letters, bad_answer = [], False
        for l in lines[qidx + 1:]:
            m = OPT_RE.match(l)
            if m and not seen_ans and not seen_exp:
                letter = m.group(1).upper()
                if letter in opts:
                    dup_letters.append(letter)
                else:
                    opts[letter] = m.group(2).strip()
                    last_opt = letter
                continue
            m = ANS_RE.match(l)
            if m:
                correct, seen_ans = ord(m.group(2).upper()) - 65, True
                continue
            m = EXP_RE.match(l)
            if m:
                explanation = (explanation + " " + m.group(2).strip()).strip() if seen_exp \
                    else m.group(2).strip()
                seen_exp = True
                continue
            if looks_like_answer(l):
                bad_answer = True
                continue
            # Deterministic continuation (never silently truncated):
            if not opts:
                qline = (qline + " " + l).strip()
            elif not seen_ans:
                opts[last_opt] = (opts[last_opt] + " " + l).strip()
            else:
                explanation = (explanation + " " + l).strip() if explanation else l
                seen_exp = True
        problems = []
        if not qline:
            problems.append("thieu noi dung cau hoi")
        if dup_letters:
            problems.append("trung dap an: %s" % ",".join(sorted(set(dup_letters))))
        missing = [c for c in "ABCD" if c not in opts]
        if missing:
            problems.append("thieu dap an %s (chi nhan dien %d/4: %s)"
                            % ("/".join(missing), len(opts),
                               ",".join(sorted(opts)) or "khong co"))
        if bad_answer or not seen_ans:
            problems.append('dong dap an khong hop le hoac thieu ("Dap an/Đáp án: A/B/C/D")')
        if problems:
            malformed.append({"block": bi, "reason": "; ".join(problems),
                              "preview": block.strip()[:140]})
        else:
            questions.append({"question": qline,
                              "options": [opts[c] for c in "ABCD"],
                              "correct": correct, "explanation": explanation})
    return questions, malformed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="text file with questions")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--title", default="")
    ap.add_argument("--description", default="",
                    help="set description (kept from old file in --update when omitted)")
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
    old_rec_by_text = {}
    old_doc = None
    if a.update:
        with open(a.update, encoding="utf-8") as f:
            old_doc = json.load(f)
        for q in old_doc.get("questions", []):
            old_by_text[norm(q.get("question"))] = q["id"]
            old_rec_by_text[norm(q.get("question"))] = q
        print("matched existing ids: %d" % sum(
            1 for p in parsed if norm(p["question"]) in old_by_text), file=sys.stderr)
        # Ambiguous possible matches (same text, different options/answer):
        # report, do NOT silently overwrite — reviewer decides (update type C).
        for i, p in enumerate(parsed, start=1):
            old = old_rec_by_text.get(norm(p["question"]))
            if old is None:
                continue
            if list(old.get("options", [])) != p["options"] or old.get("correct") != p["correct"]:
                print("  ! AMBIGUOUS parsed #%d: same text as id %s but options/answer differ "
                      "(possible update type C) — kept old id, REVIEW content manually."
                      % (i, old.get("id")), file=sys.stderr)

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

    today = datetime.date.today().isoformat()
    if old_doc:
        title = a.title or old_doc.get("title") or a.slug
        desc = a.description if a.description else old_doc.get("description", "")
        version = old_doc.get("version", 0) + 1
    else:
        title = a.title or a.slug
        desc = a.description
        version = 1
    doc = {"id": a.slug, "title": title, "description": desc,
           "version": version, "updated_at": today, "questions": out_qs}
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
