"""
Team schemas — Team, TeamMember, TeamInvitation, Skill.
Collection: teams
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import BaseSchema, new_id, utcnow
from .enums import TeamRole, MemberStatus, InvitationStatus


class Skill(BaseSchema):
    name: str
    level: str  # beginner | intermediate | advanced | expert
    years_experience: Optional[float] = None


class TeamMember(BaseSchema):
    user_id: str
    email: str
    role: TeamRole = TeamRole.contributor
    permissions: list[str] = Field(default_factory=list)
    title: Optional[str] = None
    department: Optional[str] = None
    capacity_hours_per_week: Optional[float] = None
    skills: list[Skill] = Field(default_factory=list)
    reliability_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    commitment_score: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    ego_type: Optional[str] = None
    joined_at: datetime = Field(default_factory=utcnow)
    last_active_at: Optional[datetime] = None
    status: MemberStatus = MemberStatus.active


class TeamInvitation(BaseSchema):
    invitation_id: str = Field(default_factory=new_id)
    email: str
    role: TeamRole = TeamRole.contributor
    invited_by: str  # user_id
    token_hash: str
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    status: InvitationStatus = InvitationStatus.pending


class TeamSettings(BaseSchema):
    allow_public_sharing: bool = False
    require_mfa: bool = False
    default_role: TeamRole = TeamRole.contributor
    notification_digest: bool = True


class Team(BaseSchema):
    """
    Team document. Protected — team_id required. Membership validates access.
    Collection: teams
    """
    team_id: str = Field(default_factory=new_id)
    owner_id: str   # user_id of the team owner
    name: str
    description: Optional[str] = None
    members: list[TeamMember] = Field(default_factory=list)
    invitations: list[TeamInvitation] = Field(default_factory=list)
    subscription_id: Optional[str] = None
    settings: TeamSettings = Field(default_factory=TeamSettings)
