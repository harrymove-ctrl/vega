"""Async SoSoValue REST client.

Docs: https://sosovalue-1.gitbook.io/sosovalue-api-doc

Auth header name and exact endpoint paths are starting guesses — confirm against
the latest docs once your buildathon access is provisioned and adjust.
"""

from __future__ import annotations

import httpx

from ..core.config import get_settings


class SoSoValueError(Exception):
    def __init__(self, status: int, body: object, message: str | None = None) -> None:
        super().__init__(message or f"SoSoValue API error {status}")
        self.status = status
        self.body = body


class SoSoValueClient:
    def __init__(self, *, base_url: str | None = None, api_key: str | None = None) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.sosovalue_api_base).rstrip("/")
        self.api_key = api_key or settings.sosovalue_api_key
        if not self.api_key:
            raise SoSoValueError(500, None, "SOSOVALUE_API_KEY is not set")

    async def _request(self, path: str, params: dict[str, object] | None = None) -> object:
        url = f"{self.base_url}{path}"
        headers = {"x-soso-api-key": self.api_key, "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.get(url, params=params, headers=headers)
        if res.status_code >= 400:
            raise SoSoValueError(res.status_code, _safe_json(res))
        return res.json()

    async def featured_news(self, currency: str) -> object:
        return await self._request("/api/v1/news/featured", {"currency": currency})

    async def etf_overview(self) -> object:
        return await self._request("/api/v1/etf/overview")


def _safe_json(res: httpx.Response) -> object:
    try:
        return res.json()
    except Exception:
        return res.text
