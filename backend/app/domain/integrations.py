"""Prompt 10 integration request contracts (§3-14, §20).

Three laws live in these models, before any database or provider call:

* **TONDE stores no provider credential.** A connection may name where a credential lives (a vault or
  secret name). A literal secret is refused here with the same markers the AI-connection surface
  already refuses, so a second credential-storage interpretation cannot appear.
* **A destination is chosen explicitly.** A scope TONDE never requested can never appear in a grant,
  and the request states the scopes it is asking for so the database can enforce the subset law.
* **An external identity is never guessed.** A callback names the state it is answering; the backend
  resolves which workspace, user and provider that state belongs to rather than accepting them from
  the caller.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# The same markers migration 017 and the AI connection surface refuse. A reference to a credential is
# allowed; the credential itself is not.
CREDENTIAL_MARKERS: tuple[str, ...] = ('sk-', 'secret', 'password', 'bearer ', '-----begin', 'token=')
MAX_SCOPES = 40


class IntegrationModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


def _no_credential(value: str, context: str) -> str:
    lowered = value.strip().lower()
    if any(marker in lowered for marker in CREDENTIAL_MARKERS):
        raise ValueError(f'Store a reference to the credential (a vault or secret name), never the credential itself, for {context}.')
    if len(value) > 200:
        raise ValueError('A credential reference is at most 200 characters.')
    return value.strip()


class ConnectRequest(IntegrationModel):
    """Connect a destination account. `credential_reference` is a name, never a secret."""

    provider: str = Field(min_length=1, max_length=60)
    credential_reference: str = Field(default='', max_length=200)
    account_label: str = Field(default='', max_length=200)
    requested_scopes: list[str] = Field(default_factory=list, max_length=MAX_SCOPES)

    @field_validator('credential_reference')
    @classmethod
    def refuse_literal_secret(cls, value: str) -> str:
        return _no_credential(value, 'a provider connection')

    @field_validator('requested_scopes')
    @classmethod
    def scopes_are_names(cls, value: list[str]) -> list[str]:
        cleaned = [scope.strip() for scope in value if scope and scope.strip()]
        if len(set(cleaned)) != len(cleaned):
            raise ValueError('A requested scope is listed once.')
        if any(len(scope) > 120 for scope in cleaned):
            raise ValueError('A scope name is at most 120 characters.')
        return cleaned


class OAuthInitiateRequest(IntegrationModel):
    """Open an authorization flow. The state is created server-side and returned once."""

    provider: str = Field(min_length=1, max_length=60)
    redirect_uri: str = Field(default='', max_length=400)
    requested_scopes: list[str] = Field(default_factory=list, max_length=MAX_SCOPES)


class OAuthCallbackRequest(IntegrationModel):
    """Answer an authorization flow.

    The state is resolved server-side, so the caller cannot name a workspace, user or provider it does
    not own. `credential_reference` is where the deployment's own vault keeps the resulting token;
    TONDE itself persists no credential.
    """

    state: str = Field(min_length=16, max_length=200)
    code: str = Field(min_length=1, max_length=2000)
    account_label: str = Field(default='', max_length=200)
    credential_reference: str = Field(default='', max_length=200)

    @field_validator('credential_reference')
    @classmethod
    def refuse_literal_secret(cls, value: str) -> str:
        return _no_credential(value, 'a provider connection')


class ReauthorizeRequest(IntegrationModel):
    """Re-authorize an existing connection with a fresh authorization flow or a new reference."""

    credential_reference: str = Field(default='', max_length=200)
    requested_scopes: list[str] = Field(default_factory=list, max_length=MAX_SCOPES)

    @field_validator('credential_reference')
    @classmethod
    def refuse_literal_secret(cls, value: str) -> str:
        return _no_credential(value, 'a provider connection')


class DisconnectRequest(IntegrationModel):
    """Disconnect a destination account. The reason is recorded for the workspace history."""

    reason: str = Field(default='', max_length=600)


class VerificationRequest(IntegrationModel):
    """Ask the provider (through its adapter) whether this connection still works."""

    note: str = Field(default='', max_length=600)


IntegrationCategory = Literal['social_publishing', 'ai_generation', 'storage_delivery', 'communication',
    'billing', 'analytics_metadata']
ConnectionStatus = Literal['disconnected', 'pending', 'connected', 'reauth_required', 'expired', 'revoked',
    'error', 'disabled']
