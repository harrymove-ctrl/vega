"""Async SoDEX REST client.

Docs: https://sodex.com/documentation/api/api

Mainnet uses api.sodex.com (key required). Testnet (testnet.sodex.com) is open.
"""

from __future__ import annotations

import httpx

from ..core.config import get_settings


class SoDEXError(Exception):
    def __init__(self, status: int, body: object, message: str | None = None) -> None:
        super().__init__(message or f"SoDEX API error {status}")
        self.status = status
        self.body = body


class SoDEXClient:
    def __init__(self, *, base_url: str | None = None, api_key: str | None = None) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.sodex_api_base).rstrip("/")
        self.api_key = api_key or settings.sodex_api_key

    async def _request(
        self, path: str, params: dict[str, object] | None = None, *, method: str = "GET"
    ) -> object:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["x-sodex-api-key"] = self.api_key
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.request(method, url, params=params, headers=headers)
        if res.status_code >= 400:
            raise SoDEXError(res.status_code, _safe_json(res))
        return res.json()

    async def markets(self) -> object:
        return await self._request("/v1/markets")

    async def orderbook(self, symbol: str) -> object:
        return await self._request("/v1/orderbook", {"symbol": symbol})


def _safe_json(res: httpx.Response) -> object:
    try:
        return res.json()
    except Exception:
        return res.text
