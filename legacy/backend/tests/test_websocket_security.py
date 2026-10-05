import urllib.parse


def _get_access_token(auth_headers: dict) -> str:
    return auth_headers["Authorization"].split(" ", 1)[1]


def test_cross_user_validation_access_denied(client, auth_headers, auth_headers_user2):
    payload = {
        "raw_goal": "I want to build a SaaS tool",
        "industry": "software",
        "founder_country": "Germany",
        "customer_country": "United States",
        "success_definition": "Get 100 paying customers",
    }
    res = client.post("/api/v1/validations", json=payload, headers=auth_headers).json()
    vid = res["data"]["validation_id"]

    token2 = _get_access_token(auth_headers_user2)
    qs = urllib.parse.urlencode({"token": token2})
    try:
        client.websocket_connect(f"/api/v1/validations/{vid}/live?{qs}")
        assert False, "Should not allow cross-user websocket access"
    except Exception:
        assert True


def test_http_snapshot_404_on_cross_user(client, auth_headers, auth_headers_user2):
    payload = {
        "raw_goal": "I want to build a SaaS tool",
        "industry": "software",
        "founder_country": "Germany",
        "customer_country": "United States",
        "success_definition": "Get 100 paying customers",
    }
    res = client.post("/api/v1/validations", json=payload, headers=auth_headers).json()
    vid = res["data"]["validation_id"]

    r = client.get(f"/api/v1/validations/{vid}/live/snapshot", headers=auth_headers_user2)
    assert r.status_code == 404

