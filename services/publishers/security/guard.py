"""Last-line-of-defense scan before anything from this publisher reaches S3.

The cybersecurity dashboard intentionally lists AMU's weaknesses in one
place (counts and statuses only), which makes the object itself a
high-value target. This module walks the fully composed JSON document and
refuses to let it be written if it contains anything that looks like an
email address, an IPv4 address, an AWS ARN, or an AWS access key id.

On a hit, only the JSON path and the pattern name are logged/raised, never
the matched value.
"""
from __future__ import annotations

import re
from typing import Any

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
IPV4_RE = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b")
ARN_RE = re.compile(r"\barn:aws[a-zA-Z0-9\-]*:[a-zA-Z0-9\-]*:[a-zA-Z0-9\-]*:\d{0,12}:\S+")
# IAM/STS/etc. access key id prefixes (AKIA, ASIA, AGPA, AIDA, AROA, AIPA, ANPA, ANVA, ASCA).
AWS_ACCESS_KEY_RE = re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b")

PATTERNS: dict[str, re.Pattern[str]] = {
    "email": EMAIL_RE,
    "ipv4": IPV4_RE,
    "arn": ARN_RE,
    "aws_access_key": AWS_ACCESS_KEY_RE,
}


class GuardViolation(RuntimeError):
    """Raised when sensitive-looking content is found; never put the match in the message."""


def scan(obj: Any, path: str = "$") -> list[tuple[str, str]]:
    """Return a list of (json_path, pattern_name) violations. Never includes values."""
    violations: list[tuple[str, str]] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            violations.extend(scan(value, f"{path}.{key}"))
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            violations.extend(scan(value, f"{path}[{i}]"))
    elif isinstance(obj, str):
        for name, pattern in PATTERNS.items():
            if pattern.search(obj):
                violations.append((path, name))
    return violations


def assert_clean(obj: Any) -> None:
    """Raise GuardViolation if obj contains anything that looks like PII/ARNs/keys."""
    violations = scan(obj)
    if violations:
        where = "; ".join(f"{p} ({n})" for p, n in violations)
        raise GuardViolation(f"refusing to write: sensitive pattern(s) found at {where}")
