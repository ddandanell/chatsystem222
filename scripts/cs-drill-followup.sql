-- CS-025 — relative-time follow-up fixture for the 20-conversation drill.
--
-- Why this file exists
-- --------------------
-- `cs-drill-seed.sql` dates every drill row with a hardcoded absolute timestamp
-- (`2026-11-02 01:00:00+00` … `2026-11-02 02:36:00+00`). Run at any other hour those rows are
-- in the future, so "oldest first" reads tomorrow and a follow-up cannot be newer than the first
-- message. This script never writes an absolute timestamp: every value is derived from `now()` at
-- the moment it runs, so the fixture is correct whenever it is run.
--
-- What it does (in order, one transaction)
-- ----------------------------------------
--   1. fails closed unless the 20 `TEST-CS-*` conversations from the seed exist;
--   2. re-dates the 20 first inbound messages (`-M1`) into the recent past, relative to `now()`,
--      keeping a 1-minute stagger — this is the repair for CS-025, and it is idempotent;
--   3. inserts one follow-up inbound message per thread (`-M2`), 21 minutes after its `-M1` and
--      always in the past, so the thread has a newer inbound than the message a decision covered;
--   4. sets `conversations.last_message_at` to the newest message actually present (derived, never
--      typed twice) and opens the 20 threads with `status = 'needs_reply'` — the queue gate the
--      desk reads. Nothing else changes status.
--
-- What it does NOT do
-- -------------------
--   * no decision, feedback, draft or send is written, and no webhook is forged — the drill is
--     driven from the console by Customer Service, not by this fixture;
--   * no DELETE and no TRUNCATE: `mychef_runtime` holds neither, so the `-M2` rows stay until the
--     owner removes them. Reversal is therefore by status, exactly as the seed documents:
--       update mychef_inbox.conversations set status = 'done'
--        where workspace_id = 'mychef' and id like 'TEST-CS-%';
--   * nothing in here is a real guest: the bodies are written for the drill, and there is no name,
--     phone, email, address or villa anywhere in the file.
--
-- Order of use
-- ------------
--   seed (tombstoned, `done`)  ->  open the drill (seed's own toggle)  ->  CS records a decision on
--   `-M1`  ->  run this file  ->  the thread must reappear in the queue, and the composer, the AI
--   draft and the Agent path must work on `-M2`. That is CS-001's re-open, measured.
--
-- Run it inside one transaction and read the verification row before you commit.

begin;

-- 1. fail closed: this fixture assumes the seed has run.
do $$
declare n int;
begin
  select count(*) into n
    from mychef_inbox.conversations
   where workspace_id = 'mychef' and id ~ '^TEST-CS-[0-9]{2}$';
  if n <> 20 then
    raise exception 'cs-drill-followup: expected 20 TEST-CS conversations, found % — run cs-drill-seed.sql first', n;
  end if;
end $$;

-- 2. repair CS-025: no drill message may sit in the future. `-M1` lands 59..40 minutes ago.
update mychef_inbox.messages m
   set created_at = now() - make_interval(mins => 60 - d.n)
  from (select n, 'TEST-CS-' || lpad(n::text, 2, '0') as cid
          from generate_series(1, 20) as g(n)) d
 where m.workspace_id = 'mychef'
   and m.conversation_id = d.cid
   and m.id = d.cid || '-M1';

-- 3. one follow-up inbound per thread, 38..19 minutes ago: always 21 minutes after its `-M1`
--    and always in the past, so the newest inbound is the follow-up at any run time.
insert into mychef_inbox.messages
  (workspace_id, id, conversation_id, direction, body, attachments, created_at)
select 'mychef', d.cid || '-M2', d.cid, 'inbound', v.body, '[]'::jsonb,
       now() - make_interval(mins => 39 - d.n)
  from (select n, 'TEST-CS-' || lpad(n::text, 2, '0') as cid
          from generate_series(1, 20) as g(n)) d
  join (values
    ( 1, 'Still waiting - can you just tell me the price for 4?'),
    ( 2, 'Also, can two of the ten have a vegetarian menu?'),
    ( 3, 'And is the babi guling extra, or included?'),
    ( 4, 'Confirming again - can you guarantee a nut-free kitchen?'),
    ( 5, 'Is the gluten free menu the same price?'),
    ( 6, 'Any update on the 14th? We can pay a deposit today.'),
    ( 7, 'We are 8 people in Canggu on the 12th - does that change the travel fee?'),
    ( 8, 'We would still like an answer about the 90 minutes.'),
    ( 9, 'I have not heard back about the deposit.'),
    (10, 'My lawyer has had no reply. This is the last message before we escalate.'),
    (11, 'I am still unwell. What are you going to do about it?'),
    (12, 'My deadline is tomorrow - do I have a quote or not?'),
    (13, 'Please confirm your staff will sign an NDA before arrival.'),
    (14, 'Halo, apakah ada kabar? Kami butuh konfirmasi harga.'),
    (15, 'Any news? Kami masih menunggu jawaban.'),
    (16, 'bump'),
    (17, 'hello?'),
    (18, 'I asked five things and got one answer. Please answer all five.'),
    (19, 'We decided: the 14th, 6 guests. Can you confirm?'),
    (20, 'One more question before we book - can we add a dessert course?')
  ) as v(n, body) on v.n = d.n
on conflict (workspace_id, id) do update
  set conversation_id = excluded.conversation_id,
      direction      = excluded.direction,
      body           = excluded.body,
      created_at     = excluded.created_at;

-- 4. derive `last_message_at` from the messages themselves, then open the queue gate.
update mychef_inbox.conversations c
   set last_message_at = s.newest,
       status          = 'needs_reply'
  from (select conversation_id, max(created_at) as newest
          from mychef_inbox.messages
         where workspace_id = 'mychef' and conversation_id like 'TEST-CS-%'
         group by conversation_id) s
 where c.workspace_id = 'mychef'
   and c.id = s.conversation_id
   and c.id like 'TEST-CS-%';

-- Verification row. Read every column before you commit; each expected value is in the comment.
select
  (select count(*) from mychef_inbox.messages
    where workspace_id = 'mychef' and conversation_id like 'TEST-CS-%' and id like '%-M2')
    as followup_rows,                                                    -- 20
  (select count(*) from mychef_inbox.messages
    where workspace_id = 'mychef' and conversation_id like 'TEST-CS-%' and created_at > now())
    as messages_in_future,                                               -- 0
  (select count(*) from mychef_inbox.conversations
    where workspace_id = 'mychef' and id like 'TEST-CS-%' and last_message_at > now())
    as conversations_in_future,                                          -- 0
  (select count(*) from mychef_inbox.conversations
    where workspace_id = 'mychef' and id like 'TEST-CS-%' and status = 'needs_reply')
    as open_threads,                                                     -- 20
  (select count(*) from (
     select m.conversation_id,
            max(case when m.id like '%-M2' then m.created_at end) as t2,
            max(case when m.id like '%-M1' then m.created_at end) as t1
       from mychef_inbox.messages m
      where m.workspace_id = 'mychef' and m.conversation_id like 'TEST-CS-%'
      group by m.conversation_id) x
    where x.t1 is null or x.t2 is null or x.t2 <= x.t1)
    as threads_without_newer_inbound;                                    -- 0

commit;
