"""Server-side entitlement enforcement (§8-10).

Frontend hiding is not security, so every paid or limited Prompt 10 operation asks the database:

    tonde.entitlement_state(workspace, key) -> reason

and acts on the reason rather than on a plan name. The important subtlety is *what happens when a
deployment declares no entitlement at all*:

* a key with no definition (`UNKNOWN_ENTITLEMENT`) or one that is explicitly disabled
  (`ENTITLEMENT_DISABLED`) is **not a commercial gate**. TONDE does not invent restrictions, so an
  undeclared capability stays available and the response says the call was not entitlement-gated;
* every other non-`AVAILABLE` reason (`NO_SUBSCRIPTION`, `SUBSCRIPTION_NOT_ACTIVE`, `NOT_INCLUDED`,
  `EXPIRED`, `EXHAUSTED`) refuses the call server-side, with the reason attached.

A deployment that wants to gate a capability declares it in `tonde.entitlement_definitions` and
grants it through a plan or an explicit grant; that is the only way to make a capability paid.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.core.errors import AppError
from app.db.client import SupabaseGateway

# The entitlement keys a deployment *may* declare for Prompt 10 capabilities. Nothing declares them by
# default: an undeclared capability is not gated, it is simply not sold.
EXPORT_DOCUMENT_ENTITLEMENT = 'exports.documents'
EXPORT_PACKAGE_ENTITLEMENT = 'exports.packages'
PUBLISHING_ENTITLEMENT = 'publishing.destinations'
AI_GENERATION_ENTITLEMENT = 'generation.credits'
NOT_GATED = frozenset({'UNKNOWN_ENTITLEMENT', 'ENTITLEMENT_DISABLED'})


def _reason_message(state: str, capability: str) -> str:
    return {
        'NO_SUBSCRIPTION': f'{capability} needs a subscription and this workspace has none.',
        'SUBSCRIPTION_NOT_ACTIVE': f'{capability} needs an active subscription; this workspace is not currently entitled.',
        'NOT_INCLUDED': f'{capability} is not included in the current plan.',
        'EXPIRED': f'The entitlement that carried {capability} has expired.',
        'EXHAUSTED': f'{capability} has no remaining balance in this period.',
    }.get(state, f'{capability} is not available with the current entitlement ({state}).')


async def check_entitlement(gateway: SupabaseGateway, workspace_id: UUID, key: str, token: str) -> dict[str, Any]:
    """Return the entitlement decision without raising, so a caller can explain it."""

    try:
        state = await gateway.rpc_detailed('entitlement_state', token=token,
            json={'target_workspace': str(workspace_id), 'target_key': key}, layer='Prompt 10 billing')
    except AppError as error:
        if error.kind == 'unavailable':
            # The entitlement migration is not applied, so this deployment declares no commercial
            # gate at all. That is reported as ungated rather than as enforcement.
            return {'entitlement': key, 'state': 'UNKNOWN_ENTITLEMENT', 'enforced': False, 'available': True}
        raise
    state_text = str(state or 'UNKNOWN_ENTITLEMENT')
    return {'entitlement': key, 'state': state_text, 'enforced': state_text not in NOT_GATED,
        'available': state_text == 'AVAILABLE' or state_text in NOT_GATED}


async def ensure_entitlement(gateway: SupabaseGateway, workspace_id: UUID, key: str, token: str,
    capability: str) -> dict[str, Any]:
    """Refuse a paid or limited operation that the workspace does not hold. Server-side, always."""

    decision = await check_entitlement(gateway, workspace_id, key, token)
    if not decision['available']:
        raise AppError('ENTITLEMENT_REQUIRED', 'authorization', _reason_message(decision['state'], capability), 403)
    return decision
