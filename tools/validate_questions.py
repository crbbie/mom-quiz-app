"""Validate data/catalog.json + all referenced question-set files.

Mechanical/schema checks only: JSON syntax, catalog wiring, id/version
consistency, unique IDs, non-empty text, exactly 4 non-empty options,
correct index 0-3, required metadata. It does NOT fact-check course
content and never judges whether a legal answer is "currently correct" —
the original class/course material is authoritative (see AGENTS.md).

Usage:  python tools/validate_questions.py
Exit 0 = valid. Exit 1 = errors printed as FILE :: question :: problem.
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

errors = []


def err(where, msg):
    errors.append("%s :: %s" % (where, msg))


def check_date(where, label, value):
    if value in (None, ""):
        err(where, "missing '%s' (expected YYYY-MM-DD)" % label)
    elif not isinstance(value, str) or not DATE_RE.match(value):
        err(where, "'%s' must be YYYY-MM-DD, got %r" % (label, value))


def main():
    cat_path = os.path.join(DATA, "catalog.json")
    try:
        with open(cat_path, encoding="utf-8") as f:
            catalog = json.load(f)
    except FileNotFoundError:
        err("data/catalog.json", "file missing")
        return 1
    except json.JSONDecodeError as e:
        err("data/catalog.json", "malformed JSON: %s" % e)
        return 1

    if not isinstance(catalog.get("version"), int):
        err("data/catalog.json", "'version' must be an integer")
    check_date("data/catalog.json", "updated_at", catalog.get("updated_at"))
    sets = catalog.get("sets")
    if not isinstance(sets, list) or not sets:
        err("data/catalog.json", "'sets' must be a non-empty array")
        return 1

    seen_set_ids = set()
    seen_qids_global = {}  # qid -> file

    for i, s in enumerate(sets):
        where = "data/catalog.json sets[%d]" % i
        sid = s.get("id")
        if not sid or not isinstance(sid, str):
            err(where, "missing/empty 'id'")
            continue
        if sid in seen_set_ids:
            err(where, "duplicated set id '%s'" % sid)
        seen_set_ids.add(sid)
        for field in ("title", "file", "version"):
            if s.get(field) in (None, ""):
                err(where, "missing '%s' for set '%s'" % (field, sid))
        if "description" not in s:
            err(where, "set '%s': missing 'description' key (may be empty, must be present)" % sid)
        check_date(where, "updated_at for set '%s'" % sid, s.get("updated_at"))
        if not isinstance(s.get("version"), int):
            err(where, "set '%s': 'version' must be an integer" % sid)
            continue
        if not s.get("published", True):
            continue  # unpublished sets are skipped, file may still exist

        fpath = os.path.join(DATA, s["file"])
        if not os.path.isfile(fpath):
            err(where, "set '%s': referenced file '%s' not found" % (sid, s["file"]))
            continue
        try:
            with open(fpath, encoding="utf-8") as f:
                doc = json.load(f)
        except json.JSONDecodeError as e:
            err(s["file"], "malformed JSON: %s" % e)
            continue

        if doc.get("id") != sid:
            err(s["file"], "set id mismatch: file has '%s', catalog has '%s'"
                % (doc.get("id"), sid))
        if doc.get("version") != s.get("version"):
            err(s["file"], "version mismatch: file=%r catalog=%r (keep them in sync)"
                % (doc.get("version"), s.get("version")))
        for field in ("title", "description", "updated_at"):
            if doc.get(field) in (None,):
                err(s["file"], "set file missing '%s' (must be present)" % field)
        check_date(s["file"], "updated_at", doc.get("updated_at"))
        if not (doc.get("title") or "").strip():
            err(s["file"], "set file has empty 'title'")
        qs = doc.get("questions")
        if not isinstance(qs, list) or not qs:
            err(s["file"], "'questions' must be a non-empty array")
            continue

        seen_qids_file = set()
        for j, q in enumerate(qs):
            qw = "%s questions[%d]" % (s["file"], j)
            qid = q.get("id")
            if not qid or not isinstance(qid, str):
                err(qw, "missing/empty question 'id'")
                continue
            if qid in seen_qids_file:
                err(qw, "duplicated question id '%s' within file" % qid)
            seen_qids_file.add(qid)
            if qid in seen_qids_global:
                err(qw, "duplicated question id '%s' (also in %s)" % (qid, seen_qids_global[qid]))
            else:
                seen_qids_global[qid] = s["file"]
            if not (q.get("question") or "").strip():
                err(qw, "id '%s': empty 'question' text" % qid)
            opts = q.get("options")
            if not isinstance(opts, list) or len(opts) != 4:
                err(qw, "id '%s': need exactly 4 options, got %s"
                    % (qid, len(opts) if isinstance(opts, list) else type(opts).__name__))
            elif not all(isinstance(o, str) and o.strip() for o in opts):
                err(qw, "id '%s': all 4 options must be non-empty strings" % qid)
            if q.get("correct") not in (0, 1, 2, 3):
                err(qw, "id '%s': 'correct' must be 0-3, got %r" % (qid, q.get("correct")))
            if "explanation" not in q:
                err(qw, "id '%s': missing 'explanation' key (may be empty, must be present)" % qid)
            elif q["explanation"] is not None and not isinstance(q.get("explanation"), str):
                err(qw, "id '%s': 'explanation' must be a string" % qid)

    if errors:
        print("VALIDATION FAILED (%d problem(s)):" % len(errors))
        for e in errors:
            print("  - " + e)
        return 1
    total_q = len(seen_qids_global)
    print("OK: %d set(s), %d question(s), all checks passed." % (len(seen_set_ids), total_q))
    return 0


if __name__ == "__main__":
    sys.exit(main())
