"""
Data export endpoints — mounted at /api/v1/submissions/export/.

Formats:
  GET /csv       — flat CSV, one row per submission (all field types handled)
  GET /geojson   — GeoJSON FeatureCollection of all geopoint / geotrace / route values
  GET /gpx       — GPX tracks for all route fields
  GET /media     — ZIP containing all uploaded media files + index.csv
  GET /package   — full ZIP: CSV + repeat CSVs + GeoJSON + GPX + media

Query parameters (all endpoints):
  form_id   required  — which form to export
  from      optional  — filter by collected_at >= date (ISO 8601)
  to        optional  — filter by collected_at <= date (ISO 8601)
"""

import asyncio
import csv
import io
import json
import os
import zipfile
from datetime import date, datetime
from html import escape as _xml_escape
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_db
from app.models.core import Form, FormVersion, MediaFile, Project, Submission, User

router = APIRouter()

MEDIA_ROOT = os.environ.get("MEDIA_ROOT", "/media")
_SKIP = frozenset({"note", "divider"})
_MEDIA = frozenset({"photo", "audio", "signature", "file"})
_LOCATION = frozenset({"geopoint", "geotrace", "route"})


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------

def _flatten(fields: list) -> list:
    """Recursively flatten group children; exclude notes, dividers, and groups themselves."""
    out = []
    for f in fields:
        ft = f.get("type", "")
        if ft in _SKIP:
            continue
        if ft == "group":
            out.extend(_flatten(f.get("fields", [])))
        else:
            out.append(f)
    return out


def _col_names(label: str, ftype: str) -> list[str]:
    """Column header(s) for a field in the main CSV."""
    if ftype == "geopoint":
        return [
            f"{label} (Latitude)", f"{label} (Longitude)",
            f"{label} (Accuracy m)", f"{label} (Altitude m)",
        ]
    if ftype == "geotrace":
        return [f"{label} (Points)", f"{label} (WKT)"]
    if ftype == "route":
        return [
            f"{label} (Points)", f"{label} (Distance m)",
            f"{label} (Duration s)", f"{label} (Started at)", f"{label} (WKT)",
        ]
    if ftype == "select_one_other":
        return [label, f"{label} (Other text)"]
    if ftype == "repeat":
        return [f"{label} (Count)"]
    return [label]


def _build_col_map(fields: list) -> tuple[list[str], dict[str, list[str]]]:
    """
    Returns (ordered_column_names, {field_id: [col_names]}).
    Uses field labels as headers; appends (field_id) to deduplicate.
    """
    flat = _flatten(fields)
    seen: dict[str, int] = {}
    col_map: dict[str, list[str]] = {}
    all_cols: list[str] = []

    for f in flat:
        fid = f["id"]
        ftype = f.get("type", "")
        label = (f.get("label") or fid).strip()
        if label in seen:
            seen[label] += 1
            label = f"{label} ({fid})"
        else:
            seen[label] = 1
        cols = _col_names(label, ftype)
        col_map[fid] = cols
        all_cols.extend(cols)

    return all_cols, col_map


def _points_to_wkt(points: list) -> str:
    if not isinstance(points, list) or len(points) < 2:
        return ""
    pairs = [
        f"{p.get('longitude', 0)} {p.get('latitude', 0)}"
        for p in points
        if isinstance(p, dict)
    ]
    return f"LINESTRING ({', '.join(pairs)})" if len(pairs) >= 2 else ""


def _cell_values(
    ftype: str,
    col_names: list[str],
    raw,
    media_for_field: list,
) -> dict:
    """Map one field's raw value to its CSV cell(s)."""
    if ftype == "geopoint":
        if isinstance(raw, dict):
            return dict(zip(col_names, [
                raw.get("latitude", ""), raw.get("longitude", ""),
                raw.get("accuracy", ""), raw.get("altitude", ""),
            ]))
        return dict(zip(col_names, ["", "", "", ""]))

    if ftype == "geotrace":
        pts = raw if isinstance(raw, list) else []
        return dict(zip(col_names, [len(pts), _points_to_wkt(pts)]))

    if ftype == "route":
        if isinstance(raw, dict):
            pts = raw.get("points", [])
            return dict(zip(col_names, [
                len(pts),
                raw.get("distance_meters", ""),
                raw.get("duration_seconds", ""),
                raw.get("started_at", ""),
                _points_to_wkt(pts),
            ]))
        return dict(zip(col_names, ["", "", "", "", ""]))

    if ftype == "select_multiple":
        val = "|".join(str(v) for v in raw) if isinstance(raw, list) else (raw or "")
        return {col_names[0]: val}

    if ftype == "select_one_other":
        if isinstance(raw, dict):
            return dict(zip(col_names, [
                raw.get("selection", ""), raw.get("other_text", ""),
            ]))
        return dict(zip(col_names, [raw or "", ""]))

    if ftype == "repeat":
        return {col_names[0]: len(raw) if isinstance(raw, list) else ""}

    if ftype in _MEDIA:
        if media_for_field:
            val = "|".join(mf.id for mf in media_for_field)
        elif raw:
            val = "[upload_missing]"
        else:
            val = ""
        return {col_names[0]: val}

    return {col_names[0]: raw if raw is not None else ""}


# ---------------------------------------------------------------------------
# CSV builders
# ---------------------------------------------------------------------------

def _build_main_csv(
    fields: list,
    submissions: list,
    media_index: dict,
    user_emails: dict,
) -> str:
    flat = _flatten(fields)
    all_cols, col_map = _build_col_map(fields)
    meta = ["submission_id", "submitted_by", "collected_at", "submitted_at", "form_version"]
    fieldnames = meta + all_cols

    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()

    for sub in submissions:
        row: dict = {
            "submission_id": sub.id,
            "submitted_by": user_emails.get(sub.user_id or "", ""),
            "collected_at": sub.collected_at.isoformat() if sub.collected_at else "",
            "submitted_at": sub.submitted_at.isoformat(),
            "form_version": "",
        }
        data = sub.data_json or {}
        for f in flat:
            fid = f["id"]
            ftype = f.get("type", "")
            cols = col_map.get(fid)
            if not cols:
                continue
            row.update(_cell_values(ftype, cols, data.get(fid), media_index.get((sub.id, fid), [])))
        writer.writerow(row)

    return out.getvalue()


def _build_repeat_csv(repeat_field: dict, submissions: list) -> str:
    """CSV for one repeat group: submission_id, repeat_index, then child field columns."""
    child_fields = repeat_field.get("fields", [])
    all_cols, col_map = _build_col_map(child_fields)
    flat_children = _flatten(child_fields)
    fieldnames = ["submission_id", "repeat_index"] + all_cols

    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()

    for sub in submissions:
        instances = (sub.data_json or {}).get(repeat_field["id"])
        if not isinstance(instances, list):
            continue
        for idx, instance in enumerate(instances):
            if not isinstance(instance, dict):
                continue
            row: dict = {"submission_id": sub.id, "repeat_index": idx}
            for f in flat_children:
                fid = f["id"]
                ftype = f.get("type", "")
                cols = col_map.get(fid)
                if not cols:
                    continue
                row.update(_cell_values(ftype, cols, instance.get(fid), []))
            writer.writerow(row)

    return out.getvalue()


# ---------------------------------------------------------------------------
# GeoJSON builder
# ---------------------------------------------------------------------------

def _build_geojson(fields: list, submissions: list) -> str:
    flat = _flatten(fields)
    loc_fields = [f for f in flat if f.get("type") in _LOCATION]
    if not loc_fields:
        return json.dumps({"type": "FeatureCollection", "features": []})

    features = []
    for sub in submissions:
        data = sub.data_json or {}
        for f in loc_fields:
            fid = f["id"]
            ftype = f.get("type", "")
            raw = data.get(fid)
            if not raw:
                continue
            feat = _make_feature(fid, f.get("label", fid), ftype, raw, sub)
            if feat:
                features.append(feat)

    return json.dumps({"type": "FeatureCollection", "features": features}, default=str)


def _make_feature(fid: str, label: str, ftype: str, raw, sub) -> Optional[dict]:
    props_base = {
        "submission_id": sub.id,
        "field_id": fid,
        "field_label": label,
        "collected_at": sub.collected_at.isoformat() if sub.collected_at else None,
    }

    if ftype == "geopoint" and isinstance(raw, dict):
        lat, lon = raw.get("latitude"), raw.get("longitude")
        if lat is None or lon is None:
            return None
        alt = raw.get("altitude")
        coords = [lon, lat, alt] if alt is not None else [lon, lat]
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": coords},
            "properties": {**props_base, "accuracy_m": raw.get("accuracy"), "captured_at": raw.get("captured_at")},
        }

    if ftype == "geotrace" and isinstance(raw, list) and len(raw) >= 2:
        coords = [[p.get("longitude"), p.get("latitude")] for p in raw if isinstance(p, dict)]
        if len(coords) < 2:
            return None
        return {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                **props_base,
                "point_count": len(coords),
                "timestamps": [p.get("timestamp") for p in raw if isinstance(p, dict)],
            },
        }

    if ftype == "route" and isinstance(raw, dict):
        pts = raw.get("points", [])
        if len(pts) < 2:
            return None
        coords = [
            [p.get("longitude"), p.get("latitude"), p.get("altitude")]
            for p in pts if isinstance(p, dict)
        ]
        return {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                **props_base,
                "started_at": raw.get("started_at"),
                "ended_at": raw.get("ended_at"),
                "distance_meters": raw.get("distance_meters"),
                "duration_seconds": raw.get("duration_seconds"),
                "point_count": len(pts),
                "pauses": raw.get("pauses", []),
            },
        }

    return None


# ---------------------------------------------------------------------------
# GPX builder
# ---------------------------------------------------------------------------

def _build_gpx(fields: list, submissions: list) -> str:
    flat = _flatten(fields)
    route_fields = [f for f in flat if f.get("type") == "route"]
    if not route_fields:
        return '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Questbee" xmlns="http://www.topografix.com/GPX/1/1"></gpx>'

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="Questbee" xmlns="http://www.topografix.com/GPX/1/1">']

    for sub in submissions:
        data = sub.data_json or {}
        for f in route_fields:
            fid = f["id"]
            raw = data.get(fid)
            if not isinstance(raw, dict):
                continue
            pts = raw.get("points", [])
            if not pts:
                continue
            segs = _route_segments(pts, raw.get("pauses", []))
            trk_name = _xml_escape(f"{sub.id[:8]} \u2014 {f.get('label', fid)}")
            lines.append("  <trk>")
            lines.append(f"    <name>{trk_name}</name>")
            for seg in segs:
                lines.append("    <trkseg>")
                for pt in seg:
                    lat, lon = pt.get("latitude", 0), pt.get("longitude", 0)
                    lines.append(f'      <trkpt lat="{lat}" lon="{lon}">')
                    if pt.get("altitude") is not None:
                        lines.append(f"        <ele>{pt['altitude']}</ele>")
                    if pt.get("timestamp"):
                        lines.append(f"        <time>{pt['timestamp']}</time>")
                    ext = []
                    if pt.get("speed") is not None:
                        ext.append(f"          <speed>{pt['speed']}</speed>")
                    if pt.get("heading") is not None:
                        ext.append(f"          <heading>{pt['heading']}</heading>")
                    if pt.get("accuracy") is not None:
                        ext.append(f"          <accuracy>{pt['accuracy']}</accuracy>")
                    if ext:
                        lines.append("        <extensions>")
                        lines.extend(ext)
                        lines.append("        </extensions>")
                    lines.append("      </trkpt>")
                lines.append("    </trkseg>")
            lines.append("  </trk>")

    lines.append("</gpx>")
    return "\n".join(lines)


def _route_segments(pts: list, pauses: list) -> list[list[dict]]:
    """Split a point list into GPX trkseg segments at pause boundaries."""
    if not pauses:
        return [pts]

    def _parse(s: str) -> Optional[datetime]:
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None

    pause_ranges = [
        (_parse(p.get("paused_at", "")), _parse(p.get("resumed_at", "")))
        for p in pauses
    ]

    segments: list[list[dict]] = []
    current: list[dict] = []
    for pt in pts:
        ts = _parse(pt.get("timestamp", ""))
        in_pause = ts and any(
            (p_start and ts >= p_start) and (p_end is None or ts <= p_end)
            for p_start, p_end in pause_ranges
        )
        if in_pause:
            if current:
                segments.append(current)
                current = []
        else:
            current.append(pt)
    if current:
        segments.append(current)
    return segments or [pts]


# ---------------------------------------------------------------------------
# Media index CSV
# ---------------------------------------------------------------------------

def _build_media_index(media_files: list, label_map: dict) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=[
        "media_file_id", "submission_id", "field_id", "field_label",
        "filename_in_zip", "mime_type", "size_bytes",
    ])
    writer.writeheader()
    for mf in media_files:
        orig = mf.storage_path.replace("\\", "/").split("/")[-1]
        writer.writerow({
            "media_file_id": mf.id,
            "submission_id": mf.submission_id,
            "field_id": mf.field_name,
            "field_label": label_map.get(mf.field_name, mf.field_name),
            "filename_in_zip": f"media/{mf.submission_id[:8]}/{mf.field_name}_{mf.id}_{orig}",
            "mime_type": mf.mime_type,
            "size_bytes": mf.size_bytes,
        })
    return out.getvalue()


# ---------------------------------------------------------------------------
# README builder
# ---------------------------------------------------------------------------

def _build_readme(form_name: str, fields: list, export_date: str, count: int) -> str:
    flat = _flatten(fields)
    lines = [
        "Questbee Data Export",
        "====================",
        f"Form        : {form_name}",
        f"Exported    : {export_date}",
        f"Submissions : {count}",
        f"Coordinates : WGS 84 (EPSG:4326)",
        "",
        "Files in this package",
        "---------------------",
        "  <form>.csv                 Main data — one row per submission",
        "  <form>_<field>.csv         Repeat group rows (one file per repeat field, if any)",
        "  <form>_locations.geojson   Geopoint / geotrace / route geometries (if any)",
        "  <form>_routes.gpx          Route tracks with telemetry (if any route fields)",
        "  media/index.csv            Maps media_file_id → submission, field, filename",
        "  media/<sub_id>/            Media files grouped by submission",
        "",
        "Column notes",
        "------------",
        "  select_multiple    : pipe-separated values  (e.g. opt1|opt2)",
        "  select_one_other   : two columns — the selection value and the 'other' free text",
        "  geopoint           : four columns — latitude, longitude, accuracy (m), altitude (m)",
        "  geotrace / route   : summary columns in CSV; full geometry in GeoJSON / GPX",
        "  photo/audio/file   : pipe-separated media_file_id(s); match to media/index.csv",
        "  [upload_missing]   : submission received but media file was never uploaded from device",
        "  repeat             : count column; full repeat data in <form>_<field_id>.csv",
        "",
        "Field legend",
        "------------",
        f"  {'field_id':<32}  {'type':<22}  label",
        "  " + "-" * 70,
    ]
    for f in flat:
        lines.append(f"  {f['id']:<32}  {f.get('type', ''):<22}  {f.get('label', f['id'])}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Async query helpers
# ---------------------------------------------------------------------------

async def _get_form(form_id: str, tenant_id: str, db) -> tuple:
    result = await db.execute(
        select(Form).join(Project, Form.project_id == Project.id)
        .where(Form.id == form_id, Project.tenant_id == tenant_id)
    )
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    fields: list = []
    if form.current_version_id:
        vr = await db.execute(select(FormVersion).where(FormVersion.id == form.current_version_id))
        ver = vr.scalar_one_or_none()
        if ver:
            fields = ver.schema_json.get("fields", [])
    return form, fields


async def _get_submissions(form_id: str, db, from_date=None, to_date=None) -> list:
    stmt = (
        select(Submission)
        .join(FormVersion, Submission.form_version_id == FormVersion.id)
        .where(FormVersion.form_id == form_id)
        .order_by(Submission.submitted_at)
    )
    if from_date:
        stmt = stmt.where(Submission.collected_at >= from_date)
    if to_date:
        stmt = stmt.where(Submission.collected_at <= to_date)
    return (await db.execute(stmt)).scalars().all()


async def _get_media(sub_ids: list, db) -> tuple[dict, list]:
    """Returns (index: {(sub_id, field_name): [MediaFile]}, all_files: list)."""
    if not sub_ids:
        return {}, []
    files = (await db.execute(
        select(MediaFile).where(MediaFile.submission_id.in_(sub_ids))
    )).scalars().all()
    index: dict = {}
    for mf in files:
        index.setdefault((mf.submission_id, mf.field_name), []).append(mf)
    return index, list(files)


async def _get_emails(user_ids: set, db) -> dict:
    if not user_ids:
        return {}
    users = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    return {u.id: u.email for u in users}


# ---------------------------------------------------------------------------
# ZIP builders (sync, run in thread)
# ---------------------------------------------------------------------------

def _zip_media(all_files: list, index_csv: str, media_root: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("media/index.csv", index_csv)
        for mf in all_files:
            abs_path = os.path.join(media_root, mf.storage_path)
            if not os.path.exists(abs_path):
                continue
            orig = mf.storage_path.replace("\\", "/").split("/")[-1]
            arc = f"media/{mf.submission_id[:8]}/{mf.field_name}_{mf.id}_{orig}"
            with open(abs_path, "rb") as f:
                zf.writestr(arc, f.read())
    buf.seek(0)
    return buf.read()


def _zip_package(
    slug: str,
    main_csv: str,
    repeat_csvs: dict,
    geojson: Optional[str],
    gpx: Optional[str],
    all_files: list,
    index_csv: str,
    readme: str,
    media_root: str,
) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.txt", readme)
        zf.writestr(f"{slug}.csv", main_csv)
        for name, content in repeat_csvs.items():
            zf.writestr(name, content)
        if geojson:
            zf.writestr(f"{slug}_locations.geojson", geojson)
        if gpx:
            zf.writestr(f"{slug}_routes.gpx", gpx)
        zf.writestr("media/index.csv", index_csv)
        for mf in all_files:
            abs_path = os.path.join(media_root, mf.storage_path)
            if not os.path.exists(abs_path):
                continue
            orig = mf.storage_path.replace("\\", "/").split("/")[-1]
            arc = f"media/{mf.submission_id[:8]}/{mf.field_name}_{mf.id}_{orig}"
            with open(abs_path, "rb") as f:
                zf.writestr(arc, f.read())
    buf.seek(0)
    return buf.read()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def _slug(name: str) -> str:
    return name.lower().replace(" ", "_")[:40]


def _stream(data: bytes, media_type: str, filename: str) -> StreamingResponse:
    return StreamingResponse(
        iter([data]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/csv")
async def export_csv(
    form_id: str = Query(...),
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    form, fields = await _get_form(form_id, current_user.tenant_id, db)
    subs = await _get_submissions(form_id, db, from_date, to_date)
    media_idx, _ = await _get_media([s.id for s in subs], db)
    emails = await _get_emails({s.user_id for s in subs if s.user_id}, db)
    csv_str = _build_main_csv(fields, subs, media_idx, emails)
    return _stream(csv_str.encode(), "text/csv", f"{_slug(form.name)}_submissions.csv")


@router.get("/geojson")
async def export_geojson(
    form_id: str = Query(...),
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    form, fields = await _get_form(form_id, current_user.tenant_id, db)
    subs = await _get_submissions(form_id, db, from_date, to_date)
    geojson_str = _build_geojson(fields, subs)
    return _stream(
        geojson_str.encode(), "application/geo+json",
        f"{_slug(form.name)}_locations.geojson",
    )


@router.get("/gpx")
async def export_gpx(
    form_id: str = Query(...),
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    form, fields = await _get_form(form_id, current_user.tenant_id, db)
    subs = await _get_submissions(form_id, db, from_date, to_date)
    gpx_str = _build_gpx(fields, subs)
    return _stream(gpx_str.encode(), "application/gpx+xml", f"{_slug(form.name)}_routes.gpx")


@router.get("/media")
async def export_media(
    form_id: str = Query(...),
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    form, fields = await _get_form(form_id, current_user.tenant_id, db)
    subs = await _get_submissions(form_id, db, from_date, to_date)
    _, all_files = await _get_media([s.id for s in subs], db)
    label_map = {f["id"]: f.get("label", f["id"]) for f in _flatten(fields)}
    index_csv = _build_media_index(all_files, label_map)
    zip_bytes = await asyncio.to_thread(_zip_media, all_files, index_csv, MEDIA_ROOT)
    return _stream(zip_bytes, "application/zip", f"{_slug(form.name)}_media.zip")


@router.get("/package")
async def export_package(
    form_id: str = Query(...),
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    form, fields = await _get_form(form_id, current_user.tenant_id, db)
    subs = await _get_submissions(form_id, db, from_date, to_date)
    sub_ids = [s.id for s in subs]
    media_idx, all_files = await _get_media(sub_ids, db)
    emails = await _get_emails({s.user_id for s in subs if s.user_id}, db)

    flat = _flatten(fields)
    label_map = {f["id"]: f.get("label", f["id"]) for f in flat}
    repeat_fields = [f for f in flat if f.get("type") == "repeat"]
    has_loc = any(f.get("type") in _LOCATION for f in flat)
    has_route = any(f.get("type") == "route" for f in flat)
    slug = _slug(form.name)
    export_date = datetime.utcnow().strftime("%Y-%m-%d")

    main_csv = _build_main_csv(fields, subs, media_idx, emails)
    repeat_csvs = {
        f"{slug}_{rf['id']}.csv": _build_repeat_csv(rf, subs)
        for rf in repeat_fields
    }
    geojson = _build_geojson(fields, subs) if has_loc or has_route else None
    gpx = _build_gpx(fields, subs) if has_route else None
    index_csv = _build_media_index(all_files, label_map)
    readme = _build_readme(form.name, fields, export_date, len(subs))

    zip_bytes = await asyncio.to_thread(
        _zip_package,
        slug, main_csv, repeat_csvs, geojson, gpx,
        all_files, index_csv, readme, MEDIA_ROOT,
    )
    return _stream(zip_bytes, "application/zip", f"{slug}_export_{export_date}.zip")
