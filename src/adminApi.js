import { supabase } from './supabase';

export async function adminCall(functionName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your session expired. Please sign in again.');
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    let message = data?.error;
    // Supabase returns non-2xx JSON in FunctionsHttpError.context, not data.
    // Keep the server's actionable explanation, including protected exams.
    if (!message && typeof error.context?.clone === 'function') {
      try {
        const payload = await error.context.clone().json();
        message = payload?.error || payload?.message;
      } catch { /* Fall back to the SDK error below. */ }
    }
    throw new Error(message || error.message || 'Request failed');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
