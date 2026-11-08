do $fix$
declare f text;begin
 f:=pg_get_functiondef('access_private.settlement_engine(uuid,text,uuid,jsonb)'::regprocedure);
 f:=replace(f,'abs(st.net)-abs(access_private.settlement_remaining(c,st.id)) paid_total','case when st.state=''cancelled'' then 0 else abs(st.net)-abs(access_private.settlement_remaining(c,st.id)) end paid_total');
 f:=replace(f,'''paid_total'',abs(s.net)-abs(access_private.settlement_remaining(c,s.id))','''paid_total'',case when s.state=''cancelled'' then 0 else abs(s.net)-abs(access_private.settlement_remaining(c,s.id)) end');
 execute f;
end $fix$;
