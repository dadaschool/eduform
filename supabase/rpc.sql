-- 초대코드 사용 횟수 증가 RPC
create or replace function increment_invite_code(code text)
returns void as $$
begin
  update invite_codes
  set used_count = used_count + 1
  where invite_codes.code = $1;
end;
$$ language plpgsql security definer;
