"""Prompt 10 publishing request contracts (§15-23, §52).

The rules a request must satisfy before anything reaches the database:

* a publication names a Result of an active Production and the destination provider it targets;
* its settings carry no secret-shaped key, because destination settings are stored in the open (the
  credential lives in the private store);
* a scheduled publication carries a future time and only a scheduled one carries a time;
* an authorization decision is `authorize` or `withdraw`, and it is always a **creator** decision —
  there is deliberately no request shape in which a service, an AI or a background process can make it.

Creative approval of a Result is not represented here at all: it is a different fact, recorded on the
Result, and it never appears as publishing authority.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# The same markers the schema refuses in destination settings and provider configuration.
SECRET_MARKERS = ('secret', 'token', 'password', 'credential', 'apikey', 'api_key', 'api-key', 'private_key',
    'client_secret', 'refresh', 'authorization_code', 'bearer')

Visibility = Literal['private', 'unlisted', 'public', 'scheduled']
PublicationOutcome = Literal['accepted', 'processing', 'succeeded', 'failed', 'unknown']
ObservedState = Literal['published', 'processing', 'removed', 'failed', 'unknown_remote_state']


class PublishingModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


def _no_settings_secret(settings: dict[str, Any]) -> dict[str, Any]:
    for key in settings:
        lowered = str(key).lower().replace('-', '_')
        if any(marker in lowered for marker in SECRET_MARKERS):
            raise ValueError('Destination settings must not contain secrets; the credential lives in the private store.')
    return settings


def _schedule_matches(visibility: str, scheduled_for: datetime | None) -> None:
    if visibility == 'scheduled' and scheduled_for is None:
        raise ValueError('A scheduled publication needs the time it is scheduled for.')
    if visibility != 'scheduled' and scheduled_for is not None:
        raise ValueError('Only a scheduled publication carries a scheduled time.')


class PublicationCreateRequest(PublishingModel):
    production_id: UUID
    result_id: UUID
    provider: str = Field(min_length=1, max_length=60)
    media_id: UUID | None = None
    destination: str = Field(default='', max_length=300)
    account_id: UUID | None = None
    title: str = Field(default='', max_length=300)
    caption: str = Field(default='', max_length=5000)
    visibility: Visibility = 'private'
    scheduled_for: datetime | None = None
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator('config')
    @classmethod
    def refuse_settings_secrets(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _no_settings_secret(value)

    @model_validator(mode='after')
    def validate_schedule(self) -> 'PublicationCreateRequest':
        _schedule_matches(self.visibility, self.scheduled_for)
        return self


class PublicationUpdateRequest(PublishingModel):
    title: str = Field(default='', max_length=300)
    caption: str = Field(default='', max_length=5000)
    destination: str = Field(default='', max_length=300)
    config: dict[str, Any] = Field(default_factory=dict)
    visibility: Visibility = 'private'
    scheduled_for: datetime | None = None

    @field_validator('config')
    @classmethod
    def refuse_settings_secrets(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _no_settings_secret(value)

    @model_validator(mode='after')
    def validate_schedule(self) -> 'PublicationUpdateRequest':
        _schedule_matches(self.visibility, self.scheduled_for)
        return self


class PublicationAuthorizeRequest(PublishingModel):
    """A creator's publishing authority. Withdrawal is the same act, decided the other way."""

    decision: Literal['authorize', 'withdraw'] = 'authorize'
    note: str = Field(default='', max_length=800)


class PublicationStateRequest(PublishingModel):
    desired: Literal['draft', 'ready', 'awaiting_authorization', 'cancelled', 'removed']
    note: str = Field(default='', max_length=800)


class PublicationReconcileRequest(PublishingModel):
    """What the destination actually shows. The only way out of an unknown destination state."""

    observed: ObservedState
    remote_resource_id: str | None = Field(default=None, max_length=300)
    remote_state: str = Field(default='', max_length=200)
    failure_category: str | None = Field(default=None, max_length=60)
    note: str = Field(default='', max_length=800)


class PublicationQuery(PublishingModel):
    production_id: UUID | None = None
    result_id: UUID | None = None
    state: str | None = Field(default=None, max_length=40)
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


# Optional provider metadata a creator may edit. It is sent as the destination's own settings, never as a
# credential, and it never reaches the filesystem of the destination.
PERMITTED_SETTINGS_KEYS = ('playlist', 'category', 'tags', 'locale', 'made_for_kids', 'thumbnail_media_id',
    'monetization', 'brand', 'collaborators', 'reply_settings', 'alt_text')
