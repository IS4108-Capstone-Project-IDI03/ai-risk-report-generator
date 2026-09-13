"""Cloud selection must never silently fall back to local evidence."""

from unittest.mock import Mock

import pytest

from app import retrieval_config as config


def test_local_and_cloud_configuration(monkeypatch):
    local, cloud = Mock(), Mock()
    monkeypatch.setattr(config.chromadb, "HttpClient", local)
    monkeypatch.setattr(config.chromadb, "CloudClient", cloud)
    config.chroma_client.cache_clear()
    try:
        monkeypatch.setenv("CHROMA_MODE", "local")
        monkeypatch.setenv("CHROMA_HOST", "localhost")
        monkeypatch.setenv("CHROMA_PORT", "8000")
        assert config.chroma_client() is local.return_value
        local.assert_called_once_with(host="localhost", port=8000)
        config.chroma_client.cache_clear()
        monkeypatch.setenv("CHROMA_MODE", "cloud")
        for key in ("CHROMA_API_KEY", "CHROMA_TENANT", "CHROMA_DATABASE"):
            monkeypatch.delenv(key, raising=False)
        with pytest.raises(RuntimeError, match="CHROMA_API_KEY"):
            config.chroma_client()
        cloud.assert_not_called()
        monkeypatch.setenv("CHROMA_API_KEY", "test-key")
        monkeypatch.setenv("CHROMA_TENANT", "test-team")
        monkeypatch.setenv("CHROMA_DATABASE", "team-dev")
        monkeypatch.setenv("CHROMA_CLOUD_HOST", "region.example.com")
        assert config.chroma_client() is cloud.return_value
        cloud.assert_called_once_with(
            api_key="test-key",
            tenant="test-team",
            database="team-dev",
            cloud_host="region.example.com",
        )
        assert local.call_count == 1
        config.chroma_client.cache_clear()
        monkeypatch.setenv("CHROMA_MODE", "cluod")
        with pytest.raises(RuntimeError, match="local or cloud"):
            config.chroma_client()
    finally:
        config.chroma_client.cache_clear()
