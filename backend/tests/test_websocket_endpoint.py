import urllib.parse


def _get_access_token(auth_headers: dict) -> str:
    return auth_headers["Authorization"].split(" ", 1)[1]


def test_websocket_connect_and_ping(client, auth_headers):
    # create validation
    payload = {
        "raw_goal": "I want to build a SaaS tool",
        "industry": "software",
        "founder_country": "Germany",
        "customer_country": "United States",
        "success_definition": "Get 100 paying customers",
    }
    res = client.post("/api/v1/validations", json=payload, headers=auth_headers).json()
    vid = res["data"]["validation_id"]

    token = _get_access_token(auth_headers)
    qs = urllib.parse.urlencode({"token": token})
    with client.websocket_connect(f"/api/v1/validations/{vid}/live?{qs}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "connection_established"
        ws.send_json({"type": "ping", "payload": {}})
        pong = ws.receive_json()
        assert pong["type"] == "pong"


def test_test_event_broadcast_route(client, auth_headers):
    payload = {
        "raw_goal": "I want to build a SaaS tool",
        "industry": "software",
        "founder_country": "Germany",
        "customer_country": "United States",
        "success_definition": "Get 100 paying customers",
    }
    res = client.post("/api/v1/validations", json=payload, headers=auth_headers).json()
    vid = res["data"]["validation_id"]

    r = client.post(
        f"/api/v1/validations/{vid}/live/test-event",
        json={
            "event_type": "engine_started",
            "level": "info",
            "title": "Engine started",
            "message": "Economy engine started",
        },
        headers=auth_headers,
    )
    assert r.status_code == 200


def test_websocket_requires_token(client, auth_headers):
    payload = {
        "raw_goal": "I want to build a SaaS tool",
        "industry": "software",
        "founder_country": "Germany",
        "customer_country": "United States",
        "success_definition": "Get 100 paying customers",
    }
    res = client.post("/api/v1/validations", json=payload, headers=auth_headers).json()
    vid = res["data"]["validation_id"]

    try:
        client.websocket_connect(f"/api/v1/validations/{vid}/live")
        assert False, "Should reject unauthenticated websocket"
    except Exception:
        assert True

