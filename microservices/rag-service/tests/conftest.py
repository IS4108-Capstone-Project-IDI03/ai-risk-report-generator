"""Shared test setup for rag-service: no test may reach a paid API (Claude, OpenAI, Cohere).

Every test mocks its model and search calls; this guard makes a missed mock fail loudly
instead of quietly spending money. Only loopback connections (local test servers) pass.
"""

import ipaddress
import socket

import pytest

_connect = socket.socket.connect


def _is_loopback(address) -> bool:
    host = address[0] if isinstance(address, tuple) else address
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost"


def _guarded_connect(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _is_loopback(address):
        raise RuntimeError(f"Test tried a real network call to {address}; mock it instead.")
    return _connect(self, address)


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Blocks outside network connections for every test (a missed mock would cost money)."""
    monkeypatch.setattr(socket.socket, "connect", _guarded_connect)
