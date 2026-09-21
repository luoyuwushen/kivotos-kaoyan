-- ============================================================================
--  基沃托斯作战本部 · 云端同步（路径 2：真正的后端 = Supabase）
--  ---------------------------------------------------------------------------
--  怎么用：
--    1. 打开 Supabase 控制台 → 左侧 SQL Editor → New query
--    2. 把本文件从头到尾粘进去 → 点 Run
--    3. 看到 "Success. No rows returned" 就成了（脚本可以重复执行，不会报错）
--
--  这个脚本干三件事：
--    · 建一张表 kaoyan_data：一个用户一行，整份备考数据放在 JSONB 里
--    · 打开行级安全（RLS）并只留「本人可读写」的策略
--      —— 这是整个方案的安全边界：即使有人改前端 JS 去查别人的数据，
--         数据库这一层也会拒绝，返回 0 行而不是别人的数据
--    · 建一个触发器，每次写入自动盖服务器时间戳（用于判断谁的数据更新）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 建表：一个用户一行
-- ---------------------------------------------------------------------------
create table if not exists public.kaoyan_data (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  payload    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- 埋点用，可留空；不收集任何可识别个人的信息
  client     text
);

comment on table  public.kaoyan_data is '每个用户一行，整份考研规划数据（JSONB）';
comment on column public.kaoyan_data.payload is '前端 state 的完整快照；纯设备相关的设置已在客户端剔除';

-- ---------------------------------------------------------------------------
-- 2. 打开行级安全（RLS）
--    没打开 RLS 的话，只要拿到 anon key 就能读全表 —— 那才是真的漏。
-- ---------------------------------------------------------------------------
alter table public.kaoyan_data enable row level security;
-- 强制 RLS 对表属主也生效，避免以后误用 service_role 之外的高权限角色绕过
alter table public.kaoyan_data force row level security;

-- 只允许登录用户操作（anon 匿名角色连表都碰不到）
revoke all on public.kaoyan_data from anon;
grant select, insert, update, delete on public.kaoyan_data to authenticated;

-- 老策略先删掉，保证脚本可以反复执行
drop policy if exists "kaoyan_read_own"   on public.kaoyan_data;
drop policy if exists "kaoyan_insert_own" on public.kaoyan_data;
drop policy if exists "kaoyan_update_own" on public.kaoyan_data;
drop policy if exists "kaoyan_delete_own" on public.kaoyan_data;

-- 读：只能读自己那一行
create policy "kaoyan_read_own" on public.kaoyan_data
  for select to authenticated
  using (auth.uid() = user_id);

-- 写：只能插自己那一行（想伪造别人的 user_id 会被 with check 拦下）
create policy "kaoyan_insert_own" on public.kaoyan_data
  for insert to authenticated
  with check (auth.uid() = user_id);

-- 改：只能改自己那一行，且改完 user_id 还得是自己（防止把行「送」给别人）
create policy "kaoyan_update_own" on public.kaoyan_data
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 删：只能删自己那一行
create policy "kaoyan_delete_own" on public.kaoyan_data
  for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. updated_at 自动盖服务器时间戳
--    客户端不许自己填时间（否则设备时钟不准就会导致「谁更新」判断错乱）。
-- ---------------------------------------------------------------------------
create or replace function public.kaoyan_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists kaoyan_touch on public.kaoyan_data;
create trigger kaoyan_touch
  before insert or update on public.kaoyan_data
  for each row execute function public.kaoyan_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. 自检：下面这段会打印一行结果，rls_enabled 必须是 true、policies 必须是 4
--    （注意：因为开了 force RLS，用 SQL Editor 以表属主身份直接 select 是看不到别人
--      的数据的，这属于正常现象 —— 想人工核对请用 Table Editor，或临时关掉 force。）
-- ---------------------------------------------------------------------------
select
  c.relname                                as table_name,
  c.relrowsecurity                         as rls_enabled,
  c.relforcerowsecurity                    as rls_forced,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'kaoyan_data') as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'kaoyan_data';

-- ---------------------------------------------------------------------------
-- 5.（可选）清掉某个人留在云端的全部数据
--    平时不用跑，用设置页里的「删除云端数据」按钮就行；
--    留在这里是给「账号都登不上了」这种极端情况兜底。
-- ---------------------------------------------------------------------------
-- delete from public.kaoyan_data where user_id = '在这里填那个用户的 uuid';
