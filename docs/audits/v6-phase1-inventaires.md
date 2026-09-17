# Phase 1 — inventaires comparatifs

Captures du 17 septembre 2026 (Asia/Jerusalem). Les états sont documentaires, sans modification distante. Voir le rapport principal pour la portée des preuves.

## Migrations : mêmes noms, versions différentes

Ce rapprochement ne prouve pas une égalité de contenu.

| Nom | Version locale | Version distante |
|---|---|---|
| `reschedule_veille_contacts_throughput` | `20260720123000` | `20260720123236` |
| `rename_knowr_cron_jobs_to_tohu_bohu` | `20260720124500` | `20260720125856` |
| `meeting_sync_unique_constraints` | `20260721051423` | `20260721051747` |
| `sync_jobs_client_insert_email_analysis` | `20260722090000` | `20260722101105` |
| `structured_evolving_cognitive_profiles` | `20260724090000` | `20260724064554` |
| `enrichment_slots` | `20260724120000` | `20260724045431` |
| `contact_identity_suggestions` | `20260724150000` | `20260724054744` |
| `fix_detect_contact_merge_candidates_perf` | `20260724153000` | `20260724055901` |
| `fix_merge_detection_false_positives` | `20260724160000` | `20260724062229` |
| `strip_generic_tokens_from_merge_detection` | `20260724163000` | `20260724063313` |
| `distinguish_relationship_longevity_from_recency` | `20260724170000` | `20260724212653` |
| `normalize_contact_full_name_casing` | `20260725090000` | `20260725153738` |
| `fix_merge_contacts_enrichment_status` | `20260726100000` | `20260726010428` |
| `cognitive_axes_v3` | `20260731090000` | `20260731084844` |
| `person_key_moments` | `20260731150000` | `20260731155322` |
| `person_memory_resolve` | `20260802160000` | `20260802164213` |
| `sync_jobs_client_insert_transcript_analysis` | `20260809120000` | `20260808233956` |
| `contact_avatars_bucket` | `20260809140000` | `20260809075759` |
| `contact_avatars_auto_enrich` | `20260818120000` | `20260818151053` |
| `transfer_contact_ownership_rpc` | `20260904120000` | `20260904173609` |
| `drop_transfer_contact_ownership_rpc` | `20260904123000` | `20260904175645` |
| `account_recommendations_assigned_contact` | `20260905090000` | `20260905160003` |
| `companies_siren` | `20260905100000` | `20260905210105` |
| `fiche_visions_and_handovers` | `20260909120000` | `20260910105339` |
| `notion_meeting_notes` | `20260909170000` | `20260909161758` |
| `connectors_bound_to_home_organization` | `20260910090000` | `20260910105104` |
| `watch_off_by_default_on_tracking` | `20260910140000` | `20260910144012` |
| `fix_list_visions_ambiguous_conflict` | `20260910150000` | `20260910145331` |
| `document_person_memory_source_excerpt` | `20260910160000` | `20260910154057` |
| `profile_avatars_bucket` | `20260910210000` | `20260910201031` |
| `account_score_snapshot_month` | `20260910220000` | `20260910203053` |
| `enable_rls_dedup_backup_table` | `20260910230000` | `20260910205423` |
| `user_identity_aliases` | `20260911100000` | `20260911053722` |
| `user_identity_aliases` | `20260911100000` | `20260913090112` |
| `meetings_scope_status_calendar_link` | `20260911101000` | `20260911053524` |
| `org_member_email_helper` | `20260911102000` | `20260911053535` |
| `resolve_contact_identity_create_if_missing` | `20260911103000` | `20260911053626` |
| `detect_person_candidates_meeting_interactions` | `20260911104000` | `20260911053859` |
| `fix_meeting_upsert_partial_index` | `20260911105000` | `20260911055213` |
| `schedule_calendar_sync_cron` | `20260911106000` | `20260911055545` |
| `account_facts_engine_m1` | `20260914120000` | `20260914160818` |
| `scoring_v6_shadow_schema` | `20260914140000` | `20260914191224` |
| `scoring_v6_seed_registry_params` | `20260914141000` | `20260914191338` |
| `feature_flags` | `20260914150000` | `20260914194009` |
| `marker_event_dedup_and_candidate` | `20260914160000` | `20260914195037` |
| `account_brain_rpc` | `20260914170000` | `20260914201327` |
| `reconciliation_rpcs` | `20260914180000` | `20260914202351` |
| `promote_account_facts_rpc` | `20260914190000` | `20260915052757` |
| `rec_dedup_guard_flagged` | `20260915100000` | `20260915071320` |
| `score_batch_account_v6_cron` | `20260916090000` | `20260915195739` |
| `account_engagement_actions` | `20260916100000` | `20260915211034` |
| `marker_event_verbatim_and_evidence_rpcs` | `20260916110000` | `20260916081927` |
| `classify_markers_cron` | `20260916120000` | `20260916081935` |
| `person_memory_dismiss` | `20260916150000` | `20260916183629` |

## Noms distants sans fichier local correspondant

| Version | Nom |
|---|---|
| `20260722144009` | `tohu_bohu_email_backfill_cron` |
| `20260722144705` | `tohu_bohu_email_incremental_cron` |
| `20260723100325` | `fix_notifications_constraints_and_digest_support` |
| `20260723100650` | `tohu_bohu_briefs_and_digest_cron` |
| `20260723101019` | `resource_locks_and_access_grants_foundation` |
| `20260723110625` | `extend_resource_lock_to_contacts_and_companies` |
| `20260724062529` | `fix_shares_surname_generic_word_false_positive` |
| `20260724063457` | `exclude_too_short_core_names_from_merge_detection` |
| `20260731093002` | `relationship_score_v3_and_narratives` |
| `20260804214102` | `connectors_allow_read_ai_provider` |
| `20260804222440` | `detect_account_candidates_real_exchanges_only` |
| `20260805155329` | `email_preferences_and_log` |
| `20260805155407` | `email_preferences_alerte_cap` |
| `20260808160430` | `email_dispatch_rules` |
| `20260824142310` | `enrich_detect_account_candidates` |
| `20260824143329` | `enrich_detect_person_candidates_age` |
| `20260824161207` | `add_source_excerpt_to_person_memory_entries` |
| `20260825104358` | `add_ownership_handovers` |
| `20260825180058` | `add_ai_usage_tracking` |
| `20260825232831` | `reconcile_ai_usage_events_schema` |
| `20260825233306` | `admin_delete_user` |
| `20260826092623` | `account_health_monthly_rpc` |
| `20260826100152` | `allow_location_contact_detail_type` |
| `20260826161625` | `relationship_score_v4_five_axes` |
| `20260826172010` | `account_score_components` |
| `20260828065641` | `home_action_states_archive_snapshot` |
| `20260828123737` | `account_relation_categorization` |
| `20260828213627` | `super_admin_seat_management` |
| `20260828215106` | `team_invitation_revoke` |
| `20260831083243` | `member_removal_and_super_admin_membership_management` |
| `20260831084553` | `fiche_mutual_sharing` |
| `20260902105137` | `can_view_entity_helpers` |
| `20260902105345` | `contacts_private_by_default` |
| `20260902105909` | `person_satellite_tables_private_by_default` |
| `20260902111532` | `fiche_visions_rpcs` |
| `20260902112245` | `list_shared_with_me_display_fields` |
| `20260903072302` | `companies_private_by_default` |
| `20260903072527` | `account_satellite_tables_private_by_default` |
| `20260903072631` | `account_visions_rpcs` |
| `20260903082803` | `accept_invitations_returns_details` |
| `20260910165802` | `dedup_person_career_entries` |
| `20260914201413` | `account_brain_rpc_fix` |
| `20260915052836` | `promote_account_facts_rpc_fix` |
| `20260915200342` | `account_weather_v6_scoring_schema_rpcs` |
| `20260915203003` | `person_marker_events_rpcs` |
| `20260915203221` | `detect_dyad_markers_cron` |
| `20260915205059` | `dyad_weather_snapshots_and_account_history` |
| `20260916082150` | `upsert_person_marker_events_is_verbatim` |
| `20260916205657` | `person_dynamique_axis` |

## Noms locaux sans entrée distante correspondante

| Version | Nom |
|---|---|
| `20260720031500` | `generic_email_domains_are_not_companies` |
| `20260724110000` | `fix_cognitive_confidence_numeric_overflow` |
| `20260724113000` | `allow_personalized_cognitive_mode` |
| `20260729090000` | `cognitive_profile_meeting_sources` |
| `20260731130000` | `user_behavioral_profile_v3` |
| `20260731170000` | `reciprocal_email_relationships` |
| `20260907120000` | `schedule_meeting_prep_emails` |
| `20260907123000` | `enable_team_vision_for_all_members` |
| `20260908160000` | `slack_sync` |
| `20260910110000` | `drop_unused_tables` |
| `20260910130000` | `retire_fiche_shares` |
| `20260917100000` | `v6_foundation_ledger` |
| `20260917101000` | `v6_identity_ambiguity` |
| `20260917102000` | `v6_marker_read_access` |

## Edge Functions déployées

Identité = texte de l’entrypoint retourné comparé au checkout, pas résultat d’une exécution ni identité du bundle complet. Les dépendances sont détaillées dans le JSON comparatif.

| Fonction | Version | JWT gateway | Entry local | Entry HEAD |
|---|---:|---|---|---|
| `account-strategic-reading` | 10 | True | identique | identique |
| `ask-tohu-proxy` | 10 | True | différent | différent |
| `billing-account` | 9 | True | différent | différent |
| `classify-markers` | 3 | True | différent | identique |
| `connect-email-provider` | 13 | True | identique | identique |
| `connect-hubspot` | 16 | False | différent | différent |
| `connect-notion` | 6 | False | identique | identique |
| `connect-read-ai` | 10 | True | identique | identique |
| `connect-slack` | 7 | False | identique | identique |
| `connect-teams` | 10 | False | différent | différent |
| `detect-dyad-markers` | 1 | True | différent | identique |
| `enrich-account-registry` | 7 | True | identique | identique |
| `enrich-contact-avatars` | 9 | True | identique | identique |
| `enrichment-agent-selftest` | 10 | False | absent | absent |
| `generate-briefs` | 9 | True | identique | identique |
| `generate-relationship-narrative` | 8 | True | absent | absent |
| `ingest-transcript` | 15 | True | identique | identique |
| `intercom-user-token` | 1 | True | identique | identique |
| `invite-team-member` | 13 | True | différent | différent |
| `monitor-company-news` | 15 | True | identique | identique |
| `monitor-contacts` | 21 | True | différent | différent |
| `read-ai-webhook` | 13 | False | différent | différent |
| `score-batch` | 31 | True | identique | identique |
| `score-batch-account-v6` | 5 | True | différent | différent |
| `send-alerts` | 9 | True | identique | identique |
| `send-meeting-prep` | 10 | True | différent | différent |
| `send-nurturing` | 8 | True | identique | identique |
| `send-weekly-digest` | 12 | True | identique | identique |
| `stripe-webhook` | 8 | False | identique | identique |
| `sync-email-analysis` | 54 | True | différent | différent |
| `sync-google-calendar` | 2 | True | identique | identique |
| `sync-google-chat` | 8 | True | identique | identique |
| `sync-google-meet` | 9 | True | identique | identique |
| `sync-google-photos` | 9 | True | identique | identique |
| `sync-hubspot` | 8 | True | identique | identique |
| `sync-microsoft-calendar` | 2 | True | identique | identique |
| `sync-notion` | 7 | True | identique | identique |
| `sync-slack` | 9 | True | différent | identique |
| `sync-teams-meetings` | 8 | True | identique | identique |

## Tables et vues applicatives distantes

COUNT(*) exact pour les tables, sauf app_secrets non comptée. Les alias SQL ont une limite de 63 caractères ; la clé du comptage de la table de backup est tronquée, pas le nom de la table.

| Schéma.objet | Type | RLS | Owner | Lignes |
|---|---|---|---|---:|
| `private.super_admin_email_allowlist` | r | True | `postgres` | 5 |
| `public.access_grant` | r | True | `postgres` | 0 |
| `public.account_contact_roles` | r | True | `postgres` | 0 |
| `public.account_deletion_requests` | r | True | `postgres` | 0 |
| `public.account_fact_evidence` | r | True | `postgres` | 47 |
| `public.account_fact_user_state` | r | True | `postgres` | 0 |
| `public.account_facts` | r | True | `postgres` | 47 |
| `public.account_facts_live` | v | False | `postgres` | non compté |
| `public.account_firmographic_facts` | r | True | `postgres` | 0 |
| `public.account_memory_entries` | r | True | `postgres` | 0 |
| `public.account_recommendation_user_state` | r | True | `postgres` | 0 |
| `public.account_recommendations` | r | True | `postgres` | 52 |
| `public.account_relationship_score_snapshots` | r | True | `postgres` | 107 |
| `public.account_relationship_score_snapshots_dedup_backup_20260910` | r | True | `postgres` | 58 |
| `public.account_settings` | r | True | `postgres` | 34 |
| `public.account_strategic_readings` | r | True | `postgres` | 9 |
| `public.account_user_preferences` | r | True | `postgres` | 0 |
| `public.account_watch_settings` | r | True | `postgres` | 3 |
| `public.ai_usage_events` | r | True | `postgres` | 801 |
| `public.app_secrets` | r | True | `postgres` | non compté |
| `public.audit_logs` | r | True | `postgres` | 1 |
| `public.behavioral_signals` | r | True | `postgres` | 161 |
| `public.briefs` | r | True | `postgres` | 0 |
| `public.cognitive_profiles` | r | True | `postgres` | 50 |
| `public.communication_messages` | r | True | `postgres` | 4942 |
| `public.communication_threads` | r | True | `postgres` | 2643 |
| `public.companies` | r | True | `postgres` | 248 |
| `public.company_signals` | r | True | `postgres` | 0 |
| `public.connector_oauth_states` | r | True | `postgres` | 0 |
| `public.connector_sync_state` | r | True | `postgres` | 1 |
| `public.connectors` | r | True | `postgres` | 4 |
| `public.contact_career_path` | r | True | `postgres` | 0 |
| `public.contact_identity_aliases` | r | True | `postgres` | 544 |
| `public.contact_merge_suggestions` | r | True | `postgres` | 0 |
| `public.contact_name_suggestions` | r | True | `postgres` | 8 |
| `public.contact_score_history` | r | True | `postgres` | 757 |
| `public.contact_transfers` | r | True | `postgres` | 0 |
| `public.contacts` | r | True | `postgres` | 543 |
| `public.email_dispatch_rules` | r | True | `postgres` | 8 |
| `public.email_log` | r | True | `postgres` | 9 |
| `public.email_preferences` | r | True | `postgres` | 0 |
| `public.enrichment_cache` | r | True | `postgres` | 183 |
| `public.enrichment_slots` | r | True | `postgres` | 5 |
| `public.feature_flags` | r | True | `postgres` | 6 |
| `public.fiche_handovers` | r | True | `postgres` | 0 |
| `public.fiche_shares` | r | True | `postgres` | 0 |
| `public.fiche_vision_grants` | r | True | `postgres` | 0 |
| `public.fiche_visions` | r | True | `postgres` | 537 |
| `public.home_action_states` | r | True | `postgres` | 15 |
| `public.insight_feedback` | r | True | `postgres` | 0 |
| `public.meeting_participants` | r | True | `postgres` | 652 |
| `public.meeting_transcripts` | r | True | `postgres` | 1 |
| `public.meetings` | r | True | `postgres` | 277 |
| `public.memberships` | r | True | `postgres` | 2 |
| `public.notification_preferences` | r | True | `postgres` | 2 |
| `public.notifications` | r | True | `postgres` | 6 |
| `public.oauth_accounts` | r | True | `postgres` | 3 |
| `public.organization_invitations` | r | True | `postgres` | 0 |
| `public.organizations` | r | True | `postgres` | 2 |
| `public.person_career_entries` | r | True | `postgres` | 38 |
| `public.person_contact_detail_revisions` | r | True | `postgres` | 0 |
| `public.person_contact_details` | r | True | `postgres` | 0 |
| `public.person_key_moments` | r | True | `postgres` | 80 |
| `public.person_memory_entries` | r | True | `postgres` | 23 |
| `public.person_recommendations` | r | True | `postgres` | 239 |
| `public.person_relationship_score_snapshots` | r | True | `postgres` | 192 |
| `public.person_settings` | r | True | `postgres` | 50 |
| `public.person_summaries` | r | True | `postgres` | 0 |
| `public.person_user_settings` | r | True | `postgres` | 50 |
| `public.profiles` | r | True | `postgres` | 2 |
| `public.relationship_snapshots` | r | True | `postgres` | 310 |
| `public.resource_lock` | r | True | `postgres` | 0 |
| `public.signal_feedback` | r | True | `postgres` | 0 |
| `public.stripe_webhook_events` | r | True | `postgres` | 0 |
| `public.subscription_change_history` | r | True | `postgres` | 3 |
| `public.subscription_plans` | r | True | `postgres` | 7 |
| `public.subscription_usage` | v | False | `postgres` | non compté |
| `public.subscriptions` | r | True | `postgres` | 2 |
| `public.super_admins` | r | True | `postgres` | 2 |
| `public.sync_jobs` | r | True | `postgres` | 231 |
| `public.user_behavioral_profiles` | r | True | `postgres` | 2 |
| `public.user_identity_aliases` | r | True | `postgres` | 0 |
| `scoring.marker_event` | r | True | `postgres` | 386 |
| `scoring.marker_registry` | r | True | `postgres` | 34 |
| `scoring.score_snapshot` | r | True | `postgres` | 447 |
| `scoring.scoring_params` | r | True | `postgres` | 2 |

## Colonnes Legacy à isoler

Inventaire des colonnes réellement présentes ; ne constitue pas une autorisation de les supprimer. Les identités, provenances et descriptions utiles peuvent devoir être conservées.

### public.cognitive_profiles

`id`, `organization_id`, `contact_id`, `profile_version`, `global_confidence`, `summary`, `updated_from`, `embedding`, `created_at`, `updated_at`, `jtbd_data`, `interaction_modes_data`, `theory_of_mind_data`, `behavioral_analysis_data`, `executive_summary`, `cognitive_mode`, `cognitive_mode_confidence`, `engagement_score`, `score_phase`, `score_intensite`, `score_reciprocite`, `score_longevite`, `score_delta`, `cognitive_profile_data`, `communication_style_data`, `source_message_count`, `source_interaction_count`, `maturity_level`, `analysis_version`, `last_analyzed_at`, `source_meeting_count`, `trust_score`, `trust_reasoning`, `trust_analyzed_at`, `satisfaction_score`, `satisfaction_reasoning`, `satisfaction_analyzed_at`, `score_engagement`, `score_confiance`, `score_satisfaction`, `score_ancrage`, `account_relation_hint`, `account_relation_hint_confidence`, `account_relation_hint_reasoning`, `account_relation_hint_analyzed_at`, `trust_evidence`, `satisfaction_evidence`

### public.contact_score_history

`id`, `organization_id`, `contact_id`, `user_id`, `score`, `phase`, `score_intensite`, `score_reciprocite`, `score_longevite`, `snapshot_date`, `created_at`, `score_engagement`, `score_confiance`, `score_satisfaction`, `score_ancrage`, `score_dynamique`

### public.relationship_snapshots

`id`, `organization_id`, `user_id`, `contact_id`, `engagement_score`, `score_evolution`, `phase`, `phase_started_at`, `last_contact_at`, `last_contact_type`, `reciprocity_pct`, `avg_frequency_days`, `next_recommended_days`, `crm_synced`, `snapshot_date`, `created_at`

### public.person_relationship_score_snapshots

`id`, `organization_id`, `contact_id`, `score`, `phase`, `phase_delta`, `intensity_score`, `reciprocity_score`, `recency_score`, `confidence`, `total_interactions`, `email_interactions`, `meeting_interactions`, `last_interaction_at`, `computed_at`, `model_version`, `source_type`, `source_id`, `source_label`, `source_url`, `observed_at`, `imported_at`, `last_verified_at`, `inference_level`, `created_at`, `longevity_score`, `relationship_age_days`, `engagement_score`, `confiance_score`, `satisfaction_score`, `ancrage_score`, `ancrage_carriers`, `axis_interpretation`, `dynamique_score`

### public.account_relationship_score_snapshots

`id`, `organization_id`, `company_id`, `score`, `phase`, `phase_delta`, `confidence`, `concentration_risk`, `contact_coverage`, `decision_maker_coverage`, `total_interactions`, `interaction_frequency_30d`, `last_interaction_at`, `computed_at`, `model_version`, `source_type`, `source_id`, `source_label`, `source_url`, `observed_at`, `imported_at`, `last_verified_at`, `inference_level`, `created_at`, `engagement_component`, `recency_component`, `snapshot_month`

### public.person_recommendations

`id`, `organization_id`, `contact_id`, `source_signal_id`, `kind`, `category`, `action_type`, `priority`, `title`, `justification`, `recommended_action`, `trigger_signal`, `payload`, `source_type`, `source_id`, `source_label`, `source_url`, `observed_at`, `imported_at`, `last_verified_at`, `confidence`, `inference_level`, `status`, `due_at`, `completed_at`, `completed_by`, `dismissed_at`, `dismissed_by`, `dismiss_reason`, `feedback_type`, `feedback_reason`, `feedback_by`, `feedback_at`, `updated_by`, `created_at`, `updated_at`

### public.account_recommendations

`id`, `organization_id`, `company_id`, `contact_id`, `source_signal_id`, `category`, `priority`, `title`, `justification`, `recommended_action`, `impact_type`, `source_label`, `source_url`, `observed_at`, `confidence`, `inference_level`, `status`, `assigned_to`, `due_at`, `completed_at`, `dismissed_at`, `feedback_type`, `feedback_reason`, `updated_by`, `created_at`, `updated_at`, `assigned_contact_id`, `dedup_key`, `origin_fact_id`, `priority_breakdown`, `snoozed_until`

