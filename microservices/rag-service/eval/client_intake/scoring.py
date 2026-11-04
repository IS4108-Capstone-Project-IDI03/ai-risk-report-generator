"""Pure scoring for the client intake evaluation (CP-23): one step response against its key.

Called by run_eval.py and tests/test_client_intake_eval.py. No network, no files, no judge:
everything is counted in code. `key` is a plan from plans.json, `response` is the body of
POST /client-intakes/read (see LABELS.md for the rules).
"""

import re
from collections import Counter

TITLES = {"mr", "ms", "mrs", "mdm", "dr", "khun", "encik", "puan"}
ABBREVIATIONS = {"rd": "road", "st": "street", "ave": "avenue", "blk": "block"}
CLIENT_FIELDS = ["client_name", "client_division"]
SITE_FIELDS = ["site_name", "site_address", "site_jurisdiction", "site_facility_type"]
ASSESSMENT_FIELDS = ["visit_type", "site_visit_date", "site_visit_end_date", "report_due_date"]
FIELDS = CLIENT_FIELDS + SITE_FIELDS + ASSESSMENT_FIELDS


def norm(text) -> str:
    """Return the text lower-cased, with punctuation gone and spaces collapsed."""
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


def tokens(text, drop=frozenset()) -> set[str]:
    """Return the normalised words of a text, with abbreviations spelled out."""
    return {ABBREVIATIONS.get(t, t) for t in norm(text).split() if t not in drop}


def overlap(a: set, b: set) -> float:
    """Return how much two word sets share (Jaccard: shared words over all words)."""
    return len(a & b) / len(a | b) if a | b else 0.0


def same(field: str, expected, got) -> bool:
    """Return whether a filled value equals the key's, after light normalisation."""
    if field == "site_address":
        return overlap(tokens(expected), tokens(got)) >= 0.8
    if field == "site_jurisdiction":
        return str(expected).upper() == str(got).upper()
    if field.endswith("date") or field == "report_due_date":
        return expected == got  # dates are YYYY-MM-DD strings
    return norm(expected) == norm(got)


def tally(row: Counter, field: str, expected, got_field) -> None:
    """Count one field. A key value of None means the documents don't say, so the right
    answer is empty; a filled value there is counted apart from a wrong value, and an
    empty answer for a present value is Not sure."""
    got = (got_field or {}).get("value")
    if expected is None:
        row[f"{field}.absent"] += 1
        row[f"{field}.empty_ok" if got is None else f"{field}.filled_when_absent"] += 1
        return
    row[f"{field}.present"] += 1
    if got is None:
        row[f"{field}.not_sure"] += 1
    else:
        row[f"{field}.correct" if same(field, expected, got) else f"{field}.wrong"] += 1


def pair_sites(key_sites: list[dict], got_sites: list[dict]) -> dict[str, dict]:
    """Return {key site ref: response site} for each key site found: by existing id, then by
    the best address (or near-equal name) match. A response site is used once."""
    pairs, used = {}, set()
    for k in key_sites:
        for i, g in enumerate(got_sites):
            if (
                k["existing_site_id"]
                and g.get("existing_id") == k["existing_site_id"]
                and i not in used
            ):
                pairs[k["ref"]] = g
                used.add(i)
                break
    cands = []
    for k in key_sites:
        for i, g in enumerate(got_sites):
            addr = overlap(
                tokens(k["address"]), tokens((g.get("address") or {}).get("value") or "")
            )
            name = overlap(tokens(k["name"]), tokens((g.get("name") or {}).get("value") or ""))
            score = max(addr if addr >= 0.6 else 0, name if name >= 0.8 else 0)
            if score and k["ref"] not in pairs and i not in used:
                cands.append((score, k["ref"], i))
    for _, ref, i in sorted(cands, key=lambda c: -c[0]):
        if ref not in pairs and i not in used:
            pairs[ref] = got_sites[i]
            used.add(i)
    return pairs


def pair_assessments(key_list: list[dict], got_list: list[dict]) -> dict[str, dict]:
    """Return {key assessment ref: response assessment} within one site, best agreement on
    visit type and dates first. A response assessment is used once."""
    cands = []
    for k in key_list:
        for i, g in enumerate(got_list):
            hits = sum(k[f] == ((g.get(f) or {}).get("value")) for f in ASSESSMENT_FIELDS)
            cands.append((hits, k["ref"], i))
    pairs, used = {}, set()
    for _, ref, i in sorted(cands, key=lambda c: -c[0]):
        if ref not in pairs and i not in used:
            pairs[ref] = got_list[i]
            used.add(i)
    return pairs


def same_person(a: str, b: str) -> bool:
    """Return whether two names are one person, ignoring titles and word order."""
    x, y = tokens(a, TITLES), tokens(b, TITLES)
    return bool(x) and bool(y) and (x <= y or y <= x)


def tally_contacts(row: Counter, key_contacts: list[dict], got_contacts: list[dict]) -> None:
    """Count contacts found and their roles; unmatched response contacts are extra."""
    unused = list(got_contacts)
    for k in key_contacts:
        row["contacts.expected"] += 1
        hit = next((g for g in unused if same_person(k["name"], g["name"])), None)
        if hit:
            unused.remove(hit)
            row["contacts.found"] += 1
            role_ok = norm(hit.get("role") or "") == norm(k["role"] or "")
            row["contacts.role_correct"] += role_ok
    row["contacts.extra"] += len(unused)


def tally_match(row: Counter, name: str, expected_id, got: dict) -> None:
    """Count a client or site match: the right recorded id (or none), Not sure, or wrong."""
    row[f"{name}.n"] += 1
    if got.get("existing_id") == expected_id:
        row[f"{name}.correct"] += 1
    elif expected_id and got.get("existing_id") is None and got.get("match_not_sure"):
        row[f"{name}.not_sure"] += 1
    else:
        row[f"{name}.wrong"] += 1


def placement_ok(want: dict, got: dict, site_map: dict, assessment_map: dict) -> bool:
    """Return whether a document's placement is the key's, with refs mapped to key refs."""
    if want["kind"] != got.get("kind"):
        return False
    refs = {"site": site_map, "assessment": assessment_map}
    return want["kind"] == "client" or refs[want["kind"]].get(got.get("ref")) == want["ref"]


def score_case(key: dict, response: dict) -> Counter:
    """Return one pack's counts (see summarise for the rates built from them)."""
    row = Counter()
    # a. Client: name and division only when the key says it is a new client.
    client = response["client"]
    if not key["client"]["existing_id"]:
        tally(row, "client_name", key["client"]["name"], client["name"])
        tally(row, "client_division", key["client"]["division"], client["division"])
    tally_match(row, "client_match", key["client"]["existing_id"], client)
    # b. Sites: fields only for new sites; recorded sites are scored on the match.
    site_pairs = pair_sites(key["sites"], response["sites"])
    row["sites.expected"], row["sites.found"] = len(key["sites"]), len(site_pairs)
    row["sites.extra"] = len(response["sites"]) - len(site_pairs)
    for k in key["sites"]:
        got = site_pairs.get(k["ref"], {})
        if got:
            tally_match(row, "site_match", k["existing_site_id"], got)
        if not k["existing_site_id"]:
            for f in SITE_FIELDS:
                tally(row, f, k[f.removeprefix("site_")], got.get(f.removeprefix("site_")))
    # c. Assessments, paired site by site; contacts inside each pair.
    site_map = {g["ref"]: ref for ref, g in site_pairs.items()}
    got_by_site: dict[str, list] = {}
    for a in response["assessments"]:
        got_by_site.setdefault(a["site_ref"], []).append(a)
    assessment_map, matched = {}, 0
    for k_site in key["sites"]:
        key_list = [a for a in key["assessments"] if a["site_ref"] == k_site["ref"]]
        got_site = site_pairs.get(k_site["ref"])
        got_list = got_by_site.get(got_site["ref"], []) if got_site else []
        pairs = pair_assessments(key_list, got_list)
        matched += len(pairs)
        for k in key_list:
            g = pairs.get(k["ref"])
            if g:
                assessment_map[g["ref"]] = k["ref"]
            for f in ASSESSMENT_FIELDS:
                tally(row, f, k[f], g.get(f) if g else None)
            tally_contacts(row, k["site_contacts"], g["site_contacts"] if g else [])
    row["assessments.expected"], row["assessments.found"] = len(key["assessments"]), matched
    row["assessments.extra"] = len(response["assessments"]) - matched
    # d. Placement of each document.
    got_docs = {d["id"]: d["placement"] for d in response["documents"]}
    for d in key["documents"]:
        row["placement.n"] += 1
        got = got_docs.get(d["id"]) or {}
        row["placement.correct"] += placement_ok(d["placement"], got, site_map, assessment_map)
    row["placement.not_sure"] = sum(1 for d in response["documents"] if d.get("not_sure"))
    exact = row["sites.expected"] == len(response["sites"]) and row["assessments.expected"] == len(
        response["assessments"]
    )
    row["counts_exact"] = int(exact)
    row["case"] = key["id"]  # a Counter, so a count that never happened reads as 0
    return row


def rate(row: dict, part: str, whole: str):
    """Return row[part] / row[whole], or None when there is nothing to divide."""
    return row.get(part, 0) / row[whole] if row.get(whole) else None


def summarise(rows: list[dict]) -> dict:
    """Return the run's rates: per-field accuracy, wrong and Not sure; empty-when-absent
    and filled-when-absent; match, placement, contact and count rates."""
    total = Counter()
    for r in rows:
        total.update({k: v for k, v in r.items() if k != "case"})
    fields = {}
    for f in FIELDS:
        fields[f] = {
            "accuracy": rate(total, f"{f}.correct", f"{f}.present"),
            "wrong": rate(total, f"{f}.wrong", f"{f}.present"),
            "not_sure": rate(total, f"{f}.not_sure", f"{f}.present"),
            "empty_when_absent": rate(total, f"{f}.empty_ok", f"{f}.absent"),
            "filled_when_absent": rate(total, f"{f}.filled_when_absent", f"{f}.absent"),
        }

    def over(suffix: str, whole: str):
        """Return the share of fields ending in `whole` that ended in `suffix`."""
        n = sum(v for k, v in total.items() if k.endswith(whole))
        return sum(v for k, v in total.items() if k.endswith(suffix)) / n if n else None

    out = {
        "fields": fields,
        "empty_when_absent": over(".empty_ok", ".absent"),
        "filled_when_absent": over(".filled_when_absent", ".absent"),
        "accuracy": rate(
            {
                "c": sum(total[f"{f}.correct"] for f in FIELDS),
                "n": sum(total[f"{f}.present"] for f in FIELDS),
            },
            "c",
            "n",
        ),
    }
    for m in ("client_match", "site_match"):
        out[m] = {k: rate(total, f"{m}.{k}", f"{m}.n") for k in ("correct", "not_sure", "wrong")}
    out["placement"] = rate(total, "placement.correct", "placement.n")
    out["sites_found"] = rate(total, "sites.found", "sites.expected")
    out["sites_extra"] = total["sites.extra"]
    out["assessments_found"] = rate(total, "assessments.found", "assessments.expected")
    out["assessments_extra"] = total["assessments.extra"]
    out["contacts_found"] = rate(total, "contacts.found", "contacts.expected")
    out["contact_roles"] = rate(total, "contacts.role_correct", "contacts.found")
    out["contacts_extra"] = total["contacts.extra"]
    out["counts_exact"] = sum(r["counts_exact"] for r in rows) / len(rows) if rows else None
    return out
