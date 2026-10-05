begin;
-- Additive classification; no independent product architectures or backfill.
alter type tonde.production_type add value 'product_film';
alter type tonde.production_type add value 'trailer';

create type tonde.reference_rights as enum ('user_owned','licensed','brand_owned','authorized_identity','public_reference','third_party_inspiration','unknown');
create type tonde.reference_state as enum ('received','metadata_available','media_available','processing','analyzed','partially_analyzed','inaccessible','failed');
create type tonde.reference_source as enum ('upload','url','social_url','cloud_import','recording','asset','movie','description','generated_result','previous_production');
create type tonde.dialogue_kind as enum ('dialogue','voiceover','narration','pause','reaction');
create type tonde.binding_role as enum ('style','character','world','wardrobe','product','prop','pose','voice','brand','vehicle');
create type tonde.scope_inheritance as enum ('inherit','override','exclude');
create type tonde.message_role as enum ('user','tonde','system','tool');
create type tonde.proposal_state as enum ('proposed','applied','rejected');

-- Existing CHECKs already constrain these values. Enum casts fail rather than
-- silently changing invalid externally created data. Existing values/defaults survive.
alter table tonde.production_references drop constraint production_references_rights_classification_check;
alter table tonde.production_references alter column rights_classification drop default;
alter table tonde.production_references alter column rights_classification type tonde.reference_rights using rights_classification::tonde.reference_rights;
alter table tonde.production_references alter column rights_classification set default 'unknown';
alter table tonde.production_references drop constraint production_references_state_check;
alter table tonde.production_references alter column state drop default;
alter table tonde.production_references alter column state type tonde.reference_state using state::tonde.reference_state;
alter table tonde.production_references alter column state set default 'received';
alter table tonde.production_references drop constraint production_references_source_type_check;
alter table tonde.production_references alter column source_type type tonde.reference_source using source_type::tonde.reference_source;
alter table tonde.dialogue_lines drop constraint dialogue_lines_line_type_check;
alter table tonde.dialogue_lines alter column line_type type tonde.dialogue_kind using line_type::tonde.dialogue_kind;
alter table tonde.scope_bindings drop constraint scope_bindings_binding_role_check;
alter table tonde.scope_bindings alter column binding_role type tonde.binding_role using binding_role::tonde.binding_role;
alter table tonde.scope_bindings drop constraint scope_bindings_inheritance_check;
alter table tonde.scope_bindings alter column inheritance drop default;
alter table tonde.scope_bindings alter column inheritance type tonde.scope_inheritance using inheritance::tonde.scope_inheritance;
alter table tonde.scope_bindings alter column inheritance set default 'inherit';
-- Policies depend on text role expressions; restore identical authorization with enum role.
drop policy message_user_insert on tonde.director_messages;
alter table tonde.director_messages drop constraint director_messages_role_check;
alter table tonde.director_messages alter column role type tonde.message_role using role::tonde.message_role;
alter table tonde.director_messages drop constraint director_messages_proposal_state_check;
alter table tonde.director_messages alter column proposal_state type tonde.proposal_state using proposal_state::tonde.proposal_state;
create policy message_user_insert on tonde.director_messages for insert to authenticated with check (
  tonde.can_edit_workspace(workspace_id) and role = 'user' and created_by = (select auth.uid())
  and structured_result is null and proposal_state is null
);
commit;
