"""Discover Content Engine and Discover → Create This HTTP surface."""

from __future__ import annotations
from typing import Any
from uuid import UUID
import logging
from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError
from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_access, require_workspace_editor
from app.domain.discover import (
    ACTIONS,
    ITEM_KINDS,
    SOURCES,
    VISIBILITIES,
    CollectionAdd,
    CollectionCreate,
    DiscoverApply,
    DiscoverPreview,
    DiscoverRegister,
    DiscoverSave,
    DiscoverWithdraw,
)
from app.services.discover import DiscoverRepository, decorate_index, decorate_item

Envelope = Any


def _body(model: type[Any], raw: Any) -> Any:
    try:
        return model.model_validate(raw)
    except ValidationError as e:
        raise AppError("INVALID_DISCOVER_INPUT", "validation", str(e.errors()[0].get("msg", "Check the fields.")), 422) from e


def _uuid(v: str, msg: str) -> UUID:
    try:
        return UUID(v)
    except (ValueError, TypeError, AttributeError) as e:
        raise AppError("INVALID_DISCOVER_INPUT", "validation", msg, 422) from e


def register_discover_routes(app: FastAPI, config: Settings, logger: logging.Logger, envelope: Envelope) -> None:
    base = "/api/v1/workspaces/{workspace_id}/discover"
    repo = DiscoverRepository

    @app.get(base)
    async def index(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)):
        kind = request.query_params.get("kind")
        q = request.query_params.get("q")
        if kind and kind not in ITEM_KINDS:
            raise AppError("INVALID_DISCOVER_INPUT", "validation", "Unknown Discover category.", 422)
        try:
            limit = max(1, min(200, int(request.query_params.get("limit", "50"))))
        except ValueError as e:
            raise AppError("INVALID_DISCOVER_INPUT", "validation", "limit must be an integer.", 422) from e
        return envelope(request, decorate_index(await repo(gateway).index(workspace_id, request.state.access_token, kind=kind, q=q, limit=limit)))

    @app.post(base + "/curate")
    async def register(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(DiscoverRegister, await request.json())
        if p.visibility not in VISIBILITIES:
            raise AppError("INVALID_DISCOVER_INPUT", "validation", "Visibility must be workspace or global.", 422)
        if p.visibility == "global":
            raise AppError("INVALID_DISCOVER_INPUT", "authorization", "Global curation is TONDE-owned; workspace creators cannot publish global Discover items.", 403)
        item_kind = p.item.get("item_kind")
        source = p.item.get("source_kind")
        if item_kind not in ITEM_KINDS or source not in SOURCES:
            raise AppError("INVALID_DISCOVER_INPUT", "validation", "Item kind or provenance source is unknown.", 422)
        if not isinstance(p.item.get("provenance"), dict) or not p.item["provenance"].get("source_label"):
            raise AppError("INVALID_DISCOVER_INPUT", "validation", "Discover items need source provenance.", 422)
        return envelope(request, decorate_item(await repo(gateway).register(workspace_id, request.state.access_token, p.model_dump())))

    @app.get(base + "/{item_id}")
    async def status(workspace_id: UUID, item_id: str, request: Request, user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)):
        return envelope(request, decorate_item(await repo(gateway).status(workspace_id, _uuid(item_id, "Invalid Discover item id."), request.state.access_token)))

    @app.post(base + "/{item_id}/save")
    async def save(workspace_id: UUID, item_id: str, request: Request, user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(DiscoverSave, await request.json())
        return envelope(
            request, await repo(gateway).item_action("discover_save", workspace_id, _uuid(item_id, "Invalid Discover item id."), request.state.access_token, p_note=p.note)
        )

    @app.delete(base + "/{item_id}/save")
    async def unsave(workspace_id: UUID, item_id: str, request: Request, user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)):
        return envelope(request, await repo(gateway).item_action("discover_unsave", workspace_id, _uuid(item_id, "Invalid Discover item id."), request.state.access_token))

    @app.post(base + "/collections")
    async def collection_create(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(CollectionCreate, await request.json())
        return envelope(request, await repo(gateway).collection_create(workspace_id, request.state.access_token, p.model_dump()))

    @app.post(base + "/collections/{collection_id}/items")
    async def collection_add(
        workspace_id: UUID, collection_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(CollectionAdd, await request.json())
        return envelope(
            request,
            await repo(gateway).collection_item(
                "discover_collection_add",
                workspace_id,
                _uuid(collection_id, "Invalid collection id."),
                _uuid(p.item_id, "Invalid item id."),
                request.state.access_token,
                p_note=p.note,
            ),
        )

    @app.delete(base + "/collections/{collection_id}/items/{item_id}")
    async def collection_remove(
        workspace_id: UUID,
        collection_id: str,
        item_id: str,
        request: Request,
        user: CurrentUser = Depends(require_workspace_editor),
        gateway: SupabaseGateway = Depends(get_gateway),
    ):
        return envelope(
            request,
            await repo(gateway).collection_item(
                "discover_collection_remove", workspace_id, _uuid(collection_id, "Invalid collection id."), _uuid(item_id, "Invalid item id."), request.state.access_token
            ),
        )

    @app.post(base + "/create-this/previews")
    async def preview(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(DiscoverPreview, await request.json())
        if p.kind not in ACTIONS:
            raise AppError("INVALID_DISCOVER_INPUT", "validation", "Choose a supported Discover action.", 422)
        for x, msg in ((p.item_id, "Invalid item id."), (p.production_id, "Invalid Production id."), (p.scene_id, "Invalid Scene id."), (p.shot_id, "Invalid Shot id.")):
            if x:
                _uuid(x, msg)
        return envelope(request, await repo(gateway).preview(workspace_id, request.state.access_token, p.model_dump()))

    @app.post(base + "/create-this/applications/{application_id}/apply")
    async def apply(
        workspace_id: UUID, application_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(DiscoverApply, await request.json())
        return envelope(
            request,
            await repo(gateway).app_action(
                "discover_apply", workspace_id, _uuid(application_id, "Invalid application id."), request.state.access_token, p_confirmation=p.confirmation, p_note=p.note
            ),
        )

    @app.post(base + "/create-this/applications/{application_id}/withdraw")
    async def withdraw(
        workspace_id: UUID, application_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(DiscoverWithdraw, await request.json())
        return envelope(
            request, await repo(gateway).app_action("discover_withdraw", workspace_id, _uuid(application_id, "Invalid application id."), request.state.access_token, p_note=p.note)
        )

    @app.get(base + "/create-this/applications/{application_id}")
    async def app_status(
        workspace_id: UUID, application_id: str, request: Request, user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        return envelope(request, await repo(gateway).app_status(workspace_id, _uuid(application_id, "Invalid application id."), request.state.access_token))
