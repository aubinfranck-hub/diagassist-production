#!/usr/bin/env python3
"""Construit la base de connaissances de codes défauts de DiagAssist.

Sortie : src/modules/dtc/data/dtc-kb.json.gz (chargée au démarrage du serveur).

Sources (voir docs/DATA_SOURCES.md pour les licences et l'attribution) :
  - OBDex (foerbsnavi/obdex) — données CC0 : codes génériques enrichis (causes, symptômes, coût).
  - dtc-database (Wal33D/dtc-database) — MIT : définitions constructeur (P1xxx, B1xxx...).
  - MechanicDB-public (MechanicDB/MechanicDB-public) — ODbL 1.0 : échantillon de 90 codes
    avec procédures de réparation classées. Conservé tel quel dans une section séparée.

Usage :
  git clone --depth 1 https://github.com/foerbsnavi/obdex           /tmp/src/obdex
  git clone --depth 1 https://github.com/Wal33D/dtc-database       /tmp/src/dtc-database
  git clone --depth 1 https://github.com/MechanicDB/MechanicDB-public /tmp/src/MechanicDB-public
  python3 scripts/build-dtc-kb.py /tmp/src
Dépendance : PyYAML.
"""
import csv
import glob
import gzip
import json
import os
import sqlite3
import subprocess
import sys
from datetime import date

import yaml

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/src"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "modules", "dtc", "data", "dtc-kb.json.gz")

# Noms de marques harmonisés (affichés au mécanicien et utilisés pour le filtrage).
BRAND_NAMES = {
    "CHEVY": "Chevrolet", "GM": "GM", "GMC": "GMC", "VOLKSWAGEN": "Volkswagen", "MERCEDES": "Mercedes-Benz",
    "OTHER": "Divers", "BMW": "BMW", "KIA": "Kia", "GEO": "Geo",
}


def brand_label(raw: str) -> str:
    raw = (raw or "").strip()
    up = raw.upper()
    return BRAND_NAMES.get(up, raw.title() if raw.isupper() else raw)


def git_rev(path: str) -> str:
    try:
        return subprocess.check_output(["git", "-C", path, "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "?"


def en(v):
    if isinstance(v, dict):
        return (v.get("en") or "").strip()
    return (v or "").strip() if isinstance(v, str) else ""


def build():
    obdex_dir = os.path.join(SRC, "obdex")
    wal_dir = os.path.join(SRC, "dtc-database")
    mdb_dir = os.path.join(SRC, "MechanicDB-public")

    generic = {}
    for f in sorted(glob.glob(os.path.join(obdex_dir, "data", "generic", "*.yaml"))):
        for e in yaml.safe_load(open(f, encoding="utf-8")) or []:
            code = str(e["code"]).upper()
            rep = e.get("repair") or {}
            flags = e.get("flags") or {}
            entry = {
                "t": en(e.get("title")),
                "d": en(e.get("description")),
                "cat": e.get("category") or "",
                "c": [[c.get("likelihood") or "", en(c.get("label"))] for c in (e.get("common_causes") or []) if en(c.get("label"))],
                "s": [en(s) for s in (e.get("symptoms") or []) if en(s)],
                "rel": e.get("related_codes") or [],
                "src": "obdex",
            }
            if rep:
                entry["r"] = {
                    "diff": rep.get("difficulty"),
                    "diy": rep.get("diy_possible"),
                    "eur": rep.get("estimated_cost_eur"),
                    "h": rep.get("estimated_hours"),
                }
            fl = [k for k in ("mil", "emissions_relevant", "limp_mode_possible", "drive_cycle_required") if flags.get(k)]
            if fl:
                entry["f"] = fl
            generic[code] = entry

    con = sqlite3.connect(os.path.join(wal_dir, "data", "dtc_codes.db"))
    oem = {}
    added_generic = 0
    for code, manu, desc in con.execute("SELECT code, manufacturer, description FROM dtc_definitions WHERE locale='en'"):
        code = code.upper().strip()
        desc = (desc or "").strip()
        if not desc:
            continue
        if manu == "GENERIC":
            if code not in generic:
                generic[code] = {"t": desc, "src": "dtc-database"}
                added_generic += 1
            continue
        oem.setdefault(code, []).append([brand_label(manu), desc])

    fixes = {}
    mdb_codes = {}
    code_by_id = {}
    with open(os.path.join(mdb_dir, "dtc_codes.csv"), encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh, delimiter="|"):
            code = r["dtc_code"].upper().strip()
            make = brand_label(r.get("oem_make") or "") if r.get("is_oem_specific") == "1" else ""
            code_by_id[r["code_id"]] = (code, make)
            mdb_codes.setdefault(code, []).append({
                "make": make,
                "t": (r.get("short_description") or "").strip(),
                "d": (r.get("detailed_technical_explanation") or "").strip(),
            })
    with open(os.path.join(mdb_dir, "diagnostic_fixes.csv"), encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh, delimiter="|"):
            ref = code_by_id.get(r["code_id"])
            if not ref:
                continue
            code, make = ref

            def num(v):
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return None

            fixes.setdefault(code, []).append({
                "make": make,
                "rank": int(r.get("probability_rank") or 99),
                "t": (r.get("fix_title") or "").strip(),
                "diff": (r.get("difficulty_level") or "").strip(),
                "usd": [num(r.get("est_parts_cost_min_usd")), num(r.get("est_parts_cost_max_usd"))],
                "h": num(r.get("est_labor_hours")),
                "steps": [s.strip() for s in (r.get("step_by_step_instructions") or "").split("•") if s.strip()],
            })
    for lst in fixes.values():
        lst.sort(key=lambda x: x["rank"])

    kb = {
        "version": date.today().isoformat(),
        "sources": {
            "obdex": {"rev": git_rev(obdex_dir), "license": "CC0-1.0", "url": "https://github.com/foerbsnavi/obdex"},
            "dtc-database": {"rev": git_rev(wal_dir), "license": "MIT", "url": "https://github.com/Wal33D/dtc-database"},
            "mechanicdb": {"rev": git_rev(mdb_dir), "license": "ODbL-1.0", "url": "https://github.com/MechanicDB/MechanicDB-public"},
        },
        "generic": generic,
        "oem": oem,
        "mechanicdb": {"codes": mdb_codes, "fixes": fixes},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    raw = json.dumps(kb, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(OUT, "wb", compresslevel=9) as fh:
        fh.write(raw)
    print(f"generic={len(generic)} (dont {added_generic} depuis dtc-database) oem_codes={len(oem)} "
          f"oem_defs={sum(len(v) for v in oem.values())} mechanicdb={len(mdb_codes)} fixes={sum(len(v) for v in fixes.values())} "
          f"json={len(raw)/1e6:.1f}Mo gz={os.path.getsize(OUT)/1e6:.1f}Mo")


if __name__ == "__main__":
    build()
