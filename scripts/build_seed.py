#!/usr/bin/env python3
"""Build D1 seed SQL from the local Chernivtsi open-data warehouse.

Run from the project root:
    python3 scripts/build_seed.py

The source directory defaults to ../HelloData. Override with HELLODATA_DIR.
Output: seed/seed.sql (schema + rows) and seed/manifest.json.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import sqlite3
import struct
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELLO = Path(os.environ.get("HELLODATA_DIR", ROOT.parent / "HelloData")).resolve()
SEED_DIR = ROOT / "seed"
MIGRATIONS = ROOT / "migrations" / "0001_init.sql"

SEARCH_TEXT_RULES = {
    "fact_building_lease": ["tenant", "address", "intended_use", "contract_number", "status"],
    "fact_land_lease": ["tenant", "address", "cadastral", "contract_number", "lease_status"],
    "fact_building": ["address", "manager"],
    "fact_housing_account": ["street_name", "house_number", "manager"],
    "fact_tariff": ["type", "provider", "consumers_type"],
    "fact_road_project": ["description", "address", "contractor", "project_type"],
    "fact_construction_project": ["description", "address", "contractor", "project_type"],
}

FINANCE_TABLES = [
    "fact_building_lease",
    "fact_land_lease",
    "fact_building",
    "fact_housing_account",
    "fact_tariff",
    "fact_road_project",
    "fact_construction_project",
    "fact_social_payment",
    "fact_charity",
    "fact_school_expense",
    "fact_parking_fine",
    "fact_payment",
]

PLACE_DATASETS = [
    {
        "id": "2197350448057288254",
        "category": "school",
        "name": ["name"],
        "address": ["address"],
        "phone": ["phone"],
        "website": ["site"],
        "geom": "geom",
    },
    {
        "id": "2197342965913880086",
        "category": "kindergarten",
        "name": ["name"],
        "address": ["address"],
        "phone": ["phone"],
        "website": ["site"],
        "geom": "geom",
    },
    {
        "id": "2197357784893228655",
        "category": "healthcare",
        "name": ["name"],
        "address": ["address"],
        "phone": ["phone"],
        "website": ["site"],
        "geom": "geom",
    },
    {
        "id": "2197355512972969571",
        "category": "healthcare_regional",
        "name": ["name"],
        "address": ["address"],
        "phone": ["phone"],
        "website": ["site"],
        "geom": "geom",
    },
    {
        "id": "2197359785492350592",
        "category": "clinic_private",
        "name": ["name"],
        "address": ["address"],
        "phone": ["phone"],
        "website": ["site"],
        "geom": "geom",
    },
    {
        "id": "2197360398095615622",
        "category": "culture",
        "name": ["name"],
        "address": ["address"],
        "phone": ["phone"],
        "website": ["site"],
        "geom": "geom",
    },
    {
        "id": "2197354103493887577",
        "category": "university",
        "name": ["name"],
        "address": ["address"],
        "phone": ["phone"],
        "website": ["site"],
        "geom": "geom",
    },
    {
        "id": "2197352961946945103",
        "category": "vocational",
        "name": ["name"],
        "address": ["address"],
        "phone": ["phone"],
        "website": ["site"],
        "geom": "geom",
    },
    {
        "id": "2197351677818832451",
        "category": "extracurricular",
        "name": ["name"],
        "address": ["address"],
        "phone": ["phone"],
        "website": ["site"],
        "geom": "geom",
    },
    {
        "id": "2197379784932067096",
        "category": "playground",
        "name_prefix": "Майданчик",
        "name": ["number"],
        "address": ["address"],
        "geom": "geom",
    },
    {
        "id": "2956837251696297447",
        "category": "waste",
        "name_prefix": "Контейнерний майданчик",
        "name": ["num"],
        "address": ["address"],
        "geom": "geom",
    },
    {
        "id": "2197381696779716385",
        "category": "dog_area",
        "name_prefix": "Зона вигулу собак",
        "name": ["id"],
        "address": ["address"],
        "geom": "geom",
    },
    {
        "id": "2197339729857349032",
        "category": "shelter",
        "name": ["type_zscz", "number_zscz"],
        "address": ["address_zscz"],
        "geom": "geom_wkt",
    },
    {
        "id": "2197269280263767166",
        "category": "communal_property",
        "name": ["cp_complex", "cp_build_desc", "cp_adress_text"],
        "address": ["cp_adress_text"],
        "geom": "geom",
    },
    {
        "id": "2197294286653883670",
        "category": "housing",
        "name": ["address"],
        "address": ["address"],
        "geom": "geom",
    },
    {
        "id": "2197388182717204287",
        "category": "advertising",
        "name": ["location_adv"],
        "address": ["location_adv"],
        "latlng": "latlng",
        "geom": "geom",
    },
    {
        "id": "2197318803912656209",
        "category": "privatization",
        "name": ["cp_address_obj"],
        "address": ["cp_address_obj"],
        "geom": "geom",
    },
    {
        "id": "2648808465077634159",
        "category": "land_auction",
        "name": ["address"],
        "address": ["address"],
        "geom": "geom",
    },
]


def normalize(value: str | None) -> str:
    if not value:
        return ""
    value = unicodedata.normalize("NFKC", value).lower()
    value = value.replace("’", "").replace("'", "").replace("`", "").replace("ʼ", "")
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def normalize_street(value: str | None) -> str:
    value = normalize(value)
    return re.sub(
        r"\b(вулиця|вул|проспект|просп|бульвар|б р|провулок|пров|площа|пл|набережна|наб|шосе|дорога|проїзд|тупик|туп|завулок|завул)\b",
        " ",
        value,
    ).strip()


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return "NULL"
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def iter_inserts(table: str, columns: list[str], rows, chunk_size: int = 100):
    chunk = []
    chunk_bytes = 0
    prefix = f"INSERT OR REPLACE INTO {table} ({', '.join(columns)}) VALUES "
    for row in rows:
        values = "(" + ", ".join(sql_value(value) for value in row) + ")"
        if chunk and (len(chunk) >= chunk_size or chunk_bytes + len(values) > 40_000):
            yield prefix + ",\n".join(chunk) + ";\n"
            chunk = []
            chunk_bytes = 0
        chunk.append(values)
        chunk_bytes += len(values)
    if chunk:
        yield prefix + ",\n".join(chunk) + ";\n"


def read_csv(path: Path, encoding: str = "utf-8-sig") -> list[dict[str, str]]:
    with path.open("r", encoding=encoding, newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        delimiter = max([";", ",", "\t"], key=lambda candidate: sample.count(candidate))
        return list(csv.DictReader(handle, delimiter=delimiter))


# --- WKB / WKT helpers -------------------------------------------------------


def read_wkb(data: bytes, offset: int = 0):
    order = data[offset]
    offset += 1
    endian = "<" if order == 1 else ">"
    geom_type = struct.unpack_from(endian + "I", data, offset)[0]
    offset += 4
    has_srid = bool(geom_type & 0x20000000)
    base_type = geom_type & 0x0FFFFFFF
    if has_srid:
        offset += 4
    if base_type == 1:
        lon, lat = struct.unpack_from(endian + "dd", data, offset)
        return [(lon, lat)], offset + 16
    if base_type == 2:
        count = struct.unpack_from(endian + "I", data, offset)[0]
        offset += 4
        points = []
        for _ in range(count):
            lon, lat = struct.unpack_from(endian + "dd", data, offset)
            offset += 16
            points.append((lon, lat))
        return points, offset
    if base_type == 3:
        rings = struct.unpack_from(endian + "I", data, offset)[0]
        offset += 4
        points = []
        for _ in range(rings):
            count = struct.unpack_from(endian + "I", data, offset)[0]
            offset += 4
            for _ in range(count):
                lon, lat = struct.unpack_from(endian + "dd", data, offset)
                offset += 16
                points.append((lon, lat))
        return points, offset
    if base_type in (4, 5, 6, 7):
        count = struct.unpack_from(endian + "I", data, offset)[0]
        offset += 4
        points = []
        for _ in range(count):
            child, offset = read_wkb(data, offset)
            points.extend(child)
        return points, offset
    raise ValueError(f"Unsupported WKB geometry type {base_type}")


def geom_from_value(value: str | None):
    if not value or str(value).strip().lower() in ("null", "none", ""):
        return None
    text = str(value).strip()
    if re.match(r"^[0-9A-Fa-f]+$", text) and len(text) > 20:
        try:
            points, _ = read_wkb(bytes.fromhex(text))
            points = [(lon, lat) for lon, lat in points if math.isfinite(lon) and math.isfinite(lat)]
            if points:
                return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))
        except Exception:
            return None
    if text.upper().startswith(("POINT", "MULTIPOINT", "POLYGON", "MULTIPOLYGON", "LINESTRING")):
        pairs = [(float(lon), float(lat)) for lon, lat in re.findall(r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)", text)]
        if pairs:
            return (sum(p[0] for p in pairs) / len(pairs), sum(p[1] for p in pairs) / len(pairs))
    return None


def latlon_from_latlng(value: str | None):
    if not value:
        return None
    parts = re.split(r"[\s,]+", value.strip())
    if len(parts) >= 2:
        try:
            lon, lat = float(parts[0]), float(parts[1])
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return (lon, lat)
        except ValueError:
            pass
    return None


def first(row: dict[str, str], keys: list[str]) -> str | None:
    for key in keys:
        value = row.get(key)
        if value and value.strip().lower() not in ("null", "none", ""):
            return value.strip()
    return None


INDIVIDUAL_RE = re.compile(r"^[А-ЯІЇЄҐ][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐ][а-яіїєґ'’\-]+\s+[А-ЯІЇЄҐ][а-яіїєґ'’\-]+$")


def mask_individual_name(name: str | None, edrpou: str | None = None) -> str | None:
    if not name:
        return name
    cleaned = name.strip()
    if edrpou and edrpou.strip():
        return cleaned
    if INDIVIDUAL_RE.match(cleaned):
        return "Фізична особа"
    return cleaned


def main() -> None:
    if not HELLO.exists():
        raise SystemExit(f"HelloData directory not found: {HELLO}")
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    outputs: list[str] = [MIGRATIONS.read_text(encoding="utf-8")]
    manifest = {"generated_at": datetime.now(timezone.utc).isoformat(), "hello_data": str(HELLO)}
    counts: dict[str, int] = {}

    # --- catalog ------------------------------------------------------------
    catalog = json.loads((HELLO / "catalog.json").read_text(encoding="utf-8"))
    dataset_rows = []
    for entry in catalog:
        dataset_rows.append(
            (
                entry.get("dataset_id"),
                entry.get("title"),
                "data.gov.ua",
                entry.get("page"),
                entry.get("modified"),
                entry.get("resource_count"),
                entry.get("notes") or "",
            )
        )
    geoportal_manifest = json.loads(
        (HELLO / "data/geoportal/_metadata/sources.json").read_text(encoding="utf-8")
    )
    for entry in geoportal_manifest:
        dataset_rows.append(
            (
                entry.get("dataset_id"),
                entry.get("title"),
                "map.city.cv.ua",
                entry.get("dataset_page"),
                None,
                1,
                f"{entry.get('format')} · {entry.get('rows')} rows",
            )
        )
    outputs.extend(
        iter_inserts(
            "dataset",
            ["id", "title", "source", "page", "modified", "resource_count", "notes"],
            dataset_rows,
        )
    )
    counts["datasets"] = len(dataset_rows)

    index_rows = read_csv(HELLO / "data/index.csv")
    resource_rows = []
    for row in index_rows:
        url = row.get("resource_url") or ""
        resource_id = "res-" + hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]
        resource_rows.append(
            (
                resource_id,
                row.get("dataset_id"),
                row.get("resource_name"),
                row.get("resource_format"),
                url,
                int(row["bytes"]) if row.get("bytes") and row["bytes"].isdigit() else None,
                row.get("status"),
                row.get("file"),
            )
        )
    for entry in geoportal_manifest:
        resource_rows.append(
            (
                "geo-" + str(entry.get("dataset_id")),
                entry.get("dataset_id"),
                entry.get("title"),
                entry.get("format"),
                entry.get("dataset_page"),
                entry.get("bytes"),
                entry.get("status"),
                entry.get("file"),
            )
        )
    outputs.extend(
        iter_inserts(
            "resource",
            ["id", "dataset_id", "name", "format", "url", "bytes", "status", "file"],
            resource_rows,
        )
    )
    counts["resources"] = len(resource_rows)

    # --- finance warehouse --------------------------------------------------
    conn = sqlite3.connect(HELLO / "db/finance_slim.sqlite")
    conn.row_factory = sqlite3.Row
    individual_contracts = {
        str(row["contract_number"])
        for row in conn.execute("SELECT contract_number FROM fact_building_lease WHERE is_individual = 1")
        if row["contract_number"]
    }
    for table in FINANCE_TABLES:
        try:
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        except sqlite3.Error as error:
            print(f"skip {table}: {error}", file=sys.stderr)
            continue
        if not rows:
            continue
        columns = list(rows[0].keys())
        if "geom_wkb" in columns:
            columns = [column for column in columns if column != "geom_wkb"]
        search_columns = SEARCH_TEXT_RULES.get(table)
        if search_columns:
            columns.append("search_text")
        output_rows = []
        for row in rows:
            value_map = {}
            for column in columns:
                if column == "search_text":
                    continue
                value = row[column]
                if table == "fact_building_lease" and column == "tenant":
                    if row["is_individual"]:
                        value = "Фізична особа"
                elif table == "fact_building_lease" and column == "legal_form":
                    if row["is_individual"]:
                        value = "Фізична особа"
                elif table == "fact_building_lease" and column == "tenant_edrpou":
                    if row["is_individual"]:
                        value = None
                elif table == "fact_land_lease" and column == "tenant":
                    value = mask_individual_name(value, row["tenant_edrpou"])
                elif table == "fact_land_lease" and column == "tenant_edrpou":
                    if not row["tenant_edrpou"]:
                        value = None
                elif table == "fact_payment" and column == "tenant":
                    if str(row["contract_number"]) in individual_contracts:
                        value = "Фізична особа"
                value_map[column] = value
            if search_columns:
                value_map["search_text"] = normalize(
                    " ".join(str(value_map.get(column) or "") for column in search_columns)
                )
            output_rows.append(tuple(value_map.get(column) for column in columns))
        outputs.extend(iter_inserts(table, columns, output_rows))
        counts[table] = len(output_rows)
    conn.close()

    # --- address register ---------------------------------------------------
    address_path = HELLO / "data/geoportal/2197372995033368296.csv"
    address_rows = []
    street_points: dict[str, list[tuple[float, float]]] = defaultdict(list)
    address_id = 0
    for row in read_csv(address_path):
        street = first(row, ["addressThoroughfare", "addressObjectName"])
        house = first(row, ["addressLocatorDesignator"]) or ""
        settlement = first(row, ["addressPostName", "addressAdminUnitL3"]) or ""
        point = geom_from_value(row.get("geom"))
        if not street or not point:
            continue
        lon, lat = point
        address_id += 1
        search_text = normalize(f"{street} {house} {settlement}")
        address_rows.append((address_id, street, house, settlement, lat, lon, search_text, "map.city.cv.ua address register"))
        key = normalize_street(street)
        if key:
            street_points[key].append((lat, lon))
    outputs.extend(
        iter_inserts(
            "address_point",
            ["id", "street", "house", "settlement", "lat", "lon", "search_text", "source"],
            address_rows,
            chunk_size=200,
        )
    )
    counts["address_points"] = len(address_rows)
    street_centroids = {
        key: (sum(point[0] for point in points) / len(points), sum(point[1] for point in points) / len(points))
        for key, points in street_points.items()
    }

    # --- places -------------------------------------------------------------
    place_rows = []
    place_id = 0
    seen_places = set()
    for config in PLACE_DATASETS:
        path = HELLO / "data/geoportal" / f"{config['id']}.csv"
        if not path.exists():
            continue
        for row in read_csv(path):
            name = first(row, config.get("name", []))
            if config.get("name_prefix"):
                suffix = name or ""
                name = f"{config['name_prefix']} {suffix}".strip()
            address = first(row, config.get("address", []))
            if not name and not address:
                continue
            point = geom_from_value(row.get(config.get("geom", "")))
            if not point and config.get("latlng"):
                point = latlon_from_latlng(row.get(config["latlng"]))
            lat = point[1] if point else None
            lon = point[0] if point else None
            phone = first(row, config.get("phone", []))
            website = first(row, config.get("website", []))
            key = (config["category"], normalize(name or ""), normalize(address or ""))
            if key in seen_places:
                continue
            seen_places.add(key)
            place_id += 1
            search_text = normalize(" ".join(filter(None, [name, address, config["category"]])))
            place_rows.append(
                (
                    place_id,
                    config["category"],
                    name or address or "Об'єкт",
                    address,
                    lat,
                    lon,
                    phone,
                    website,
                    search_text,
                    f"map.city.cv.ua/{config['id']}",
                )
            )
    outputs.extend(
        iter_inserts(
            "place",
            ["id", "category", "name", "address", "lat", "lon", "phone", "website", "search_text", "source"],
            place_rows,
            chunk_size=150,
        )
    )
    counts["places"] = len(place_rows)

    # --- transit ------------------------------------------------------------
    route_path = HELLO / "data/Характеристика маршрутів громадського транспорту Чернівецької міської територіальної громади/routes_description.csv"
    route_rows = []
    route_meta: dict[str, dict[str, str]] = {}
    for row in read_csv(route_path):
        # The source CSV names the columns confusingly: route_name holds the
        # number (e.g. "№1"), while route_number holds the human route name.
        number = (row.get("route_name") or "").replace("№", "").strip()
        if not number:
            continue
        route_meta[number] = row
        route_rows.append(
            (
                number,
                row.get("route_number") or f"Маршрут {number}",
                row.get("route_type"),
                row.get("route_description"),
                row.get("route_work_hours"),
                row.get("route_interval"),
                row.get("route_length"),
                "city transport open data",
            )
        )
    outputs.extend(
        iter_inserts(
            "transit_route",
            ["route_number", "route_name", "route_type", "description", "work_hours", "interval", "length", "source"],
            route_rows,
        )
    )
    counts["transit_routes"] = len(route_rows)

    stop_rows = []
    stop_index = 0
    stop_sources = [
        (
            HELLO / "data/Перелік зупинок на тролейбусних маршрутах/zupyn_stop_2024-12-23.csv",
            "utf-8-sig",
        ),
        (
            HELLO / "data/Перелік зупинок на тролейбусних маршрутах/troll_stops.csv",
            "cp1251",
        ),
    ]
    for path, encoding in stop_sources:
        if not path.exists():
            continue
        for row in read_csv(path, encoding=encoding):
            number = (row.get("route_number") or row.get("№ маршруту") or "").replace("№", "").strip()
            if not number:
                continue
            street = first(row, ["route_stop_str", "Вулиця"]) or ""
            stop_name = first(row, ["route_stop_name", "Зупинка", "route_stop_str"]) or ""
            if not stop_name:
                continue
            stop_index += 1
            search_text = normalize(f"{street} {stop_name}")
            key = normalize_street(street) or normalize_street(stop_name)
            point = street_centroids.get(key)
            if point is None:
                # Try matching the first significant word of the stop name.
                for token in normalize_street(stop_name).split():
                    if len(token) >= 4 and token in street_centroids:
                        point = street_centroids[token]
                        break
            stop_rows.append(
                (
                    number,
                    stop_name,
                    search_text,
                    street,
                    stop_index,
                    point[0] if point else None,
                    point[1] if point else None,
                    "city transport open data",
                )
            )
    outputs.extend(
        iter_inserts(
            "transit_stop",
            ["route_number", "stop_name", "search_text", "street", "sequence", "lat", "lon", "source"],
            stop_rows,
            chunk_size=200,
        )
    )
    counts["transit_stops"] = len(stop_rows)

    # --- fairs --------------------------------------------------------------
    fair_path = HELLO / "data/Відомості про ярмарки (строк проведення, місце, кількість та вартість місць), організаторів ярмарк/fairs-2024-07-07.csv"
    fair_rows = []
    if fair_path.exists():
        for index, row in enumerate(read_csv(fair_path)):
            title = first(row, ["name"])
            start = first(row, ["startDate"])
            if not title or not start:
                continue
            place = ", ".join(
                filter(
                    None,
                    [
                        first(row, ["addressThoroughfare"]),
                        first(row, ["addressLocatorBuilding"]),
                        first(row, ["addressPostName"]),
                    ],
                )
            )
            fair_rows.append(
                (
                    f"fair-{index}",
                    title,
                    start,
                    first(row, ["endDate"]),
                    place or None,
                    first(row, ["organizerName"]),
                    first(row, ["url"]),
                    "data.gov.ua fairs dataset",
                )
            )
    outputs.extend(
        iter_inserts(
            "event_fair",
            ["id", "title", "start_date", "end_date", "place", "organizer", "source_url", "source"],
            fair_rows,
        )
    )
    counts["fairs"] = len(fair_rows)

    # --- metadata -----------------------------------------------------------
    metadata = {
        "financial_snapshot": "2026-10-01",
        "catalog_snapshot": "2026-10-27",
        "geoportal_snapshot": "2026-10-28",
        "generated_at": manifest["generated_at"],
        "hello_data": str(HELLO),
        "notes": "Individuals and sole proprietors are anonymised in derived tables.",
    }
    outputs.extend(
        iter_inserts(
            "data_snapshot",
            ["key", "value"],
            [(key, value) for key, value in metadata.items()],
        )
    )

    (SEED_DIR / "manifest.json").write_text(
        json.dumps({**manifest, "counts": counts}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (SEED_DIR / "seed.sql").write_text("".join(outputs), encoding="utf-8")
    print(json.dumps({"seed": str(SEED_DIR / "seed.sql"), "counts": counts}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
