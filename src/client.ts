import {createClient} from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key?.startsWith('sb_publishable_')) {
 throw new Error('Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY antes de compilar.');
}
export const confirmationRedirect = new URL(`${import.meta.env.BASE_URL}?auth=confirm`,window.location.origin).href;
export const supabase = createClient(url,key,{auth:{flowType:'implicit',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
