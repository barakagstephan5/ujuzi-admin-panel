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
    let code = data?.code;
    // Supabase returns non-2xx JSON in FunctionsHttpError.context, not data.
    // Keep the server's actionable explanation, including protected exams.
    if (!message && typeof error.context?.clone === 'function') {
      try {
        const payload = await error.context.clone().json();
        message = payload?.error || payload?.message;
        code = payload?.code;
      } catch { /* Fall back to the SDK error below. */ }
    }
    // `code` lets a panel react to decisions the server asks for, such as
    // confirming a package replacement or a payment still in progress.
    throw Object.assign(new Error(message || error.message || 'Request failed'), { code: code ?? null });
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
