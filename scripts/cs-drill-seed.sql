-- CS-016 — the 20-conversation drill fixture, seeded once and toggled by status.
--
-- S_drill = 'done'. It is the only value inside `conversations_status_check`
-- (needs_reply | waiting | done) that neither the desk nor the dashboard counts:
--   * `listDeskQueue` (production f4f3a288) requires status = 'needs_reply';
--   * `desk-filters.ts` (MC-182) excludes TOMBSTONE_STATUS = 'done' from every chip and from `all`;
--   * `dashboardCounts.needs_reply` counts status = 'needs_reply'.
-- So a seeded thread is invisible in every filter and every queue badge while it is 'done', and one
-- UPDATE to 'needs_reply' opens the drill window. No DELETE is involved (mychef_runtime has none).
--
-- Nothing here is a real guest: the contact name is the drill number, there is no phone, email,
-- address or villa, and every message body is written for the drill, not copied from a guest.
--
-- Idempotent: `on conflict (workspace_id, id) do update` means a second run refreshes the rows
-- instead of duplicating them. Run it inside one transaction and verify the counts before commit.
--
-- Toggle (two statements, both reversible):
--   update mychef_inbox.conversations set status = 'needs_reply'
--    where workspace_id = 'mychef' and id like 'TEST-CS-%';   -- open the drill
--   update mychef_inbox.conversations set status = 'done'
--    where workspace_id = 'mychef' and id like 'TEST-CS-%';   -- close it

begin;

insert into mychef_inbox.contacts (workspace_id, id, name, facts) values
  ('mychef','TEST-CS-C01','TEST-CS-01','{"drill":true,"scheme":"cs-drill-v1","scenario":"price-no-details"}'),
  ('mychef','TEST-CS-C02','TEST-CS-02','{"drill":true,"scheme":"cs-drill-v1","scenario":"price-full-details"}'),
  ('mychef','TEST-CS-C03','TEST-CS-03','{"drill":true,"scheme":"cs-drill-v1","scenario":"menu-dish"}'),
  ('mychef','TEST-CS-C04','TEST-CS-04','{"drill":true,"scheme":"cs-drill-v1","scenario":"allergy-nut-severe"}'),
  ('mychef','TEST-CS-C05','TEST-CS-05','{"drill":true,"scheme":"cs-drill-v1","scenario":"dietary-gluten-free"}'),
  ('mychef','TEST-CS-C06','TEST-CS-06','{"drill":true,"scheme":"cs-drill-v1","scenario":"date-hold"}'),
  ('mychef','TEST-CS-C07','TEST-CS-07','{"drill":true,"scheme":"cs-drill-v1","scenario":"travel-canggu"}'),
  ('mychef','TEST-CS-C08','TEST-CS-08','{"drill":true,"scheme":"cs-drill-v1","scenario":"complaint-late"}'),
  ('mychef','TEST-CS-C09','TEST-CS-09','{"drill":true,"scheme":"cs-drill-v1","scenario":"refund"}'),
  ('mychef','TEST-CS-C10','TEST-CS-10','{"drill":true,"scheme":"cs-drill-v1","scenario":"legal-threat"}'),
  ('mychef','TEST-CS-C11','TEST-CS-11','{"drill":true,"scheme":"cs-drill-v1","scenario":"safety-incident"}'),
  ('mychef','TEST-CS-C12','TEST-CS-12','{"drill":true,"scheme":"cs-drill-v1","scenario":"press"}'),
  ('mychef','TEST-CS-C13','TEST-CS-13','{"drill":true,"scheme":"cs-drill-v1","scenario":"vip"}'),
  ('mychef','TEST-CS-C14','TEST-CS-14','{"drill":true,"scheme":"cs-drill-v1","scenario":"bahasa"}'),
  ('mychef','TEST-CS-C15','TEST-CS-15','{"drill":true,"scheme":"cs-drill-v1","scenario":"mixed-language"}'),
  ('mychef','TEST-CS-C16','TEST-CS-16','{"drill":true,"scheme":"cs-drill-v1","scenario":"instagram-dm"}'),
  ('mychef','TEST-CS-C17','TEST-CS-17','{"drill":true,"scheme":"cs-drill-v1","scenario":"vague"}'),
  ('mychef','TEST-CS-C18','TEST-CS-18','{"drill":true,"scheme":"cs-drill-v1","scenario":"five-questions"}'),
  ('mychef','TEST-CS-C19','TEST-CS-19','{"drill":true,"scheme":"cs-drill-v1","scenario":"supersede"}'),
  ('mychef','TEST-CS-C20','TEST-CS-20','{"drill":true,"scheme":"cs-drill-v1","scenario":"follow-up"}')
on conflict (workspace_id, id) do update
  set name = excluded.name, facts = excluded.facts;

insert into mychef_inbox.conversations
  (workspace_id, id, contact_id, channel, status, last_message_at, project_id)
values
  ('mychef','TEST-CS-01','TEST-CS-C01','Other',    'done','2026-11-02 01:01:00+00','mychef'),
  ('mychef','TEST-CS-02','TEST-CS-C02','WhatsApp', 'done','2026-11-02 01:06:00+00','mychef'),
  ('mychef','TEST-CS-03','TEST-CS-C03','WhatsApp', 'done','2026-11-02 01:11:00+00','mychef'),
  ('mychef','TEST-CS-04','TEST-CS-C04','WhatsApp', 'done','2026-11-02 01:16:00+00','mychef'),
  ('mychef','TEST-CS-05','TEST-CS-C05','Instagram','done','2026-11-02 01:21:00+00','mychef'),
  ('mychef','TEST-CS-06','TEST-CS-C06','WhatsApp', 'done','2026-11-02 01:26:00+00','mychef'),
  ('mychef','TEST-CS-07','TEST-CS-C07','Other',    'done','2026-11-02 01:31:00+00','mychef'),
  ('mychef','TEST-CS-08','TEST-CS-C08','WhatsApp', 'done','2026-11-02 01:36:00+00','mychef'),
  ('mychef','TEST-CS-09','TEST-CS-C09','WhatsApp', 'done','2026-11-02 01:41:00+00','mychef'),
  ('mychef','TEST-CS-10','TEST-CS-C10','Other',    'done','2026-11-02 01:46:00+00','mychef'),
  ('mychef','TEST-CS-11','TEST-CS-C11','WhatsApp', 'done','2026-11-02 01:51:00+00','mychef'),
  ('mychef','TEST-CS-12','TEST-CS-C12','Instagram','done','2026-11-02 01:56:00+00','mychef'),
  ('mychef','TEST-CS-13','TEST-CS-C13','WhatsApp', 'done','2026-11-02 02:01:00+00','mychef'),
  ('mychef','TEST-CS-14','TEST-CS-C14','WhatsApp', 'done','2026-11-02 02:06:00+00','mychef'),
  ('mychef','TEST-CS-15','TEST-CS-C15','Other',    'done','2026-11-02 02:11:00+00','mychef'),
  ('mychef','TEST-CS-16','TEST-CS-C16','Instagram','done','2026-11-02 02:16:00+00','mychef'),
  ('mychef','TEST-CS-17','TEST-CS-C17','Other',    'done','2026-11-02 02:21:00+00','mychef'),
  ('mychef','TEST-CS-18','TEST-CS-C18','WhatsApp', 'done','2026-11-02 02:26:00+00','mychef'),
  ('mychef','TEST-CS-19','TEST-CS-C19','WhatsApp', 'done','2026-11-02 02:31:00+00','mychef'),
  ('mychef','TEST-CS-20','TEST-CS-C20','WhatsApp', 'done','2026-11-02 02:36:00+00','mychef')
on conflict (workspace_id, id) do update
  set contact_id = excluded.contact_id,
      channel = excluded.channel,
      status = excluded.status,
      last_message_at = excluded.last_message_at,
      project_id = excluded.project_id;

insert into mychef_inbox.messages
  (workspace_id, id, conversation_id, direction, body, attachments, created_at)
values
  ('mychef','TEST-CS-01-M1','TEST-CS-01','inbound','How much for a private chef?','[]','2026-11-02 01:00:00+00'),
  ('mychef','TEST-CS-02-M1','TEST-CS-02','inbound','We are 10 guests on 14 December in Canggu, dinner for a birthday. What does it cost?','[]','2026-11-02 01:05:00+00'),
  ('mychef','TEST-CS-03-M1','TEST-CS-03','inbound','What is on the menu? Can we get babi guling?','[]','2026-11-02 01:10:00+00'),
  ('mychef','TEST-CS-04-M1','TEST-CS-04','inbound','Our son has a severe nut allergy - anaphylaxis, we carry an EpiPen. Is that ok?','[]','2026-11-02 01:15:00+00'),
  ('mychef','TEST-CS-05-M1','TEST-CS-05','inbound','Do you do gluten free?','[]','2026-11-02 01:20:00+00'),
  ('mychef','TEST-CS-06-M1','TEST-CS-06','inbound','Can you hold the 14th for us?','[]','2026-11-02 01:25:00+00'),
  ('mychef','TEST-CS-07-M1','TEST-CS-07','inbound','We are in Canggu, do you cover that?','[]','2026-11-02 01:30:00+00'),
  ('mychef','TEST-CS-08-M1','TEST-CS-08','inbound','The chef was 90 minutes late and we lost the sunset.','[]','2026-11-02 01:35:00+00'),
  ('mychef','TEST-CS-09-M1','TEST-CS-09','inbound','We want our deposit back.','[]','2026-11-02 01:40:00+00'),
  ('mychef','TEST-CS-10-M1','TEST-CS-10','inbound','My lawyer will contact you.','[]','2026-11-02 01:45:00+00'),
  ('mychef','TEST-CS-11-M1','TEST-CS-11','inbound','I was ill after dinner last night.','[]','2026-11-02 01:50:00+00'),
  ('mychef','TEST-CS-12-M1','TEST-CS-12','inbound','I write for a food magazine - can I quote you?','[]','2026-11-02 01:55:00+00'),
  ('mychef','TEST-CS-13-M1','TEST-CS-13','inbound','We are travelling with a well-known family and value discretion.','[]','2026-11-02 02:00:00+00'),
  ('mychef','TEST-CS-14-M1','TEST-CS-14','inbound','Berapa harga untuk 8 orang?','[]','2026-11-02 02:05:00+00'),
  ('mychef','TEST-CS-15-M1','TEST-CS-15','inbound','Hi, we would like dinner - bisa bahasa Indonesia juga?','[]','2026-11-02 02:10:00+00'),
  ('mychef','TEST-CS-16-M1','TEST-CS-16','inbound','hey info?','[]','2026-11-02 02:15:00+00'),
  ('mychef','TEST-CS-17-M1','TEST-CS-17','inbound','?','[]','2026-11-02 02:20:00+00'),
  ('mychef','TEST-CS-18-M1','TEST-CS-18','inbound','Price for 6, what menu options, is the 20th free, do you come to Uluwatu, and one guest is coeliac?','[]','2026-11-02 02:25:00+00'),
  ('mychef','TEST-CS-19-M1','TEST-CS-19','inbound','We would like to book the 14th, 6 guests.','[]','2026-11-02 02:30:00+00'),
  ('mychef','TEST-CS-20-M1','TEST-CS-20','inbound','Dinner for 4 on the 18th, please.','[]','2026-11-02 02:35:00+00')
on conflict (workspace_id, id) do update
  set body = excluded.body, created_at = excluded.created_at, direction = excluded.direction;

commit;
