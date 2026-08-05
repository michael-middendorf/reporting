from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class VirtuousError(RuntimeError):
    pass


@dataclass
class RateLimitSnapshot:
    limit: str | None = None
    remaining: str | None = None
    reset: str | None = None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "limit": self.limit,
            "remaining": self.remaining,
            "reset": self.reset,
        }


class VirtuousClient:
    def __init__(self, base_url: str, api_key: str, timeout_seconds: int = 120) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.rate_limit = RateLimitSnapshot()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _record_rate_limit(self, headers: Any) -> None:
        self.rate_limit = RateLimitSnapshot(
            limit=headers.get("X-RateLimit-Limit"),
            remaining=headers.get("X-RateLimit-Remaining"),
            reset=headers.get("X-RateLimit-Reset"),
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: Any | None = None,
        timeout_seconds: int | None = None,
        retries: int = 6,
    ) -> Any:
        url = f"{self.base_url}{path}"
        if params:
            encoded = urllib.parse.urlencode(params)
            url = f"{url}?{encoded}"
        data = None if body is None else json.dumps(body).encode("utf-8")
        timeout = timeout_seconds or self.timeout_seconds

        for attempt in range(retries):
            request = urllib.request.Request(
                url,
                data=data,
                method=method.upper(),
                headers=self._headers(),
            )
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    self._record_rate_limit(response.headers)
                    return json.load(response)
            except urllib.error.HTTPError as exc:
                status = exc.code
                if status in RETRYABLE_STATUS_CODES and attempt < retries - 1:
                    time.sleep(self._retry_wait_seconds(exc.headers, attempt))
                    continue
                body_text = exc.read().decode("utf-8", errors="replace")
                raise VirtuousError(f"{method.upper()} {path} -> {status}: {body_text[:400]}") from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                if attempt < retries - 1:
                    time.sleep(min(30, 2 * (attempt + 1)))
                    continue
                raise VirtuousError(f"{method.upper()} {path} failed: {exc}") from exc
        raise VirtuousError(f"{method.upper()} {path} failed after {retries} attempts.")

    def _retry_wait_seconds(self, headers: Any, attempt: int) -> int:
        retry_after = headers.get("Retry-After")
        if retry_after:
            try:
                return max(1, int(float(retry_after)))
            except ValueError:
                pass
        return min(60, 5 * (attempt + 1))

    def get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        return self.request("GET", path, params=params)

    def post(
        self,
        path: str,
        body: dict[str, Any],
        *,
        params: dict[str, Any] | None = None,
        timeout_seconds: int | None = None,
        retries: int = 6,
    ) -> Any:
        return self.request(
            "POST",
            path,
            params=params,
            body=body,
            timeout_seconds=timeout_seconds,
            retries=retries,
        )

    def paged_query(
        self,
        path: str,
        body: dict[str, Any],
        *,
        page_size: int = 500,
        timeout_seconds: int | None = None,
        max_records: int | None = None,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        skip = 0
        while True:
            payload = self.post(
                path,
                body,
                params={"skip": skip, "take": page_size},
                timeout_seconds=timeout_seconds,
            )
            page = payload.get("list", [])
            total = payload.get("total", 0)
            rows.extend(page)
            skip += page_size
            if max_records is not None and len(rows) >= max_records:
                return rows[:max_records]
            if not page or skip >= total:
                return rows
