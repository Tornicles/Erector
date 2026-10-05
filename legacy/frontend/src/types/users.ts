/**
 * User Types
 * Mirrors backend/models/users.py
 */

import {
  UserType, ExperienceLevel, GoalType, SubscriptionTier,
  ValidationDepth, NotificationType
} from './enums';

export interface NotificationPreferences {
  email_enabled: boolean;
  push_enabled: boolean;
  sms_enabled: boolean;
  enabled_types: NotificationType[];
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}

export interface OnboardingState {
  completed_steps: string[];
  current_step?: string | null;
  skipped_steps: string[];
}

export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface ErectorUser {
  user_id: string;
  email: string;
  email_verified: boolean;
  full_name?: string | null;
  avatar_url?: string | null;
  user_type: UserType;
  experience_level: ExperienceLevel;
  default_goal_type: GoalType;
  subscription_tier: SubscriptionTier;
  onboarding_completed: boolean;
  onboarding_state: OnboardingState;
  preferred_founder_country?: string | null;
  preferred_customer_country?: string | null;
  preferred_industry?: string | null;
  default_validation_depth: ValidationDepth;
  notification_preferences: NotificationPreferences;
  billing_customer_id?: string | null;
  active_team_ids: string[];
  last_login_at?: string | null;
  status: UserStatus;
  created_at: string;
  updated_at?: string | null;
}

export interface UserUpdateRequest {
  full_name?: string;
  avatar_url?: string;
  preferred_founder_country?: string;
  preferred_customer_country?: string;
  preferred_industry?: string;
  default_goal_type?: GoalType;
  default_validation_depth?: ValidationDepth;
  experience_level?: ExperienceLevel;
  notification_preferences?: Partial<NotificationPreferences>;
}
