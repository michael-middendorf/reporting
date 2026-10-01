"""Unit tests for the Virtuous Advancement Overview publisher (no network)."""
from __future__ import annotations

import datetime as dt
import io
import json
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from decimal import Decimal
from pathlib import Path
from unittest import mock

import handler
from handler import (
    ASK_PATH,
    FULL_GIFT_PATH,
    GROUP_PATH,
    PLANNED_PATH,
    PLEDGE_PATH_V2,
    allocate_gift,
    assemble_snapshot,
    build_fund_map,
    build_snapshot,
    contact_mgo_map,
    count_multi_year_pledges,
    count_planned_estate,
    count_realized_estate,
    fiscal_year_label,
    fiscal_year_window,
    VirtuousClient,
    fund_id_from_code,
    gift_ask_query,
    planned_gift_query,
    pledge_query,
    gift_mgo_last,
    gift_window_query,
    in_window,
    load_fund_rows,
    pipeline_rows,
    received_breakdown,
    resolve_api_key,
    shift_years,
    solicitor_last,
    ytd_windows,
)

FUNDS = [
    {"fund_id": "6102", "category": "Endowed Scholarship", "description": "General Endowed", "status": "Endowed"},
    {"fund_id": "6100", "category": "Temp - Scholarships", "description": "General Funded", "status": "Temporary Restricted"},
    {"fund_id": "6252", "category": "", "description": "Annual Fund", "status": "Unrestricted"},
    {"fund_id": "6404", "category": "Temp - Program Support", "description": "Library", "status": "Temporary Restricted"},
    {"fund_id": "6404", "category": "", "description": "Library", "status": "Unrestricted"},
    {"fund_id": "Plan", "category": "", "description": "Planned Giving", "status": "N/A"},
]
FUND_MAP, CONFLICTS = build_fund_map(FUNDS)


def des(code: str | None, amount: float, project: str = "Proj") -> dict:
    return {"externalAccountingCode": code, "amountDesignated": amount, "project": project}


def gift(gid, amount, day="2026-08-01", designations=None, contact=1, solicitor=None, segment=None) -> dict:
    row = {"id": gid, "amount": amount, "giftDate": day, "contactId": contact}
    if designations is not None:
        row["giftDesignations"] = designations
    if solicitor is not None:
        row["customFields"] = [{"name": "GFT_Solicitor", "value": solicitor}]
    if segment:
        row["segment"] = segment
    return row


def code(fund: str) -> str:
    return f"900-{fund}-4402-20-000"


class FundTests(unittest.TestCase):
    def test_fund_id_parsing(self):
        self.assertEqual(fund_id_from_code("900-6252-4402-20-000"), "6252")
        self.assertEqual(fund_id_from_code("  900-6100-1"), "6100")
        self.assertIsNone(fund_id_from_code(None))
        self.assertIsNone(fund_id_from_code(""))
        self.assertIsNone(fund_id_from_code("900-"))

    def test_6404_conflict_uses_categorized_row(self):
        self.assertEqual(FUND_MAP["6404"]["status"], "Temporary Restricted")
        self.assertEqual(
            CONFLICTS,
            [{
                "fundId": "6404",
                "description": "Library",
                "statuses": ["Temporary Restricted", "Unrestricted"],
                "used": "Temporary Restricted",
            }],
        )
        parts = allocate_gift(gift(1, 100, designations=[des(code("6404"), 100)]), FUND_MAP)
        self.assertEqual(parts[0][0], "temporaryRestricted")

    def test_committed_csv_loads_and_has_one_conflict(self):
        rows = load_fund_rows(Path(handler.__file__).resolve().parent / "fund_status.csv")
        fund_map, conflicts = build_fund_map(rows)
        self.assertEqual([c["fundId"] for c in conflicts], ["6404"])
        self.assertEqual(fund_map["6102"]["status"], "Endowed")
        for missing in ["6278", "6287", "6290", "6291", "6292", "6293", "6294", "6295", "6628"]:
            self.assertNotIn(missing, fund_map)

    def test_missing_csv_raises(self):
        with mock.patch.dict(os.environ, {"ADVANCEMENT_FUND_STATUS_CSV": ""}):
            with mock.patch.object(handler, "FUND_STATUS_FILE", "does-not-exist.csv"):
                with self.assertRaises(FileNotFoundError):
                    load_fund_rows()


class AllocationTests(unittest.TestCase):
    def test_single_status(self):
        out = received_breakdown([gift(1, 250, designations=[des(code("6102"), 250)])], FUND_MAP)
        self.assertEqual(out["endowed"], 250.0)
        self.assertEqual(out["total"], 250.0)
        self.assertEqual(out["unassigned"], 0.0)
        self.assertEqual(out["method"], "designation-allocated")

    def test_split_60_40(self):
        g = gift(1, 1000, designations=[des(code("6102"), 600), des(code("6252"), 400)])
        out = received_breakdown([g], FUND_MAP)
        self.assertEqual(out["endowed"], 600.0)
        self.assertEqual(out["unrestricted"], 400.0)
        self.assertEqual(out["total"], 1000.0)
        self.assertEqual(out["splitGiftCount"], 1)

    def test_unmapped_fund_goes_to_unassigned(self):
        g = gift(1, 500, designations=[des(code("6278"), 500, "New Fund")])
        out = received_breakdown([g], FUND_MAP)
        self.assertEqual(out["unassigned"], 500.0)
        self.assertEqual(out["unassignedFunds"], [{"fundId": "6278", "description": "New Fund", "amount": 500.0}])

    def test_na_status_and_missing_code_are_unassigned(self):
        g = gift(1, 300, designations=[des("900-Plan", 100), des(None, 200, "No Code")])
        out = received_breakdown([g], FUND_MAP)
        self.assertEqual(out["unassigned"], 300.0)

    def test_designations_exceeding_amount_are_scaled(self):
        g = gift(1, 1000, designations=[des(code("6102"), 1000), des(code("6100"), 1000)])
        out = received_breakdown([g], FUND_MAP)
        self.assertEqual(out["endowed"], 500.0)
        self.assertEqual(out["temporaryRestricted"], 500.0)
        self.assertEqual(out["total"], 1000.0)

    def test_no_designations(self):
        for designations in (None, [], [des(code("6102"), 0)]):
            out = received_breakdown([gift(1, 75, designations=designations)], FUND_MAP)
            self.assertEqual(out["unassigned"], 75.0)
            self.assertEqual(out["total"], 75.0)
        out = received_breakdown([gift(1, 75)], FUND_MAP)
        self.assertEqual(out["undesignatedGiftCount"], 1)
        self.assertEqual(out["unassignedFunds"][0]["fundId"], None)

    def test_buckets_sum_exactly_to_total(self):
        gifts = [
            gift(i, 100, designations=[des(code("6102"), 1), des(code("6100"), 1), des(code("6252"), 1)])
            for i in range(7)
        ]
        gifts.append(gift(99, "10.01", designations=[des(code("6102"), 1), des(code("6278"), 2)]))
        gifts.append(gift(100, 33.33))
        out = received_breakdown(gifts, FUND_MAP)
        d = out["decimal"]
        self.assertEqual(
            d["endowed"] + d["temporaryRestricted"] + d["unrestricted"] + d["unassigned"],
            d["total"],
        )
        self.assertEqual(d["total"], Decimal("743.34"))
        for key in ("endowed", "temporaryRestricted", "unrestricted", "unassigned"):
            self.assertEqual(d[key], d[key].quantize(Decimal("0.01")))


class MgoTests(unittest.TestCase):
    MEMBERS = [
        {"contactId": 10, "organizationGroupName": "Portfolio - James Thomas"},
        {"contactId": 11, "organizationGroupName": "Portfolio - Patrick O’Connell"},
        {"contactId": 11, "organizationGroupName": "Portfolio - Marita N. Emond"},
        {"contactId": 12, "organizationGroupName": "MA Portfolio - Someone Else"},
    ]

    def test_solicitor_wins(self):
        cmap = contact_mgo_map(self.MEMBERS)
        self.assertEqual(gift_mgo_last(gift(1, 1, contact=10, solicitor="Colleen Dolnick"), cmap), "Dolnick")

    def test_org_group_fallback(self):
        cmap = contact_mgo_map(self.MEMBERS)
        self.assertEqual(gift_mgo_last(gift(1, 1, contact=10), cmap), "Thomas")
        self.assertEqual(gift_mgo_last(gift(1, 1, contact=10, solicitor="  "), cmap), "Thomas")

    def test_unassigned(self):
        cmap = contact_mgo_map(self.MEMBERS)
        self.assertEqual(gift_mgo_last(gift(1, 1, contact=99), cmap), "Unassigned")
        # MA portfolios are not MGO portfolios.
        self.assertEqual(gift_mgo_last(gift(1, 1, contact=12), cmap), "Unassigned")

    def test_multi_group_is_deterministic(self):
        cmap = contact_mgo_map(self.MEMBERS)
        self.assertEqual(cmap["11"], "Emond")  # "Portfolio - Marita..." < "Portfolio - Patrick..."
        cmap_rev = contact_mgo_map(list(reversed(self.MEMBERS)))
        self.assertEqual(cmap_rev["11"], "Emond")

    def test_solicitor_last_normalizes(self):
        self.assertEqual(solicitor_last("Patrick O’Connell"), "O'Connell")
        self.assertEqual(solicitor_last("Sanford"), "Sanford")
        self.assertIsNone(solicitor_last(None))


class WindowTests(unittest.TestCase):
    def test_june_30_and_july_1(self):
        self.assertEqual(fiscal_year_window(dt.date(2027, 6, 30))[0], 2027)
        fy, start, end = fiscal_year_window(dt.date(2027, 7, 1))
        self.assertEqual((fy, start, end), (2028, dt.date(2027, 7, 1), dt.date(2028, 6, 30)))
        self.assertEqual(fiscal_year_label(2027), "FY 2026-27")

    def test_windows_inclusive(self):
        w = ytd_windows(dt.date(2026, 9, 29))
        self.assertEqual(w["current"], (dt.date(2026, 7, 1), dt.date(2026, 9, 29)))
        self.assertEqual(w["prior"], (dt.date(2025, 7, 1), dt.date(2025, 9, 29)))
        self.assertTrue(in_window(dt.date(2025, 9, 29), w["prior"]))
        self.assertFalse(in_window(dt.date(2025, 9, 30), w["prior"]))
        self.assertTrue(in_window(dt.date(2026, 7, 1), w["current"]))
        self.assertFalse(in_window(dt.date(2026, 6, 30), w["current"]))
        self.assertFalse(in_window(None, w["current"]))

    def test_july_1_windows(self):
        w = ytd_windows(dt.date(2026, 7, 1))
        self.assertEqual(w["current"], (dt.date(2026, 7, 1), dt.date(2026, 7, 1)))
        self.assertEqual(w["prior"], (dt.date(2025, 7, 1), dt.date(2025, 7, 1)))

    def test_june_30_windows(self):
        w = ytd_windows(dt.date(2027, 6, 30))
        self.assertEqual(w["current"], (dt.date(2026, 7, 1), dt.date(2027, 6, 30)))
        self.assertEqual(w["prior"], (dt.date(2025, 7, 1), dt.date(2026, 6, 30)))

    def test_shift_years_feb_29(self):
        self.assertEqual(shift_years(dt.date(2028, 2, 29), -1), dt.date(2027, 2, 28))

    def test_gift_query_has_one_group_per_window(self):
        body = gift_window_query([(dt.date(2025, 7, 1), dt.date(2025, 9, 29))])
        conds = body["groups"][0]["conditions"]
        self.assertEqual(conds[0], {"parameter": "Gift Date", "operator": "OnOrAfter", "value": "2025-07-01"})
        self.assertEqual(conds[1], {"parameter": "Gift Date", "operator": "OnOrBefore", "value": "2025-09-29"})


class PledgeEstatePipelineTests(unittest.TestCase):
    def test_multi_year_pledges(self):
        pledges = [
            {"pledgeDate": "2026-07-01", "frequency": "Annually"},
            {"pledgeDate": "2026-06-30", "frequency": "Annually"},
            {"pledgeDate": "2026-08-01", "frequency": "Monthly"},
            {"pledgeDate": "2027-01-01T00:00:00", "frequency": "Annually"},
        ]
        self.assertEqual(count_multi_year_pledges(pledges, dt.date(2026, 7, 1)), 2)

    def test_realized_and_planned_estate(self):
        gifts = [
            gift(1, 10, contact=5, segment="Realized Bequest"),
            gift(2, 10, contact=5, segment="Realized Bequest"),
            gift(3, 10, contact=6, segment="Realized Bequest"),
            gift(4, 10, contact=7, segment="Annual Fund"),
        ]
        self.assertEqual(count_realized_estate(gifts), 2)
        planned = [
            {"plannedGiftDate": "2026-07-02", "plannedGiftType": "WillAndBequest"},
            {"plannedGiftDate": "2026-07-02", "pkannedGiftType": "WillAndBequest"},
            {"plannedGiftDate": "2026-06-30", "plannedGiftType": "WillAndBequest"},
            {"plannedGiftDate": "2026-08-01", "plannedGiftType": "Annuity"},
        ]
        self.assertEqual(count_planned_estate(planned, dt.date(2026, 7, 1)), 2)

    def test_pipeline_status_and_date_filter(self):
        asks = [
            {"status": "Pending (MGO)", "askAmount": 100, "expectedFulfillmentDate": "2026-07-01"},
            {"status": "Pending (MGO)", "askAmount": 50, "expectedFulfillmentDate": "2027-06-30"},
            {"status": "Pending (MGO)", "askAmount": 999, "expectedFulfillmentDate": "2027-07-01"},
            {"status": "Pending (MGO)", "askAmount": 999, "expectedFulfillmentDate": "2026-06-30"},
            {"status": "Pending (MGO)", "askAmount": 999},
            {"status": "Declined (MGO)", "askAmount": 999, "expectedFulfillmentDate": "2026-08-01"},
            {"status": "Gift Received (Adv Svcs)", "askAmount": 999, "expectedFulfillmentDate": "2026-08-01"},
            {"status": "Prospect Research Review (Adv Svcs)", "askAmount": 999, "expectedFulfillmentDate": "2026-08-01"},
            {"status": "Pending Installment  / Annual Gift (MGO)", "askAmount": 10, "expectedFulfillmentDate": "2026-09-01"},
            {"status": "Cultivation / Gift Ask Strategy (MGO)", "askAmount": 5, "expectedFulfillmentDate": "2026-09-01"},
            {"status": "Zeta Custom", "askAmount": 1, "expectedFulfillmentDate": "2026-09-01"},
        ]
        rows, amount, count = pipeline_rows(asks, dt.date(2026, 7, 1), dt.date(2027, 6, 30))
        self.assertEqual(
            [r["status"] for r in rows],
            [
                "Cultivation / Gift Ask Strategy (MGO)",
                "Pending (MGO)",
                "Pending Installment  / Annual Gift (MGO)",
                "Zeta Custom",
            ],
        )
        self.assertEqual(rows[1], {"status": "Pending (MGO)", "amount": 150.0, "count": 2})
        self.assertEqual((amount, count), (166.0, 5))


class SnapshotTests(unittest.TestCase):
    def _snapshot(self) -> dict:
        today = dt.date(2026, 9, 29)
        gifts = [
            gift(1, 1000, "2026-07-01", [des(code("6102"), 600), des(code("6252"), 400)], contact=10),
            gift(2, 200, "2026-09-29", [des(code("6100"), 200)], contact=20, solicitor="Colleen Dolnick"),
            gift(3, 50, "2026-08-01", [des(code("6278"), 50)], contact=30, segment="Realized Bequest"),
            gift(4, 400, "2025-09-29", [des(code("6252"), 400)], contact=10),
            gift(5, 999, "2025-09-30", [des(code("6252"), 999)], contact=10),
            gift(6, 1, "2026-06-30", [des(code("6252"), 1)], contact=10),
        ]
        members = [{"contactId": 10, "organizationGroupName": "Portfolio - Ryan Sanford"}]
        return assemble_snapshot(
            today=today,
            generated_at="2026-09-29T12:00:00Z",
            gifts=gifts + [gifts[0]],
            members=members,
            pledges=[{"pledgeDate": "2026-08-01", "frequency": "Annually"}],
            planned=[{"plannedGiftDate": "2026-08-01", "plannedGiftType": "WillAndBequest"}],
            asks=[{"status": "Pending (MGO)", "askAmount": 10, "expectedFulfillmentDate": "2027-01-01"}],
            fund_rows=FUNDS,
        )

    def test_snapshot_shape_and_numbers(self):
        with redirect_stderr(io.StringIO()):
            snap = self._snapshot()
        self.assertEqual(snap["source"], "virtuous")
        self.assertNotIn("qlikAppId", snap)
        self.assertEqual(snap["fiscalYearLabel"], "FY 2026-27")
        self.assertEqual(snap["currentFiscalYear"], 2027)
        r = snap["received"]
        self.assertEqual(
            (r["endowed"], r["temporaryRestricted"], r["unrestricted"], r["unassigned"], r["total"]),
            (600.0, 200.0, 400.0, 50.0, 1250.0),
        )
        self.assertEqual(r["unassignedFunds"], [{"fundId": "6278", "description": "Proj", "amount": 50.0}])
        self.assertEqual(snap["conflictingFunds"][0]["fundId"], "6404")
        self.assertEqual(snap["ytd"]["overall"], {"current": 1250.0, "prior": 400.0, "difference": 850.0, "pct": 212.5})
        self.assertEqual(snap["ytd"]["mgoTeam"], {"current": 1200.0, "prior": 400.0, "difference": 800.0, "pct": 200.0})
        self.assertEqual(snap["ytd"]["activeDonors"], {"current": 3, "prior": 1, "difference": 2, "pct": 200.0})
        self.assertEqual(snap["officers"][0], {"name": "Totals", "amount": 1200.0, "isTotal": True})
        self.assertEqual(snap["officers"][1], {"name": "Sanford", "amount": 1000.0})
        self.assertEqual(snap["officers"][2], {"name": "Dolnick", "amount": 200.0})
        self.assertEqual(len(snap["officers"]), 1 + 8)
        self.assertEqual(snap["pledges"]["multiYear"], 1)
        self.assertEqual(snap["pledges"]["realizedEstate"], 1)
        self.assertEqual(snap["pledges"]["plannedEstate"], 1)
        self.assertEqual(snap["released"], {"fy26": None, "other": None, "total": 0, "note": "Actuals Updated 7/1/2026"})
        self.assertEqual(snap["pipeline"]["totalCount"], 1)
        json.dumps(snap)


class FakeClient:
    def __init__(self):
        self.calls: list[tuple[str, str, dict | None]] = []
        self.requests = 0

    def paged_query(self, path, body, page_size=1000):
        self.calls.append(("POST", path, body))
        if path == FULL_GIFT_PATH:
            return [gift(1, 100, "2026-08-01", [des(code("6102"), 100)], contact=1)]
        return []

    def paged_get(self, path, page_size=1000):
        self.calls.append(("GET", path, None))
        if path == GROUP_PATH:
            return [{"id": 7, "name": "Portfolio - James Thomas"}, {"id": 8, "name": "Board - Trustees"}]
        if path == f"{GROUP_PATH}/7/contacts":
            return [{"contactId": 1}]
        raise AssertionError(f"unexpected GET {path}")


class QueryBodyTests(unittest.TestCase):
    def test_pledge_query(self):
        self.assertEqual(
            pledge_query(dt.date(2026, 7, 1)),
            {"groups": [{"conditions": [
                {"parameter": "Pledge Date", "operator": "OnOrAfter", "value": "7/1/2026"},
            ]}]},
        )

    def test_planned_gift_query_is_unfiltered(self):
        # No planned-gift-date query option exists; filtering is local.
        self.assertEqual(planned_gift_query(), {"groups": []})

    def test_gift_ask_query(self):
        self.assertEqual(
            gift_ask_query(dt.date(2026, 7, 1), dt.date(2027, 6, 30)),
            {"groups": [{"conditions": [
                {"parameter": "Expected Fulfillment Date", "operator": "OnOrAfter", "value": "7/1/2026"},
                {"parameter": "Expected Fulfillment Date", "operator": "OnOrBefore", "value": "6/30/2027"},
            ]}], "sortBy": "Id", "descending": False},
        )

    def test_full_gift_query_two_windows(self):
        w = ytd_windows(dt.date(2026, 9, 29))
        body = gift_window_query([w["prior"], w["current"]])
        self.assertEqual(
            [[c["value"] for c in g["conditions"]] for g in body["groups"]],
            [["2025-07-01", "2025-09-29"], ["2026-07-01", "2026-09-29"]],
        )


class _Resp:
    def __init__(self, payload, status=200):
        self._body = json.dumps(payload).encode("utf-8")
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class ClientTests(unittest.TestCase):
    def _client(self, pages, **kw):
        client = VirtuousClient("secret-key", "https://example.invalid", **kw)
        seen = []

        def fake_urlopen(req, timeout):
            seen.append((req.full_url, timeout))
            item = pages[len(seen) - 1]
            if isinstance(item, Exception):
                raise item
            return _Resp(item)

        return client, seen, fake_urlopen

    def test_default_timeout_is_60s(self):
        self.assertEqual(VirtuousClient("k", "https://x").timeout, 60)

    def test_stops_on_short_page(self):
        client, seen, fake = self._client([{"list": [{"id": 1}, {"id": 2}], "total": 99}])
        err = io.StringIO()
        with mock.patch("urllib.request.urlopen", fake), redirect_stderr(err):
            rows = client.paged_query("/api/x", {"groups": [1]}, page_size=5)
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0][1], 60)
        line = err.getvalue()
        self.assertIn("POST /api/x skip=0 status=200", line)
        self.assertIn("rows=2", line)
        self.assertIn("elapsed=", line)
        self.assertNotIn("secret-key", line)
        self.assertEqual(client.requests, 1)

    def test_stops_when_total_missing(self):
        client, seen, fake = self._client([{"list": [{"id": 1}, {"id": 2}]}])
        with mock.patch("urllib.request.urlopen", fake), redirect_stderr(io.StringIO()):
            rows = client.paged_get("/api/g", page_size=2)
        self.assertEqual((len(rows), len(seen)), (2, 1))

    def test_pages_until_total(self):
        pages = [{"list": [{"id": 1}, {"id": 2}], "total": 4}, {"list": [{"id": 3}, {"id": 4}], "total": 4}]
        client, seen, fake = self._client(pages)
        with mock.patch("urllib.request.urlopen", fake), redirect_stderr(io.StringIO()):
            rows = client.paged_query("/api/x", {"groups": [1]}, page_size=2)
        self.assertEqual(len(rows), 4)
        self.assertIn("skip=2", seen[1][0])

    def test_page_cap_raises(self):
        pages = [{"list": [{"id": i}], "total": 10_000} for i in range(10)]
        client, _seen, fake = self._client(pages, max_pages=3)
        with mock.patch("urllib.request.urlopen", fake), redirect_stderr(io.StringIO()):
            with self.assertRaises(RuntimeError):
                client.paged_query("/api/x", {"groups": [1]}, page_size=1)

    def test_timeout_retries_once_then_raises(self):
        pages = [TimeoutError("slow"), TimeoutError("slow"), {"list": [], "total": 0}]
        client, seen, fake = self._client(pages)
        with mock.patch("urllib.request.urlopen", fake), mock.patch("time.sleep"), redirect_stderr(io.StringIO()):
            with self.assertRaises(RuntimeError):
                client.paged_query("/api/x", {"groups": [1]}, page_size=5)
        self.assertEqual(len(seen), 2)


class FetchTests(unittest.TestCase):
    def test_build_snapshot_calls_expected_endpoints(self):
        client = FakeClient()
        with redirect_stderr(io.StringIO()):
            snap = build_snapshot(client, dt.date(2026, 9, 29))
        paths = [(m, p) for m, p, _b in client.calls]
        self.assertEqual(
            paths,
            [
                ("POST", FULL_GIFT_PATH),
                ("GET", GROUP_PATH),
                ("GET", f"{GROUP_PATH}/7/contacts"),
                ("POST", PLEDGE_PATH_V2),
                ("POST", PLANNED_PATH),
                ("POST", ASK_PATH),
            ],
        )
        gift_body = client.calls[0][2]
        self.assertEqual(len(gift_body["groups"]), 2)
        self.assertEqual(client.calls[3][2], pledge_query(dt.date(2026, 7, 1)))
        self.assertEqual(client.calls[4][2], planned_gift_query())
        self.assertEqual(client.calls[5][2], gift_ask_query(dt.date(2026, 7, 1), dt.date(2027, 6, 30)))
        for _m, path, body in client.calls:
            if body is None:
                continue
            if path == PLANNED_PATH:
                # Exempt: PlannedGift QueryOptions has no planned-gift-date
                # parameter (live 2026-09-29) and there are only ~320 planned
                # gifts, so it is pulled whole and filtered locally.
                self.assertEqual(body, {"groups": []})
                continue
            self.assertTrue(body["groups"], "every other POST query must carry a server-side filter")
        self.assertEqual(snap["officers"][1], {"name": "Thomas", "amount": 100.0})

    def test_dry_run_prints_json_and_skips_s3(self):
        out = io.StringIO()
        with mock.patch.object(handler, "make_client", return_value=FakeClient()):
            with mock.patch.object(handler, "today_eastern", return_value=dt.date(2026, 9, 29)):
                with redirect_stdout(out), redirect_stderr(io.StringIO()):
                    code_ = handler.main(["--dry-run"])
        self.assertEqual(code_, 0)
        self.assertEqual(json.loads(out.getvalue())["source"], "virtuous")

    def test_api_key_from_sst_resource(self):
        env = {"VIRTUOUS_API_KEY": "", "SST_RESOURCE_VirtuousApiKey": json.dumps({"value": "k1"})}
        with mock.patch.dict(os.environ, env):
            self.assertEqual(resolve_api_key(), "k1")
        with mock.patch.dict(os.environ, {"VIRTUOUS_API_KEY": "", "SST_RESOURCE_VirtuousApiKey": ""}):
            with self.assertRaises(RuntimeError):
                resolve_api_key()


# --------------------------------------------------------------------------
# Pipeline detail (pipeline.json). All fixtures synthetic.
# --------------------------------------------------------------------------

PIPE_FUNDS = [
    {"fund_id": "6102", "category": "Endowed Scholarship", "description": "Sample Endowed", "status": "Endowed"},
    {"fund_id": "6103", "category": "Temp - Program Support", "description": "Sample Temp", "status": "Temporary Restricted"},
]


def ask(aid, status, amount=1000, expected="2026-10-01", contact=100, project_id=None, project=None,
        user="Pat Officer", notes=None, ask_date="2026-08-15"):
    return {
        "id": aid,
        "status": status,
        "askAmount": amount,
        "expectedFulfillmentDate": f"{expected}T00:00:00" if expected else None,
        "askDate": f"{ask_date}T00:00:00",
        "contactId": contact,
        "projectId": project_id,
        "project": project,
        "assignedUser": user,
        "notes": notes,
    }


def full_contact(cid, name="Sample Household", city="Sampletown", state="FL", primary=True):
    rec = {"id": cid, "name": name}
    if city is not None or state is not None:
        rec["address"] = {"city": city, "state": state, "isPrimary": primary}
    return rec


class PipelineDetailTests(unittest.TestCase):
    TODAY = dt.date(2026, 9, 30)

    def _assemble(self, asks, contacts=None, projects=None, missing=()):
        with redirect_stderr(io.StringIO()):
            return handler.assemble_pipeline(
                today=self.TODAY,
                generated_at="2026-09-30T12:00:00Z",
                asks=asks,
                contacts=contacts or {},
                projects=projects or {},
                fund_rows=PIPE_FUNDS,
                missing_contacts=missing,
            )

    def test_bucket_assignment_folds_whitespace(self):
        self.assertEqual(handler.pipeline_bucket_key("Cultivation / Gift Ask Strategy (MGO)"), "to_be_asked")
        self.assertEqual(handler.pipeline_bucket_key("Preparing Proposal / Agreement (MGO)"), "to_be_asked")
        self.assertEqual(handler.pipeline_bucket_key("Solicitation / Ask (MGO)"), "asked")
        self.assertEqual(handler.pipeline_bucket_key(" Pending (MGO) "), "asked")
        self.assertEqual(handler.pipeline_bucket_key("Accepted (MGO)"), "accepted")
        # Virtuous stores this one with a double space.
        self.assertEqual(handler.pipeline_bucket_key("Pending Installment  / Annual Gift (MGO)"), "accepted")

    def test_non_mgo_statuses_excluded_and_counted(self):
        asks = [
            ask(1, "Cultivation / Gift Ask Strategy (MGO)"),
            ask(2, "Declined (MGO)"),
            ask(3, "Gift Received (Adv Svcs)"),
            ask(4, "Cultivation"),
            ask(5, "Pending"),
        ]
        out = self._assemble(asks)
        self.assertEqual([b["count"] for b in out["buckets"]], [1, 0, 0])
        self.assertEqual(
            out["excludedStatuses"],
            {"Cultivation": 1, "Declined (MGO)": 1, "Gift Received (Adv Svcs)": 1, "Pending": 1},
        )

    def test_fy_window_inclusive_and_keeps_past_due(self):
        asks = [
            ask(1, "Pending (MGO)", expected="2026-07-01"),  # FY start, already past due
            ask(2, "Pending (MGO)", expected="2027-06-30"),  # FY end
            ask(3, "Pending (MGO)", expected="2026-06-30"),  # prior FY
            ask(4, "Pending (MGO)", expected="2027-07-01"),  # next FY
            ask(5, "Pending (MGO)", expected=None),
        ]
        out = self._assemble(asks)
        self.assertEqual(out["window"], {"start": "2026-07-01", "end": "2027-06-30"})
        self.assertEqual(out["fiscalYearLabel"], "FY 2026-27")
        asked = out["buckets"][1]
        self.assertEqual(sorted(r["askId"] for r in asked["rows"]), [1, 2])

    def test_fy_window_rolls_with_today(self):
        with redirect_stderr(io.StringIO()):
            out = handler.assemble_pipeline(
                today=dt.date(2027, 7, 2), generated_at="x",
                asks=[ask(1, "Pending (MGO)", expected="2027-07-15"), ask(2, "Pending (MGO)", expected="2027-06-30")],
                contacts={}, projects={}, fund_rows=PIPE_FUNDS,
            )
        self.assertEqual(out["window"], {"start": "2027-07-01", "end": "2028-06-30"})
        self.assertEqual([r["askId"] for r in out["buckets"][1]["rows"]], [1])

    def test_totals_sort_and_row_fields(self):
        asks = [
            ask(1, "Accepted (MGO)", amount=500, notes="Line one\nLine two"),
            ask(2, "Accepted (MGO)", amount=2500, contact=101, user=None),
            ask(3, "Pending Installment  / Annual Gift (MGO)", amount=1000, contact=102),
        ]
        contacts = {100: full_contact(100, name="  Sample   Family "), 101: full_contact(101), 102: full_contact(102)}
        out = self._assemble(asks, contacts)
        acc = out["buckets"][2]
        self.assertEqual(acc["key"], "accepted")
        self.assertEqual(acc["label"], "Accepted: Waiting for Check")
        self.assertEqual((acc["count"], acc["totalAmount"]), (3, 4000.0))
        self.assertEqual([r["askAmount"] for r in acc["rows"]], [2500.0, 1000.0, 500.0])
        row = acc["rows"][2]
        self.assertEqual(row["donor"], "Sample Family")
        self.assertEqual(row["reason"], "Line one\nLine two")
        self.assertEqual(row["askDate"], "2026-08-15")
        self.assertEqual(row["expectedFulfillmentDate"], "2026-10-01")
        self.assertEqual(acc["rows"][0]["assignedUser"], None)
        self.assertEqual(acc["rows"][1]["status"], "Pending Installment / Annual Gift (MGO)")
        self.assertEqual(
            set(row),
            {"askId", "askDate", "donor", "contactId", "status", "askAmount", "expectedFulfillmentDate",
             "assignedUser", "reason", "city", "state", "fund", "fundClass"},
        )
        json.dumps(out)

    def test_primary_address_only(self):
        self.assertEqual(handler.primary_city_state(full_contact(1)), ("Sampletown", "FL"))
        self.assertEqual(handler.primary_city_state(full_contact(1, primary=None)), ("Sampletown", "FL"))
        self.assertEqual(handler.primary_city_state(full_contact(1, primary=False)), (None, None))
        self.assertEqual(handler.primary_city_state(full_contact(1, city=None, state=None)), (None, None))
        self.assertEqual(handler.primary_city_state(None), (None, None))
        self.assertEqual(handler.primary_city_state(full_contact(1, city=" ", state="OH")), (None, "OH"))

    def test_fund_class_by_accounting_code(self):
        _fund_map, _ = build_fund_map(PIPE_FUNDS)
        asks = [
            ask(1, "Pending (MGO)", project_id=11, project="Sample Endowed Fund"),
            ask(2, "Pending (MGO)", project_id=12, project="Sample Temp Fund"),
            ask(3, "Pending (MGO)", project_id=13, project="Sample Unmapped Fund"),
            ask(4, "Pending (MGO)"),
        ]
        projects = {
            # projectCode carries a suffix; the class keys off the accounting code.
            11: {"id": 11, "projectCode": "6103Suffix", "externalAccountingCode": code("6102")},
            12: {"id": 12, "projectCode": "6102", "externalAccountingCode": code("6103")},
            13: {"id": 13, "projectCode": "9999", "externalAccountingCode": code("9999")},
        }
        out = self._assemble(asks, projects=projects)
        by_id = {r["askId"]: r for r in out["buckets"][1]["rows"]}
        self.assertEqual((by_id[1]["fund"], by_id[1]["fundClass"]), ("Sample Endowed Fund", "Endowed"))
        self.assertEqual(by_id[2]["fundClass"], "Temporary Restricted")
        self.assertIsNone(by_id[3]["fundClass"])
        self.assertEqual((by_id[4]["fund"], by_id[4]["fundClass"]), (None, None))

    def test_duplicate_ask_ids_raise(self):
        with self.assertRaises(RuntimeError):
            self._assemble([ask(1, "Pending (MGO)"), ask(1, "Accepted (MGO)")])

    def test_missing_contact_gets_labelled_not_blank(self):
        out = self._assemble([ask(1, "Pending (MGO)", contact=555)], contacts={}, missing=[555])
        row = out["buckets"][1]["rows"][0]
        self.assertEqual(row["donor"], "Contact 555")
        self.assertEqual((row["city"], row["state"]), (None, None))
        self.assertEqual(out["missingContacts"], 1)


class PipelineClient:
    def __init__(self, fail_contacts=False):
        self.calls: list[tuple[str, dict]] = []
        self.requests = 0
        self.fail_contacts = fail_contacts

    def paged_query(self, path, body, page_size=1000):
        self.calls.append((path, body))
        self.requests += 1
        ids = [int(g["conditions"][0]["value"]) for g in body["groups"]]
        if path == handler.FULL_CONTACT_PATH:
            if self.fail_contacts:
                raise RuntimeError("Virtuous POST /api/Contact/Query/FullContact -> 500: boom")
            return [full_contact(i) for i in ids if i != 999]
        if path == handler.PROJECT_PATH:
            return [{"id": i, "externalAccountingCode": code("6102")} for i in ids]
        raise AssertionError(path)


class PipelineFetchTests(unittest.TestCase):
    def test_batched_contact_and_project_queries(self):
        asks = [ask(i, "Pending (MGO)", contact=1000 + i) for i in range(1, 151)]
        asks.append(ask(151, "Pending (MGO)", contact=999, project_id=7, project="Sample Fund"))
        asks.append(ask(152, "Declined (MGO)", contact=5000))  # excluded: no lookup
        client = PipelineClient()
        with redirect_stderr(io.StringIO()):
            out = handler.build_pipeline(client, dt.date(2026, 9, 30), asks, PIPE_FUNDS, "2026-09-30T12:00:00Z")
        paths = [p for p, _b in client.calls]
        self.assertEqual(paths, [handler.FULL_CONTACT_PATH, handler.FULL_CONTACT_PATH, handler.PROJECT_PATH])
        contact_ids = [int(g["conditions"][0]["value"]) for _p, b in client.calls[:2] for g in b["groups"]]
        self.assertNotIn(5000, contact_ids)
        self.assertEqual(len(contact_ids), 151)
        for _p, body in client.calls[:2]:
            self.assertTrue(body["includeArchived"])
            self.assertLessEqual(len(body["groups"]), handler.CONTACT_BATCH)
            self.assertEqual(body["groups"][0]["conditions"][0]["parameter"], "Contact Id")
        self.assertEqual(out["missingContacts"], 1)
        row = next(r for r in out["buckets"][1]["rows"] if r["askId"] == 151)
        self.assertEqual((row["donor"], row["fundClass"]), ("Contact 999", "Endowed"))

    def test_no_project_query_when_no_projects(self):
        client = PipelineClient()
        with redirect_stderr(io.StringIO()):
            handler.build_pipeline(client, dt.date(2026, 9, 30), [ask(1, "Pending (MGO)")], PIPE_FUNDS, "x")
        self.assertEqual([p for p, _b in client.calls], [handler.FULL_CONTACT_PATH])

    def test_contact_failure_is_loud(self):
        client = PipelineClient(fail_contacts=True)
        err = io.StringIO()
        ctx = {"asks": [ask(1, "Pending (MGO)")], "fund_rows": PIPE_FUNDS, "generated_at": "x"}
        with redirect_stderr(err):
            with self.assertRaises(RuntimeError):
                handler.build_pipeline_from(client, dt.date(2026, 9, 30), ctx)
        self.assertIn("ERROR pipeline detail failed: RuntimeError: Virtuous POST", err.getvalue())

    def test_handler_writes_overview_before_pipeline(self):
        puts = []

        def fake_put(key, payload):
            puts.append((key, payload))
            return f"s3://bucket/{key}"

        import types
        fake_mod = types.ModuleType("common.s3util")
        fake_mod.put_json = fake_put
        fake_pkg = types.ModuleType("common")
        with mock.patch.dict("sys.modules", {"common": fake_pkg, "common.s3util": fake_mod}):
            with mock.patch.object(handler, "make_client", return_value=FakeClient()):
                with mock.patch.object(handler, "today_eastern", return_value=dt.date(2026, 9, 29)):
                    with redirect_stderr(io.StringIO()):
                        result = handler.handler({}, None)
        self.assertEqual([k for k, _p in puts], [handler.CACHE_KEY, handler.PIPELINE_CACHE_KEY])
        self.assertNotIn("buckets", puts[0][1])
        self.assertEqual([b["key"] for b in puts[1][1]["buckets"]], ["to_be_asked", "asked", "accepted"])
        self.assertEqual(result["source"], "virtuous")


if __name__ == "__main__":
    unittest.main()
