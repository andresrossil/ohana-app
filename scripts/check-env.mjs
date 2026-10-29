const {VITE_SUPABASE_URL:url,VITE_SUPABASE_PUBLISHABLE_KEY:key}=process.env;
if(url!=='https://fkkmhdwgldddoylnxnnh.supabase.co'||!key?.startsWith('sb_publishable_')){
 console.error('Missing or invalid public Supabase configuration for the existing Ohana project.');
 process.exit(1);
}
console.log('Public configuration validated.');
