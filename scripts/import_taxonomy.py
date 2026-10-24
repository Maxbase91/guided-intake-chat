"""Import the Level 4 taxonomy, preferred suppliers, framework contracts and the catalogue into index.html.

Usage:
    python3 scripts/import_taxonomy.py data/taxonomy-test            # validate and write into index.html
    python3 scripts/import_taxonomy.py data/taxonomy-test --check    # validate only

The folder holds CSV files (UTF-8, header row). Several files of each kind are merged:
    l4*.csv         code,name,l1,l2,l3,theme,desc,kw          kw: search terms separated by ";"
    suppliers*.csv  supplier,preferred_l4                       preferred_l4: L4 codes separated by ";"
    contracts*.csv  id,supplier,title,l4,expires,remaining      l4: codes separated by ";", expires: YYYY-MM-DD
    catalogue*.csv  id,kind,name,supplier,l4,price,max_order,unit,kw
                    kind "item": a fixed-price item (price required); kind "shop": a supplier's punch-out shop for a whole
                    Level 4, with no fixed price and a maximum order value (max_order required)
    theme-map.csv   level,name,theme  (optional)                fills an empty theme from the L3, L2 or L1 name

The real list: export the Excel sheets as CSV with these columns. Every L4 needs a theme: one of the rule themes
(CATEGORIES ids in index.html), which decide the questions and the outsourcing check. Rows without one are listed
and nothing is written.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
BLOCK_RE = re.compile(
    r'(<script id="taxonomy-data" type="application/json">)(.*?)(</script>)', re.S
)
CODE_RE = re.compile(r"^L4-\d{4}$")


@dataclass
class L4Entry:
    code: str
    name: str
    l1: str
    l2: str
    l3: str
    theme: str
    desc: str
    kw: list[str] = field(default_factory=list)


@dataclass
class Supplier:
    name: str
    preferred_l4: list[str]


@dataclass
class Contract:
    id: str
    supplier: str
    title: str
    l4: list[str]
    expires: str
    remaining: int


@dataclass
class CatalogueEntry:
    id: str
    kind: str
    name: str
    supplier: str
    l4: str
    price: float | None
    max_order: float | None
    unit: str
    kw: list[str] = field(default_factory=list)


def load_catalogue(folder: Path, codes: set[str]) -> tuple[list[CatalogueEntry], list[str]]:
    """Catalogue items and punch-out shops, each linked to an existing Level 4."""
    entries: list[CatalogueEntry] = []
    errors: list[str] = []
    ids: set[str] = set()

    def number(where: str, col: str, value: str) -> float | None:
        if not value:
            return None
        try:
            return float(value)
        except ValueError:
            errors.append(f"{where}: {col} '{value}' is not a number")
            return None

    for src, line, row in read_rows(folder, "catalogue*.csv"):
        where = f"{src}:{line}"
        cid, kind, l4 = row.get("id", ""), row.get("kind", "").lower(), row.get("l4", "")
        if not cid or cid in ids:
            errors.append(f"{where}: catalogue id '{cid}' is empty or appears twice")
        ids.add(cid)
        if kind not in ("item", "shop"):
            errors.append(f"{where}: kind '{kind}' must be item or shop")
        for col in ("name", "supplier"):
            if not row.get(col):
                errors.append(f"{where}: {col} is empty")
        if l4 not in codes:
            errors.append(f"{where}: {cid} is linked to unknown Level 4 '{l4}'")
        price = number(where, "price", row.get("price", ""))
        max_order = number(where, "max_order", row.get("max_order", ""))
        if kind == "item" and not (price and price > 0):
            errors.append(f"{where}: item {cid} needs a price")
        if kind == "shop" and not (max_order and max_order > 0):
            errors.append(f"{where}: shop {cid} needs a max_order")
        entries.append(CatalogueEntry(cid, kind, row.get("name", ""), row.get("supplier", ""), l4, price, max_order,
                                      row.get("unit", ""), [k.lower() for k in split_list(row.get("kw", ""))]))
    return entries, errors


def themes_in_page(html: str) -> set[str]:
    """The rule themes are the CATEGORIES ids in index.html, so the import never accepts a theme the rules don't know."""
    block = html[
        html.index("const CATEGORIES = [") : html.index(
            "];", html.index("const CATEGORIES = [")
        )
    ]
    return set(re.findall(r'\{id:"([a-z-]+)"', block))


def split_list(value: str) -> list[str]:
    return [x.strip() for x in (value or "").split(";") if x.strip()]


def read_rows(folder: Path, pattern: str) -> list[tuple[str, int, dict[str, str]]]:
    rows: list[tuple[str, int, dict[str, str]]] = []
    for path in sorted(folder.glob(pattern)):
        with path.open(newline="", encoding="utf-8-sig") as fh:
            for i, row in enumerate(csv.DictReader(fh), start=2):
                rows.append(
                    (
                        path.name,
                        i,
                        {k.strip(): (v or "").strip() for k, v in row.items() if k},
                    )
                )
    return rows


def load(
    folder: Path, themes: set[str]
) -> tuple[list[L4Entry], list[Supplier], list[Contract], list[str]]:
    errors: list[str] = []
    theme_map: dict[tuple[str, str], str] = {}
    for src, line, row in read_rows(folder, "theme-map.csv"):
        theme_map[(row.get("level", "").lower(), row.get("name", "").lower())] = (
            row.get("theme", "")
        )

    l4: list[L4Entry] = []
    seen: set[str] = set()
    for src, line, row in read_rows(folder, "l4*.csv"):
        where = f"{src}:{line}"
        code = row.get("code", "")
        theme = row.get("theme", "") or next(
            (
                theme_map[(lvl, row.get(lvl, "").lower())]
                for lvl in ("l3", "l2", "l1")
                if (lvl, row.get(lvl, "").lower()) in theme_map
            ),
            "",
        )
        if not CODE_RE.match(code):
            errors.append(f"{where}: code '{code}' is not like L4-1234")
        elif code in seen:
            errors.append(f"{where}: code {code} appears twice")
        seen.add(code)
        for col in ("name", "l1", "l2", "l3", "desc"):
            if not row.get(col):
                errors.append(f"{where}: {col} is empty")
        if theme not in themes:
            errors.append(
                f"{where}: {code} has no valid theme ('{theme}'); use one of {', '.join(sorted(themes))} or add it to theme-map.csv"
            )
        l4.append(
            L4Entry(
                code,
                row.get("name", ""),
                row.get("l1", ""),
                row.get("l2", ""),
                row.get("l3", ""),
                theme,
                row.get("desc", ""),
                [k.lower() for k in split_list(row.get("kw", ""))],
            )
        )

    suppliers: dict[str, Supplier] = {}
    for src, line, row in read_rows(folder, "suppliers*.csv"):
        name, codes = row.get("supplier", ""), split_list(row.get("preferred_l4", ""))
        if not name:
            errors.append(f"{src}:{line}: supplier name is empty")
            continue
        for c in codes:
            if c not in seen:
                errors.append(f"{src}:{line}: {name} is preferred for unknown code {c}")
        s = suppliers.setdefault(name, Supplier(name, []))
        s.preferred_l4 = sorted(set(s.preferred_l4) | set(codes))

    contracts: list[Contract] = []
    ids: set[str] = set()
    for src, line, row in read_rows(folder, "contracts*.csv"):
        where = f"{src}:{line}"
        cid, codes = row.get("id", ""), split_list(row.get("l4", ""))
        if not cid or cid in ids:
            errors.append(f"{where}: contract id '{cid}' is empty or appears twice")
        ids.add(cid)
        for col in ("supplier", "title"):
            if not row.get(col):
                errors.append(f"{where}: {col} is empty")
        if not codes:
            errors.append(f"{where}: {cid} covers no L4 code")
        for c in codes:
            if c not in seen:
                errors.append(f"{where}: {cid} covers unknown code {c}")
        try:
            date.fromisoformat(row.get("expires", ""))
        except ValueError:
            errors.append(f"{where}: expires '{row.get('expires')}' is not YYYY-MM-DD")
        try:
            remaining = int(float(row.get("remaining", "0") or 0))
        except ValueError:
            errors.append(
                f"{where}: remaining '{row.get('remaining')}' is not a number"
            )
            remaining = 0
        contracts.append(
            Contract(
                cid,
                row.get("supplier", ""),
                row.get("title", ""),
                codes,
                row.get("expires", ""),
                remaining,
            )
        )
    return l4, sorted(suppliers.values(), key=lambda s: s.name), contracts, errors


def to_json(
    version: str,
    l4: list[L4Entry],
    suppliers: list[Supplier],
    contracts: list[Contract],
    catalogue: list[CatalogueEntry] | None = None,
) -> str:
    # one entry per line keeps the diff of index.html readable; "</" is escaped so the block can't end the script tag
    lines = lambda items: ",\n".join(
        json.dumps(asdict(x), ensure_ascii=False) for x in items
    )
    text = f'{{"version":{json.dumps(version)},\n"l4":[\n{lines(l4)}\n],\n"suppliers":[\n{lines(suppliers)}\n],\n"contracts":[\n{lines(contracts)}\n],\n"catalogue":[\n{lines(catalogue or [])}\n]}}'
    return text.replace("</", "<\\/")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("folder", type=Path)
    ap.add_argument(
        "--check", action="store_true", help="validate only, don't write index.html"
    )
    ap.add_argument(
        "--version",
        default=None,
        help="label stored with the data (default: the folder name)",
    )
    ap.add_argument("--html", type=Path, default=HTML)
    args = ap.parse_args()

    html = args.html.read_text(encoding="utf-8")
    l4, suppliers, contracts, errors = load(args.folder, themes_in_page(html))
    catalogue, cat_errors = load_catalogue(args.folder, {e.code for e in l4})
    errors += cat_errors
    if errors:
        print(f"{len(errors)} problem(s), nothing written:", file=sys.stderr)
        for e in errors[:200]:
            print("  " + e, file=sys.stderr)
        return 1
    by_theme: dict[str, int] = {}
    for e in l4:
        by_theme[e.theme] = by_theme.get(e.theme, 0) + 1
    print(
        f"{len(l4)} Level 4 categories, {len(suppliers)} suppliers, {len(contracts)} contracts, "
        f"{len(catalogue)} catalogue entries ({sum(1 for c in catalogue if c.kind == 'shop')} shops)"
    )
    print("by theme: " + ", ".join(f"{k} {v}" for k, v in sorted(by_theme.items())))
    if args.check:
        return 0
    if not BLOCK_RE.search(html):
        print(
            'index.html has no <script id="taxonomy-data" type="application/json"> block',
            file=sys.stderr,
        )
        return 1
    data = to_json(args.version or args.folder.name, l4, suppliers, contracts, catalogue)
    args.html.write_text(
        BLOCK_RE.sub(
            lambda m: m.group(1) + "\n" + data + "\n" + m.group(3), html, count=1
        ),
        encoding="utf-8",
    )
    print(f"written to {args.html}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
