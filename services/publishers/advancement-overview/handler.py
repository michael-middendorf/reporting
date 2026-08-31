"""FY Advancement Overview publisher.

Reads the published Qlik FY Advancement Overview / FY27 Results sheet via
the Engine API and writes ``advancement-overview/latest.json``.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import math
import os
from typing import Any

CACHE_KEY = os.environ.get("ADVANCEMENT_OVERVIEW_CACHE_KEY") or "advancement-overview/latest.json"
QLIK_APP_ID = os.environ.get("QLIK_ADVANCEMENT_APP_ID") or "a62f36c1-266e-4c71-95da-29ec2381a0d8"
QLIK_SHEET_ID = (
    os.environ.get("QLIK_ADVANCEMENT_SHEET_ID") or "bda0e031-ed48-4cbb-8539-bd05f0f4a88d"
)

PLEDGE_GOAL = 30
ESTATE_GOAL = 25
RELEASED_NOTE = "Actuals Updated 7/1/2026"

# Object ids on sheet bda0e031-ed48-4cbb-8539-bd05f0f4a88d (FY27 Results).
OBJECTS = {
    "endowed": "d0a93133-9236-4933-8dbc-1dd225572e78",
    "temp_restricted": "4b90dbc0-edcc-4917-8221-f6310daf2541",
    "unrestricted": "355b9390-952d-41d6-af6a-e67b670c8ef8",
    "total_received": "cee5075a-98f8-4648-99ac-4491c1a103ec",
    "released_fy26": "a03e0575-0729-4585-aa1e-a30d9454f4c5",
    "released_other": "02c7ac29-4f27-4727-ab31-6ad675afb7f2",
    "released_total": "a3689925-7dac-48fb-bde9-47952104dc82",
    "pledges": "34666072-edb8-45b4-bfde-89ccc4f6120c",
    "estate_realized": "b3fd6ee1-20a0-462e-bec3-2705f61a272d",
    "estate_planned": "51fc6d1b-8be4-4abc-bfaf-43827c2e99c2",
    "ytd_overall_cur": "2bde9479-5bfa-4b0b-893b-34641a85a1e9",
    "ytd_mgo_cur": "ee9a037e-6361-4ede-8d2c-5106287875cb",
    "ytd_donors_cur": "01255dd3-99ff-4aef-a312-fd3a98c3106f",
    "ytd_overall_prior": "79a6cf1e-30e8-4a62-a711-daa4d63ef2a7",
    "ytd_mgo_prior": "943c0835-a877-4980-81fb-a1f14d4e7165",
    "ytd_donors_prior": "fc779d11-8916-4883-9571-16d8c3baff14",
    "ytd_overall_diff": "749a6810-4b01-414c-b34d-7b76c70d353c",
    "ytd_mgo_diff": "1870c8b0-ec17-4436-976b-50c11646ab03",
    "ytd_donors_diff": "87950900-702c-4908-badc-829a8ad63695",
    "ytd_overall_pct": "219cc17b-04cd-4d3a-8c53-989f00b3f1be",
    "ytd_mgo_pct": "4ca62d44-a833-4e73-a199-498c1456ea21",
    "ytd_donors_pct": "095adbd2-a769-4687-adc0-09ab0d463168",
    "officers": "CaNSN",
    "pipeline": "3e9c63e3-abe0-4824-a615-cf02eb8e608a",
}


def fiscal_year_window(today: dt.date) -> tuple[int, dt.date, dt.date]:
    """AMU fiscal year ends June 30 and is named for the year it ends."""
    if today.month >= 7:
        start = dt.date(today.year, 7, 1)
        end = dt.date(today.year + 1, 6, 30)
        fy = today.year + 1
    else:
        start = dt.date(today.year - 1, 7, 1)
        end = dt.date(today.year, 6, 30)
        fy = today.year
    return fy, start, end


def fiscal_year_label(fy: int) -> str:
    return f"FY {fy - 1}-{str(fy)[2:]}"


def _is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not (isinstance(value, float) and math.isnan(value))


def _cell_num(cell: dict[str, Any] | None) -> float | None:
    if not cell:
        return None
    value = cell.get("qNum")
    if not _is_num(value):
        return None
    return float(value)


def _cell_text(cell: dict[str, Any] | None) -> str | None:
    if not cell:
        return None
    text = cell.get("qText")
    if text is None:
        return None
    text = str(text).strip()
    if text in ("", "-", "--"):
        return None
    return text


def _first_cell(layout: dict[str, Any]) -> dict[str, Any] | None:
    cube = layout.get("qHyperCube") or {}
    pages = cube.get("qDataPages") or []
    if pages:
        matrix = pages[0].get("qMatrix") or []
        if matrix and matrix[0]:
            return matrix[0][0]
    total_row = cube.get("qGrandTotalRow") or []
    if total_row:
        return total_row[0]
    return None


def kpi_number(layout: dict[str, Any]) -> float | None:
    return _cell_num(_first_cell(layout))


def kpi_pct(layout: dict[str, Any]) -> float | None:
    cell = _first_cell(layout)
    text = _cell_text(cell)
    if text and "%" in text:
        try:
            return float(text.replace("%", "").replace(",", "").strip())
        except ValueError:
            pass
    number = _cell_num(cell)
    if number is None:
        return None
    if abs(number) <= 5:
        return round(number * 100.0, 1)
    return number


def table_matrix(layout: dict[str, Any]) -> list[list[dict[str, Any]]]:
    cube = layout.get("qHyperCube") or {}
    pages = cube.get("qDataPages") or []
    if not pages:
        return []
    return list(pages[0].get("qMatrix") or [])


def officer_rows(layout: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    total = 0.0
    for matrix_row in table_matrix(layout):
        if len(matrix_row) < 2:
            continue
        name = _cell_text(matrix_row[0])
        amount = _cell_num(matrix_row[1])
        if not name:
            continue
        rows.append({"name": name, "amount": round(amount, 2) if amount is not None else None})
        if amount is not None:
            total += amount
    return [{"name": "Totals", "amount": round(total, 2), "isTotal": True}, *rows]


def pipeline_rows(layout: dict[str, Any]) -> tuple[list[dict[str, Any]], float, int]:
    rows: list[dict[str, Any]] = []
    total_amount = 0.0
    total_count = 0
    for matrix_row in table_matrix(layout):
        if len(matrix_row) < 3:
            continue
        status = _cell_text(matrix_row[0])
        amount = _cell_num(matrix_row[1])
        count = _cell_num(matrix_row[2])
        if not status:
            continue
        count_int = int(count) if count is not None else 0
        rows.append({
            "status": status,
            "amount": round(amount, 2) if amount is not None else None,
            "count": count_int,
        })
        if amount is not None:
            total_amount += amount
        total_count += count_int
    return rows, round(total_amount, 2), total_count


def _ytd_row(
    current: float | None,
    prior: float | None,
    difference: float | None,
    pct: float | None,
) -> dict[str, Any]:
    return {
        "current": None if current is None else round(current, 2),
        "prior": None if prior is None else round(prior, 2),
        "difference": None if difference is None else round(difference, 2),
        "pct": pct,
    }


def snapshot_from_layouts(
    layouts: dict[str, dict[str, Any]],
    *,
    today: dt.date,
    generated_at: str,
) -> dict[str, Any]:
    missing = [name for name in OBJECTS if name not in layouts]
    if missing:
        raise RuntimeError(f"Qlik overview missing objects: {', '.join(missing)}")

    fy, _start, _end = fiscal_year_window(today)
    officers = officer_rows(layouts["officers"])
    pipe_rows, pipe_amount, pipe_count = pipeline_rows(layouts["pipeline"])
    snapshot = {
        "generated_at": generated_at,
        "source": "qlik",
        "qlikAppId": QLIK_APP_ID,
        "qlikSheetId": QLIK_SHEET_ID,
        "currentFiscalYear": fy,
        "fiscalYearLabel": fiscal_year_label(fy),
        "asOf": today.isoformat(),
        "received": {
            "endowed": kpi_number(layouts["endowed"]),
            "temporaryRestricted": kpi_number(layouts["temp_restricted"]),
            "unrestricted": kpi_number(layouts["unrestricted"]),
            "total": kpi_number(layouts["total_received"]),
        },
        "released": {
            "fy26": kpi_number(layouts["released_fy26"]),
            "other": kpi_number(layouts["released_other"]),
            "total": kpi_number(layouts["released_total"]),
            "note": RELEASED_NOTE,
        },
        "pledges": {
            "multiYear": kpi_number(layouts["pledges"]),
            "multiYearGoal": PLEDGE_GOAL,
            "realizedEstate": kpi_number(layouts["estate_realized"]),
            "realizedEstateGoal": ESTATE_GOAL,
            "plannedEstate": kpi_number(layouts["estate_planned"]),
        },
        "ytd": {
            "currentLabel": f"FY{fy}",
            "priorLabel": f"FY{fy - 1}",
            "overall": _ytd_row(
                kpi_number(layouts["ytd_overall_cur"]),
                kpi_number(layouts["ytd_overall_prior"]),
                kpi_number(layouts["ytd_overall_diff"]),
                kpi_pct(layouts["ytd_overall_pct"]),
            ),
            "mgoTeam": _ytd_row(
                kpi_number(layouts["ytd_mgo_cur"]),
                kpi_number(layouts["ytd_mgo_prior"]),
                kpi_number(layouts["ytd_mgo_diff"]),
                kpi_pct(layouts["ytd_mgo_pct"]),
            ),
            "activeDonors": _ytd_row(
                kpi_number(layouts["ytd_donors_cur"]),
                kpi_number(layouts["ytd_donors_prior"]),
                kpi_number(layouts["ytd_donors_diff"]),
                kpi_pct(layouts["ytd_donors_pct"]),
            ),
        },
        "officers": officers,
        "pipeline": {
            "rows": pipe_rows,
            "totalAmount": pipe_amount,
            "totalCount": pipe_count,
        },
    }
    print(
        f"  {snapshot['fiscalYearLabel']} total={snapshot['received']['total']} "
        f"unrestricted={snapshot['received']['unrestricted']} "
        f"pledges={snapshot['pledges']['multiYear']} "
        f"estate={snapshot['pledges']['realizedEstate']} "
        f"pipeline={pipe_count}",
        flush=True,
    )
    return snapshot


class QlikEngine:
    def __init__(self, api_key: str, tenant: str, app_id: str, timeout: int = 30):
        self.api_key = api_key
        self.tenant = tenant.rstrip("/")
        self.app_id = app_id
        self.timeout = timeout

    async def fetch_layouts(self, object_ids: dict[str, str]) -> dict[str, dict[str, Any]]:
        import websockets

        url = f"wss://{self.tenant}/app/{self.app_id}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        mid = 0

        async with websockets.connect(
            url,
            additional_headers=headers,
            open_timeout=20,
            max_size=None,
        ) as ws:
            await asyncio.wait_for(ws.recv(), timeout=15)

            async def rpc(method: str, handle: int, params: dict[str, Any]) -> dict[str, Any]:
                nonlocal mid
                mid += 1
                message_id = mid
                await ws.send(
                    json.dumps({
                        "jsonrpc": "2.0",
                        "id": message_id,
                        "method": method,
                        "handle": handle,
                        "params": params,
                    })
                )
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=self.timeout)
                    resp = json.loads(raw)
                    if resp.get("id") != message_id:
                        continue
                    if "error" in resp:
                        raise RuntimeError(
                            f"Qlik {method} failed: {json.dumps(resp['error'])[:400]}"
                        )
                    return resp

            opened = await rpc("OpenDoc", -1, {"qDocName": self.app_id})
            doc = ((opened.get("result") or {}).get("qReturn") or {})
            doc_handle = doc.get("qHandle")
            if not doc_handle:
                raise RuntimeError("Qlik OpenDoc did not return a document handle")

            layouts: dict[str, dict[str, Any]] = {}
            for name, object_id in object_ids.items():
                got = await rpc("GetObject", doc_handle, {"qId": object_id})
                handle = ((got.get("result") or {}).get("qReturn") or {}).get("qHandle")
                if not handle:
                    raise RuntimeError(f"Qlik GetObject missed {name} ({object_id})")
                laid = await rpc("GetLayout", handle, {})
                layout = (laid.get("result") or {}).get("qLayout")
                if not isinstance(layout, dict):
                    raise RuntimeError(f"Qlik GetLayout empty for {name} ({object_id})")
                layouts[name] = layout
            return layouts


def build_snapshot(layouts: dict[str, dict[str, Any]], today: dt.date) -> dict[str, Any]:
    generated_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return snapshot_from_layouts(layouts, today=today, generated_at=generated_at)


def handler(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    del event, context
    api_key = (os.environ.get("QLIK_API_KEY") or "").strip()
    tenant = (os.environ.get("QLIK_TENANT") or "").strip()
    if not api_key or not tenant:
        raise RuntimeError("QLIK_API_KEY and QLIK_TENANT are required")
    print(f"  fetching Qlik app {QLIK_APP_ID} sheet {QLIK_SHEET_ID}…", flush=True)
    engine = QlikEngine(api_key, tenant, QLIK_APP_ID)
    layouts = asyncio.run(engine.fetch_layouts(OBJECTS))
    snapshot = build_snapshot(layouts, dt.datetime.now(dt.timezone.utc).date())
    from common.s3util import put_json

    uri = put_json(CACHE_KEY, snapshot)
    snapshot["cache"] = uri
    return snapshot
