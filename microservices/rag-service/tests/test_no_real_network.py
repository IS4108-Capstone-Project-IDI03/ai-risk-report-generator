"""The test guard in conftest.py stops any test reaching a paid API."""

import socket

import pytest


def test_an_outside_connection_fails_before_leaving_the_machine():
    with socket.socket() as s, pytest.raises(RuntimeError, match="mock it instead"):
        s.connect(("93.184.216.34", 443))  # any public address
