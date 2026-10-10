"""Workspace-scoped Production Knowledge and Tutorial Intelligence API."""

from __future__ import annotations
import logging
from typing import Any
from uuid import UUID
from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError
from app.core.config import Settings
from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.dependencies.auth import CurrentUser, get_gateway, require_workspace_access, require_workspace_editor, require_workspace_admin
from app.domain.knowledge import (
    CATEGORIES,
    CONFLICT_KINDS,
    CONFLICT_RESOLUTIONS,
    KNOWLEDGE_CLASSES,
    KNOWLEDGE_SOURCES,
    REVIEW_DECISIONS,
    TUTORIAL_SOURCE_KINDS,
    ConflictOpen,
    ConflictResolve,
    KnowledgeCreate,
    KnowledgeImport,
    KnowledgeReview,
    KnowledgeRevise,
    SourceAdd,
    TutorialCreate,
    TutorialPromote,
    TutorialPublish,
    TutorialStep,
)
from app.services.knowledge import KnowledgeRepository, decorate_item, decorate_search, vocabulary

Envelope = Any


def _body(model: type[Any], raw: Any) -> Any:
    try:
        return model.model_validate(raw)
    except ValidationError as e:
        raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", str(e.errors()[0].get("msg", "Check these fields.")), 422) from e


def _uuid(v: str, msg: str) -> UUID:
    try:
        return UUID(v)
    except (ValueError, TypeError, AttributeError) as e:
        raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", msg, 422) from e


def register_knowledge_routes(app: FastAPI, config: Settings, logger: logging.Logger, envelope: Envelope) -> None:
    base = "/api/v1/workspaces/{workspace_id}/knowledge"
    repo = KnowledgeRepository

    @app.get(base + "/vocabulary")
    async def vocab(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_access)):
        return envelope(request, vocabulary())

    @app.get(base)
    async def search(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)):
        query = request.query_params.get("q")
        category = request.query_params.get("category")
        kc = request.query_params.get("class")
        if category and category not in CATEGORIES:
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "Unknown knowledge category.", 422)
        if kc and kc not in KNOWLEDGE_CLASSES:
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "Unknown knowledge class.", 422)
        try:
            limit = max(1, min(200, int(request.query_params.get("limit", "50"))))
        except ValueError as e:
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "limit must be an integer.", 422) from e
        data = await repo(gateway).search(
            workspace_id,
            request.state.access_token,
            query=query,
            category=category,
            knowledge_class=kc,
            include_unreviewed=request.query_params.get("include_unreviewed", "true").lower() == "true",
            limit=limit,
        )
        return envelope(request, decorate_search(data))


    @app.post(base)
    async def create(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(KnowledgeCreate, await request.json())
        if p.category not in CATEGORIES or p.knowledge_class not in KNOWLEDGE_CLASSES or p.source_kind not in KNOWLEDGE_SOURCES:
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "Category, class or source kind is not supported.", 422)
        data = await repo(gateway).create(workspace_id, request.state.access_token, p.model_dump())
        return envelope(request, data)

    @app.get(base + "/{item_id}")
    async def status(workspace_id: UUID, item_id: str, request: Request, user: CurrentUser = Depends(require_workspace_access), gateway: SupabaseGateway = Depends(get_gateway)):
        return envelope(request, decorate_item(await repo(gateway).status(workspace_id, _uuid(item_id, "Invalid item id."), request.state.access_token)))

    @app.post(base + "/{item_id}/submit")
    async def submit(workspace_id: UUID, item_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(TutorialPublish, await request.json())
        return envelope(
            request, await repo(gateway).item_action("knowledge_item_submit", workspace_id, _uuid(item_id, "Invalid item id."), request.state.access_token, p_note=p.note)
        )

    @app.post(base + "/{item_id}/review")
    async def review(workspace_id: UUID, item_id: str, request: Request, user: CurrentUser = Depends(require_workspace_admin), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(KnowledgeReview, await request.json())
        if p.decision not in REVIEW_DECISIONS:
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "Decision must be reviewed or rejected.", 422)
        return envelope(
            request,
            await repo(gateway).item_action(
                "knowledge_item_review", workspace_id, _uuid(item_id, "Invalid item id."), request.state.access_token, p_decision=p.decision, p_note=p.note
            ),
        )

    @app.post(base + "/{item_id}/revise")
    async def revise(workspace_id: UUID, item_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(KnowledgeRevise, await request.json())
        return envelope(
            request,
            await repo(gateway).item_action(
                "knowledge_item_revise", workspace_id, _uuid(item_id, "Invalid item id."), request.state.access_token, p_changes=p.changes, p_reason=p.reason
            ),
        )

    @app.post(base + "/{item_id}/replace/{replacement_id}")
    async def replace(
        workspace_id: UUID,
        item_id: str,
        replacement_id: str,
        request: Request,
        user: CurrentUser = Depends(require_workspace_admin),
        gateway: SupabaseGateway = Depends(get_gateway),
    ):
        p = _body(TutorialPublish, await request.json())
        return envelope(
            request,
            await repo(gateway).item_action(
                "knowledge_item_replace",
                workspace_id,
                _uuid(item_id, "Invalid item id."),
                request.state.access_token,
                replacement_item=str(_uuid(replacement_id, "Invalid replacement id.")),
                p_reason=p.note,
            ),
        )

    @app.post(base + "/{item_id}/sources")
    async def add_source(
        workspace_id: UUID, item_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(SourceAdd, await request.json())
        return envelope(request, await repo(gateway).source_add(workspace_id, _uuid(item_id, "Invalid item id."), request.state.access_token, p.source))

    @app.post(base + "/conflicts")
    async def open_conflict(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(ConflictOpen, await request.json())
        if p.kind not in CONFLICT_KINDS:
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "Unknown conflict kind.", 422)
        return envelope(request, await repo(gateway).conflict_open(workspace_id, request.state.access_token, p.model_dump()))

    @app.post(base + "/conflicts/{conflict_id}/resolve")
    async def resolve_conflict(
        workspace_id: UUID, conflict_id: str, request: Request, user: CurrentUser = Depends(require_workspace_admin), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(ConflictResolve, await request.json())
        if p.resolution not in CONFLICT_RESOLUTIONS:
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "Unknown conflict resolution.", 422)
        return envelope(request, await repo(gateway).conflict_resolve(workspace_id, _uuid(conflict_id, "Invalid conflict id."), request.state.access_token, p.model_dump()))

    # Tutorial extraction is ingested as a structured, attributed package; third-party lesson text is not re-published.
    @app.post(base + "/tutorials")
    async def tutorial_create(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(TutorialCreate, await request.json())
        if p.source_kind not in TUTORIAL_SOURCE_KINDS:
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "Unknown tutorial source kind.", 422)
        if p.source_kind in ("external_article", "external_video") and not (p.attribution or p.license):
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "External tutorial records require attribution or a license.", 422)
        return envelope(request, await repo(gateway).tutorial_register(workspace_id, request.state.access_token, p.model_dump()))

    @app.post(base + "/tutorials/{tutorial_id}/steps")
    async def tutorial_step(
        workspace_id: UUID, tutorial_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(TutorialStep, await request.json())
        return envelope(request, await repo(gateway).tutorial_step(workspace_id, _uuid(tutorial_id, "Invalid tutorial id."), request.state.access_token, p.model_dump()))

    @app.post(base + "/tutorials/{tutorial_id}/publish")
    async def tutorial_publish(
        workspace_id: UUID, tutorial_id: str, request: Request, user: CurrentUser = Depends(require_workspace_admin), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(TutorialPublish, await request.json())
        return envelope(
            request, await repo(gateway).tutorial_action("tutorial_publish", workspace_id, _uuid(tutorial_id, "Invalid tutorial id."), request.state.access_token, p_note=p.note)
        )

    @app.post(base + "/tutorial-steps/{step_id}/promote")
    async def tutorial_promote(
        workspace_id: UUID, step_id: str, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)
    ):
        p = _body(TutorialPromote, await request.json())
        if p.category not in CATEGORIES:
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "Unknown category.", 422)
        return envelope(request, await repo(gateway).tutorial_promote(workspace_id, _uuid(step_id, "Invalid step id."), request.state.access_token, p.model_dump()))

    @app.post(base + "/imports")
    async def import_items(workspace_id: UUID, request: Request, user: CurrentUser = Depends(require_workspace_editor), gateway: SupabaseGateway = Depends(get_gateway)):
        p = _body(KnowledgeImport, await request.json())
        if p.format not in ("json", "csv", "markdown"):
            raise AppError("INVALID_KNOWLEDGE_INPUT", "validation", "Import format must be json, csv or markdown.", 422)
        return envelope(request, await repo(gateway).import_request(workspace_id, request.state.access_token, p.model_dump()))

