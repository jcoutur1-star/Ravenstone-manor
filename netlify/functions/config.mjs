export default async () => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return Response.json({ error: "Supabase is not configured yet." }, { status: 503 });
  return Response.json({ url, anonKey }, { headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/config" };
