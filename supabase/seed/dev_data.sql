-- DEV ONLY: sample areas + 20 test customers. Do NOT run in production.
-- Run in the SQL editor after the migrations. Each customer automatically
-- gets the current month's fee, so they appear on the Collections page.
insert into public.areas(name)
select t.name from (values ('Chak 1'),('Chak 2'),('Basti Rehmat'),('Kot Ahmad'),('Mohri Wala')) t(name)
where not exists (select 1 from public.areas a where lower(btrim(a.name)) = lower(t.name));

insert into public.customers(username, phone, package_id, area_id, address)
select 'Test Customer ' || g,
       '0300' || lpad((1000000 + g)::text, 7, '0'),
       (select id from public.packages order by id limit 1 offset (g % 4)),
       (select id from public.areas order by id limit 1 offset (g % 5)),
       'House ' || g
from generate_series(1, 20) g;
