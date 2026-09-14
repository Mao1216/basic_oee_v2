import { isSupabaseConfigured, supabase } from './supabase';

export const requireSupabase = () => {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('Supabase no está configurado. Añade las variables VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.');
  }
  return supabase;
};

export const bioeeRepository = {
  async getCurrentProfile() {
    const client = requireSupabase();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) return null;
    const { data, error } = await client.from('profiles').select('*').eq('id', authData.user.id).single();
    if (error) throw error;
    return data;
  },

  async listWorkOrders() {
    const client = requireSupabase();
    const { data, error } = await client
      .from('work_orders')
      .select('*, lots(code), equipment(name, production_lines(name)), profiles!work_orders_registrar_id_fkey(full_name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async startOeeSession(workOrderId: string) {
    const client = requireSupabase();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) throw authError ?? new Error('Debes iniciar sesión.');
    const { data, error } = await client.rpc('start_oee_session', { p_work_order_id: workOrderId });
    if (error) throw error;
    return data;
  },

  async saveSessionDraft(sessionId: string, patch: Record<string, unknown>) {
    const client = requireSupabase();
    const { data, error } = await client.from('oee_sessions').update(patch).eq('id', sessionId).select().single();
    if (error) throw error;
    return data;
  },

  subscribeToSession(sessionId: string, onChange: (payload: unknown) => void) {
    const client = requireSupabase();
    const channel = client.channel(`oee-session-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oee_sessions', filter: `id=eq.${sessionId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stoppages', filter: `session_id=eq.${sessionId}` }, onChange)
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }
};
