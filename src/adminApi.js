import { supabase } from './supabase';

export async function adminCall(functionName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your session expired. Please sign in again.');
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error || data?.error) throw new Error(data?.error || error?.message || 'Request failed');
  return data;
}
